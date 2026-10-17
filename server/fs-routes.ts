import type { Express, NextFunction, Request, Response } from "express";
import { promises as fsp } from "fs";
import os from "os";
import path from "path";
import {
  FS_CLIENT_HEADER, editableTypeOf,
  type FsCreateRequest, type FsEntry, type FsListResponse, type FsReadResponse,
  type FsStatus, type FsWriteRequest, type FsWriteResponse,
} from "@shared/fs";

const MAX_READ_BYTES = 20 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8000;
const HIDDEN_ENTRIES = new Set([".git", ".DS_Store", "Thumbs.db"]);
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Folder access reads and writes the user's own disk, so it is only on for
 * the desktop app (FS_ACCESS=1) and local development, never for a hosted
 * production deploy unless explicitly enabled.
 */
export function isFsAccessEnabled() {
  return process.env.FS_ACCESS === "1" || process.env.NODE_ENV !== "production";
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Requests must come from this machine, name a loopback host (blocks DNS
// rebinding) and carry the client header (blocks cross-site simple requests).
function guard(req: Request, res: Response, next: NextFunction) {
  const remote = req.socket.remoteAddress ?? "";
  const hostname = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!LOOPBACK_ADDRESSES.has(remote) || !LOOPBACK_HOSTNAMES.has(hostname)) {
    return res.status(403).json({ message: "Folder access is only available on this computer" });
  }
  if (req.get(FS_CLIENT_HEADER) !== "1") {
    return res.status(403).json({ message: "Missing client header" });
  }
  next();
}

function absolutePath(value: unknown): string {
  if (typeof value !== "string" || !value || !path.isAbsolute(value)) {
    throw new HttpError(400, "An absolute path is required");
  }
  return path.resolve(value);
}

function fsError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return new HttpError(404, "Not found");
  if (code === "EACCES" || code === "EPERM") return new HttpError(403, "Permission denied");
  if (code === "ENOTDIR") return new HttpError(400, "Not a folder");
  if (code === "EISDIR") return new HttpError(400, "Not a file");
  return new HttpError(500, (err as Error)?.message ?? "File system error");
}

const handle = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response) => {
    fn(req, res).catch(err => {
      const e = fsError(err);
      res.status(e.status).json({ message: e.message });
    });
  };

function looksBinary(buf: Buffer) {
  return buf.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/** Writes via a temp file + rename so a crash never leaves a half-written file. */
async function atomicWrite(filePath: string, content: string) {
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await fsp.writeFile(tmp, content, "utf8");
  try {
    await fsp.rename(tmp, filePath);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    // Windows refuses to replace a file another program holds open; write in place instead.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
      await fsp.writeFile(filePath, content, "utf8");
      return;
    }
    throw err;
  }
}

function assertEditable(filePath: string) {
  if (!editableTypeOf(filePath)) {
    throw new HttpError(400, "Only .md, .markdown, .json, .yaml and .yml files can be saved");
  }
}

export function registerFsRoutes(app: Express) {
  app.get("/api/fs/status", (_req, res) => {
    const status: FsStatus = {
      enabled: isFsAccessEnabled(),
      home: os.homedir(),
      sep: path.sep as FsStatus["sep"],
      caseInsensitive: process.platform === "win32" || process.platform === "darwin",
    };
    res.json(status);
  });

  if (!isFsAccessEnabled()) {
    app.use("/api/fs", (_req, res) => {
      res.status(404).json({ message: "Folder access is disabled" });
    });
    return;
  }

  app.use("/api/fs", guard);

  app.get("/api/fs/list", handle(async (req, res) => {
    const dir = absolutePath(req.query.path);
    const dirents = await fsp.readdir(dir, { withFileTypes: true });
    const entries: FsEntry[] = [];
    for (const d of dirents) {
      if (HIDDEN_ENTRIES.has(d.name)) continue;
      let isDir = d.isDirectory();
      if (d.isSymbolicLink()) {
        isDir = await fsp.stat(path.join(dir, d.name)).then(s => s.isDirectory(), () => false);
      } else if (!isDir && !d.isFile()) {
        continue; // sockets, devices, etc.
      }
      entries.push({ name: d.name, path: path.join(dir, d.name), kind: isDir ? "directory" : "file" });
    }
    entries.sort((a, b) =>
      a.kind !== b.kind
        ? (a.kind === "directory" ? -1 : 1)
        : a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
    const parent = path.dirname(dir);
    const body: FsListResponse = { path: dir, parent: parent === dir ? null : parent, entries };
    res.json(body);
  }));

  app.get("/api/fs/read", handle(async (req, res) => {
    const filePath = absolutePath(req.query.path);
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) throw new HttpError(400, "Not a file");
    const body: FsReadResponse = { path: filePath, size: stat.size, mtimeMs: stat.mtimeMs, content: null };
    if (stat.size > MAX_READ_BYTES) {
      body.reason = "too-large";
    } else {
      const buf = await fsp.readFile(filePath);
      if (looksBinary(buf)) body.reason = "binary";
      else body.content = buf.toString("utf8");
    }
    res.json(body);
  }));

  app.put("/api/fs/write", handle(async (req, res) => {
    const { content, expectedMtimeMs } = req.body as FsWriteRequest;
    const filePath = absolutePath(req.body?.path);
    assertEditable(filePath);
    if (typeof content !== "string") throw new HttpError(400, "content must be a string");

    const current = await fsp.stat(filePath);
    if (typeof expectedMtimeMs === "number" && Math.abs(current.mtimeMs - expectedMtimeMs) > 1) {
      throw new HttpError(409, "The file was changed outside the editor");
    }
    await atomicWrite(filePath, content);
    const stat = await fsp.stat(filePath);
    const body: FsWriteResponse = { path: filePath, size: stat.size, mtimeMs: stat.mtimeMs };
    res.json(body);
  }));

  app.post("/api/fs/create", handle(async (req, res) => {
    const { name, content = "" } = req.body as FsCreateRequest;
    const directory = absolutePath(req.body?.directory);
    if (typeof name !== "string" || !name.trim() || name !== path.basename(name) || name === "." || name === "..") {
      throw new HttpError(400, "Enter a file name without folders");
    }
    const filePath = path.join(directory, name.trim());
    assertEditable(filePath);
    // "wx" fails if the file already exists instead of overwriting it.
    await fsp.writeFile(filePath, content, { encoding: "utf8", flag: "wx" }).catch(err => {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new HttpError(409, "A file with that name already exists");
      throw err;
    });
    const stat = await fsp.stat(filePath);
    const body: FsWriteResponse = { path: filePath, size: stat.size, mtimeMs: stat.mtimeMs };
    res.status(201).json(body);
  }));
}
