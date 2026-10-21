import { useQuery } from "@tanstack/react-query";
import {
  FS_CLIENT_HEADER,
  type FsCreateRequest, type FsListResponse, type FsMoveRequest, type FsMoveResponse, type FsReadResponse,
  type FsSearchRequest, type FsSearchResponse,
  type FsStatus, type FsWriteRequest, type FsWriteResponse,
} from "@shared/fs";
import type { XlsxResponse } from "@shared/office";

/** Thrown for 409 responses: the file changed on disk, or a new file's name is taken. */
export class FsConflictError extends Error {}
export class FsNotFoundError extends Error {}

async function fsFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      [FS_CLIENT_HEADER]: "1",
      ...init.headers,
    },
  });
  if (!res.ok) {
    const message = await res.json().then(b => b?.message, () => undefined) ?? res.statusText;
    if (res.status === 409) throw new FsConflictError(message);
    if (res.status === 404) throw new FsNotFoundError(message);
    throw new Error(message);
  }
  return res.json();
}

export const fsApi = {
  status: () => fetch("/api/fs/status").then(r => r.json() as Promise<FsStatus>),
  /** `foldersOnly` skips files, which is much cheaper in folders with thousands of them. */
  list: (dir: string, options: { foldersOnly?: boolean } = {}) =>
    fsFetch<FsListResponse>(`/api/fs/list?path=${encodeURIComponent(dir)}${options.foldersOnly ? "&folders=1" : ""}`),
  read: (file: string) => fsFetch<FsReadResponse>(`/api/fs/read?path=${encodeURIComponent(file)}`),
  write: (body: FsWriteRequest, options: { keepalive?: boolean } = {}) =>
    fsFetch<FsWriteResponse>("/api/fs/write", { method: "PUT", body: JSON.stringify(body), keepalive: options.keepalive }),
  search: (body: FsSearchRequest, signal?: AbortSignal) =>
    fsFetch<FsSearchResponse>("/api/fs/search", { method: "POST", body: JSON.stringify(body), signal }),
  /** File contents as bytes (Word documents). */
  raw: async (file: string) => {
    const res = await fetch(`/api/fs/raw?path=${encodeURIComponent(file)}`, { headers: { [FS_CLIENT_HEADER]: "1" } });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? res.statusText);
    return res.arrayBuffer();
  },
  xlsx: (file: string) => fsFetch<XlsxResponse>(`/api/fs/xlsx?path=${encodeURIComponent(file)}`),
  create: (body: FsCreateRequest) =>
    fsFetch<FsWriteResponse>("/api/fs/create", { method: "POST", body: JSON.stringify(body) }),
  /** Moves a file into a folder; a name clash there is an FsConflictError. */
  move: (body: FsMoveRequest) =>
    fsFetch<FsMoveResponse>("/api/fs/move", { method: "POST", body: JSON.stringify(body) }),
};

export const fsKeys = {
  list: (dir: string) => ["fs-list", dir] as const,
  /** Folders-only listings (the move picker), kept apart from the explorer's full listings. */
  folders: (dir: string) => ["fs-folders", dir] as const,
  file: (file: string) => ["fs-file", file] as const,
};

export function useFsStatus() {
  return useQuery({ queryKey: ["fs-status"], queryFn: fsApi.status, staleTime: Infinity });
}

// ── Desktop bridge (electron/preload.cjs) ────────────────────────────────────

interface DesktopBridge {
  pickFolders(): Promise<string[]>;
  revealPath(path: string): Promise<void>;
  /** Opens a document in its default app (Word, Excel…). Missing in older builds. */
  openPath?(path: string): Promise<string>;
}

declare global {
  interface Window {
    mdcDesktop?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | undefined =
  typeof window !== "undefined" ? window.mdcDesktop : undefined;

// ── Path helpers (work with both / and \ separators) ─────────────────────────

export function baseName(p: string) {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) || trimmed : trimmed;
}

/** A path in a form that compares equal however it was written (separators, trailing slash, case). */
export function pathKey(p: string, caseInsensitive: boolean) {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return caseInsensitive ? s.toLowerCase() : s;
}

/** True when `child` is `parent` itself or somewhere inside it. */
export function isInside(child: string, parent: string, caseInsensitive: boolean) {
  const c = pathKey(child, caseInsensitive);
  const p = pathKey(parent, caseInsensitive);
  return c === p || c.startsWith(p + "/");
}

export function samePath(a: string, b: string, caseInsensitive: boolean) {
  return pathKey(a, caseInsensitive) === pathKey(b, caseInsensitive);
}

/** The folder a path is in ("" if it has none). */
export function dirName(p: string) {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (idx < 0) return "";
  const head = trimmed.slice(0, idx);
  // Keep the separator for a drive or filesystem root ("C:\", "/").
  return head === "" || /^[A-Za-z]:$/.test(head) ? trimmed.slice(0, idx + 1) : head;
}

export function relativePath(child: string, parent: string) {
  const rest = child.slice(parent.replace(/[\\/]+$/, "").length).replace(/^[\\/]+/, "");
  return rest || baseName(child);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // The async clipboard API needs a focused document; fall back to a hidden textarea.
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    if (!ok) throw new Error("Clipboard unavailable");
  }
}
