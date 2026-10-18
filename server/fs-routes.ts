import type { Express, NextFunction, Request, Response } from "express";
import { promises as fsp } from "fs";
import { randomBytes } from "crypto";
import os from "os";
import path from "path";
import {
  FS_CLIENT_HEADER, IMAGE_TYPES, extensionOf,
  type FsCreateRequest, type FsEntry, type FsListResponse, type FsReadResponse,
  type FsSearchRequest, type FsSearchResponse, type FsSearchResult,
  type FsStatus, type FsWriteRequest, type FsWriteResponse,
} from "@shared/fs";

const MAX_READ_BYTES = 20 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8000;
const HIDDEN_ENTRIES = new Set([".git", ".DS_Store", "Thumbs.db"]);
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// Image URLs (used by <img>, which can't send headers) carry this token instead.
const IMAGE_TOKEN = randomBytes(24).toString("hex");
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const NAME_INDEX_TTL_MS = 60_000;
const NAME_INDEX_MAX_ENTRIES = 200_000;

// Search limits: big vaults (thousands of files in dot-folders) must not stall the app.
const SEARCH_SKIP_DIRS = new Set(["node_modules"]);
const SEARCH_MAX_RESULTS = 500;
const SEARCH_MAX_ENTRIES = 200_000;
const SEARCH_MAX_CONTENT_FILES = 20_000;
const SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024;
const SEARCH_MAX_LINES_PER_FILE = 5;
const SEARCH_TIME_BUDGET_MS = 10_000;
const SEARCH_PARALLEL_READS = 16;
const SEARCH_LINE_PREVIEW = 160;
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

function isLocalRequest(req: Request) {
  const remote = req.socket.remoteAddress ?? "";
  const hostname = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  return LOOPBACK_ADDRESSES.has(remote) && LOOPBACK_HOSTNAMES.has(hostname);
}

// Requests must come from this machine, name a loopback host (blocks DNS
// rebinding) and carry the client header (blocks cross-site simple requests).
export function localOnlyGuard(req: Request, res: Response, next: NextFunction) {
  if (!isLocalRequest(req)) {
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

/** Trims a long line to a window around the match so results stay readable. */
function previewLine(text: string, at: number) {
  if (text.length <= SEARCH_LINE_PREVIEW) return text.trim();
  const start = Math.max(0, at - 50);
  const end = Math.min(text.length, start + SEARCH_LINE_PREVIEW);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** Counts matches of `needle` (lower case) in a text file and keeps the first few lines. */
function searchText(text: string, needle: string) {
  const lines: FsSearchResult["lines"] = [];
  let count = 0;
  const all = text.split(/\r?\n/);
  for (let i = 0; i < all.length; i++) {
    const lower = all[i].toLowerCase();
    let at = lower.indexOf(needle);
    if (at < 0) continue;
    if (lines.length < SEARCH_MAX_LINES_PER_FILE) lines.push({ line: i, text: previewLine(all[i], at) });
    while (at >= 0) {
      count++;
      at = lower.indexOf(needle, at + needle.length);
    }
  }
  return { count, lines };
}

/**
 * Walks the workspace folders for names (and optionally contents) containing
 * the query. Stops early at the limits above and reports that it did.
 */
async function searchFolders(request: FsSearchRequest, isAborted: () => boolean): Promise<FsSearchResponse> {
  const started = Date.now();
  const needle = request.query.trim().toLowerCase();
  const results: FsSearchResult[] = [];
  let truncated = false;
  let entries = 0;
  let scannedFiles = 0;

  const outOfBudget = () => {
    if (results.length >= SEARCH_MAX_RESULTS || entries >= SEARCH_MAX_ENTRIES ||
        Date.now() - started > SEARCH_TIME_BUDGET_MS) {
      truncated = true;
    }
    return truncated || isAborted();
  };

  const searchFile = async (filePath: string, name: string) => {
    const nameMatch = name.toLowerCase().includes(needle);
    let contentMatches = 0;
    let lines: FsSearchResult["lines"] = [];
    if (request.contents && scannedFiles < SEARCH_MAX_CONTENT_FILES) {
      try {
        const stat = await fsp.stat(filePath);
        if (stat.size <= SEARCH_MAX_FILE_BYTES) {
          scannedFiles++;
          const buf = await fsp.readFile(filePath);
          if (!looksBinary(buf)) ({ count: contentMatches, lines } = searchText(buf.toString("utf8"), needle));
        }
      } catch {
        // Unreadable files are skipped.
      }
    } else if (request.contents) {
      truncated = true;
    }
    if (nameMatch || contentMatches > 0) {
      results.push({ path: filePath, kind: "file", nameMatch, contentMatches, lines });
    }
  };

  for (const root of request.roots) {
    const stack = [absolutePath(root)];
    while (stack.length && !outOfBudget()) {
      const dir = stack.pop()!;
      let dirents;
      try {
        dirents = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      dirents.sort((a, b) => b.name.localeCompare(a.name)); // popped in A–Z order
      const files: [string, string][] = [];
      for (const d of dirents) {
        if (HIDDEN_ENTRIES.has(d.name) || SEARCH_SKIP_DIRS.has(d.name)) continue;
        entries++;
        const full = path.join(dir, d.name);
        if (d.isDirectory()) {
          stack.push(full);
          if (d.name.toLowerCase().includes(needle)) {
            results.push({ path: full, kind: "directory", nameMatch: true, contentMatches: 0, lines: [] });
          }
        } else if (d.isFile()) {
          files.push([full, d.name]);
        }
      }
      for (let i = 0; i < files.length && !outOfBudget(); i += SEARCH_PARALLEL_READS) {
        await Promise.all(files.slice(i, i + SEARCH_PARALLEL_READS).map(([full, name]) => searchFile(full, name)));
      }
    }
  }

  results.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base", numeric: true }));
  return { results: results.slice(0, SEARCH_MAX_RESULTS), truncated, scannedFiles, elapsedMs: Date.now() - started };
}

// ── Image lookup ────────────────────────────────────────────────────────────

const exists = (p: string) => fsp.stat(p).then(s => s.isFile(), () => false);

/** Lower-case file name → paths, per workspace folder, for Obsidian-style ![[name.png]] lookups. */
const nameIndexes = new Map<string, { built: number; index: Promise<Map<string, string[]>> }>();

function nameIndex(root: string) {
  const cached = nameIndexes.get(root);
  if (cached && Date.now() - cached.built < NAME_INDEX_TTL_MS) return cached.index;
  const index = (async () => {
    const byName = new Map<string, string[]>();
    const stack = [root];
    let entries = 0;
    while (stack.length && entries < NAME_INDEX_MAX_ENTRIES) {
      const dir = stack.pop()!;
      const dirents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const d of dirents) {
        if (HIDDEN_ENTRIES.has(d.name) || SEARCH_SKIP_DIRS.has(d.name)) continue;
        entries++;
        const full = path.join(dir, d.name);
        if (d.isDirectory()) stack.push(full);
        else if (d.isFile() && extensionOf(d.name) in IMAGE_TYPES) {
          const key = d.name.toLowerCase();
          byName.set(key, [...(byName.get(key) ?? []), full]);
        }
      }
    }
    return byName;
  })();
  nameIndexes.set(root, { built: Date.now(), index });
  return index;
}

/**
 * Finds the file an image reference in a Markdown document points at:
 * relative to the document, relative to its workspace folder (vault root), or —
 * like Obsidian — any file with that name in the workspace folder.
 */
async function resolveImage(doc: string, root: string | null, target: string): Promise<string | null> {
  let ref = target.trim().replace(/^<|>$/g, "");
  try { ref = decodeURIComponent(ref); } catch { /* keep as written */ }
  ref = ref.split(/[?#]/)[0];
  if (!ref) return null;

  const docDir = path.dirname(doc);
  const base = root ?? docDir;
  const candidates = path.isAbsolute(ref) && !/^[\\/]/.test(ref)
    ? [ref]
    : ref.startsWith("/")
      ? [path.join(base, ref)]
      : [path.resolve(docDir, ref), path.resolve(base, ref)];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  const matches = (await nameIndex(base)).get(path.basename(ref).toLowerCase());
  // Prefer the match closest to the document (shortest path).
  return matches?.sort((a, b) => a.length - b.length)[0] ?? null;
}

export function registerFsRoutes(app: Express) {
  app.get("/api/fs/status", (_req, res) => {
    const status: FsStatus = {
      enabled: isFsAccessEnabled(),
      home: os.homedir(),
      sep: path.sep as FsStatus["sep"],
      caseInsensitive: process.platform === "win32" || process.platform === "darwin",
      imageToken: isFsAccessEnabled() && isLocalRequest(_req) ? IMAGE_TOKEN : "",
    };
    res.json(status);
  });

  if (!isFsAccessEnabled()) {
    app.use("/api/fs", (_req, res) => {
      res.status(404).json({ message: "Folder access is disabled" });
    });
    return;
  }

  // Images for <img> tags: ?path=<file>, or ?doc=<markdown file>&root=<folder>&target=<reference>.
  // Registered before the header guard because <img> can't send headers; the token stands in.
  app.get("/api/fs/image", handle(async (req, res) => {
    if (!isLocalRequest(req) || req.query.token !== IMAGE_TOKEN) throw new HttpError(403, "Forbidden");
    const filePath = typeof req.query.path === "string"
      ? absolutePath(req.query.path)
      : await resolveImage(
          absolutePath(req.query.doc),
          typeof req.query.root === "string" && req.query.root ? absolutePath(req.query.root) : null,
          String(req.query.target ?? ""),
        );
    if (!filePath) throw new HttpError(404, "Image not found");
    const type = IMAGE_TYPES[extensionOf(filePath)];
    if (!type) throw new HttpError(415, "Not an image");
    const stat = await fsp.stat(filePath);
    if (stat.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Image is too large");
    await new Promise<void>((resolve, reject) => {
      res.sendFile(filePath, {
        dotfiles: "allow",
        headers: {
          "Content-Type": type,
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
          // SVGs opened directly can't run scripts.
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        },
      }, err => (err ? reject(err) : resolve()));
    });
  }));

  app.use("/api/fs", localOnlyGuard);

  app.get("/api/fs/list", handle(async (req, res) => {
    const dir = absolutePath(req.query.path);
    const dirents = await fsp.readdir(dir, { withFileTypes: true });
    const listed = await Promise.all(dirents.map(async (d): Promise<FsEntry | null> => {
      if (HIDDEN_ENTRIES.has(d.name)) return null;
      if (!d.isDirectory() && !d.isFile() && !d.isSymbolicLink()) return null; // sockets, devices, etc.
      const full = path.join(dir, d.name);
      // stat follows symlinks, so a link to a folder lists as a folder.
      const stat = await fsp.stat(full).catch(() => null);
      const isDir = stat ? stat.isDirectory() : d.isDirectory();
      return { name: d.name, path: full, kind: isDir ? "directory" : "file", mtimeMs: stat?.mtimeMs ?? 0 };
    }));
    const entries = listed.filter((e): e is FsEntry => e !== null);
    entries.sort((a, b) =>
      a.kind !== b.kind
        ? (a.kind === "directory" ? -1 : 1)
        : a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
    const parent = path.dirname(dir);
    const body: FsListResponse = { path: dir, parent: parent === dir ? null : parent, entries };
    res.json(body);
  }));

  app.post("/api/fs/search", handle(async (req, res) => {
    const body = req.body as Partial<FsSearchRequest>;
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (!query) throw new HttpError(400, "query is required");
    if (!Array.isArray(body.roots) || body.roots.length === 0) throw new HttpError(400, "roots are required");
    const roots = body.roots.map(absolutePath);
    // Stop walking the disk if the client gave up (a newer search replaced this one).
    let aborted = false;
    res.on("close", () => { if (!res.writableEnded) aborted = true; });
    const result = await searchFolders({ roots, query, contents: !!body.contents }, () => aborted);
    if (!aborted) res.json(result);
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
