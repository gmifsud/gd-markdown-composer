// Shared contract for the local filesystem API (/api/fs/*). Only available
// when the server runs on the user's machine (desktop app or local dev).

/** Every /api/fs request must send this header (blocks cross-site form/img requests). */
export const FS_CLIENT_HEADER = "X-MDC-Client";

/** Image types the app can show (as files and inside Markdown), with their MIME types. */
export const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
};

export function extensionOf(filePath: string) {
  const name = filePath.slice(Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

export function isImagePath(filePath: string) {
  return extensionOf(filePath) in IMAGE_TYPES;
}

/** How a file opens in the editor, decided by its extension. */
export type FileKind = "md" | "html" | "json" | "yaml" | "drawio" | "image" | "docx" | "xlsx" | "text";

const KIND_BY_EXTENSION: Record<string, FileKind> = {
  ".md": "md",
  ".markdown": "md",
  ".html": "html",
  ".htm": "html",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".drawio": "drawio",
  ".dio": "drawio",
  ".docx": "docx",
  ".xlsx": "xlsx",
  ".xlsm": "xlsx",
};

export function fileKindOf(filePath: string): FileKind {
  // A leading dot (".gitignore") is a hidden file, not an extension.
  const ext = extensionOf(filePath);
  if (ext in IMAGE_TYPES) return "image";
  return KIND_BY_EXTENSION[ext] ?? "text";
}

/** Markdown, HTML, JSON and YAML open ready to edit; other files open read-only until unlocked. */
export function opensEditable(kind: FileKind) {
  return kind === "md" || kind === "html" || kind === "json" || kind === "yaml";
}

export interface FsStatus {
  enabled: boolean;
  home: string;
  sep: "/" | "\\";
  /** True on Windows and macOS, where paths compare case-insensitively. */
  caseInsensitive: boolean;
  /**
   * Per-launch secret for /api/fs/image. <img> tags can't send the client
   * header, so image URLs carry this instead; other sites can't read it.
   */
  imageToken: string;
}

export interface FsEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  /** Last modified time (ms since epoch); 0 if it couldn't be read. */
  mtimeMs: number;
}

export interface FsListResponse {
  path: string;
  parent: string | null;
  entries: FsEntry[];
}

export interface FsReadResponse {
  path: string;
  size: number;
  mtimeMs: number;
  /** Null when the file looks binary or is too large to open. */
  content: string | null;
  reason?: "binary" | "too-large";
}

export interface FsWriteRequest {
  path: string;
  content: string;
  /** Last modified time the client loaded; the write fails with 409 if the file changed since. */
  expectedMtimeMs?: number;
}

export interface FsWriteResponse {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface FsCreateRequest {
  /** Folder to create the file in. */
  directory: string;
  /** File name including its extension. */
  name: string;
  content?: string;
}

export interface FsMoveRequest {
  /** File to move (absolute path). */
  from: string;
  /** Folder to move it into (absolute path). */
  toDirectory: string;
}

export interface FsMoveResponse {
  /** Where the file was. */
  from: string;
  /** Where it is now. */
  path: string;
}

export interface FsSearchRequest {
  /** Workspace folders to search (absolute paths). */
  roots: string[];
  /** Case-insensitive text to find. */
  query: string;
  /** Also look inside text files, not just at names. */
  contents: boolean;
}

export interface FsSearchLine {
  /** 0-based line number. */
  line: number;
  /** The line's text (trimmed around the match if long). */
  text: string;
}

export interface FsSearchResult {
  path: string;
  kind: "file" | "directory";
  /** The query is in the file or folder name. */
  nameMatch: boolean;
  /** Matches inside the file (contents searches only). */
  contentMatches: number;
  /** The first few matching lines. */
  lines: FsSearchLine[];
}

export interface FsSearchResponse {
  results: FsSearchResult[];
  /** Stopped early (too many results, files or time); results are incomplete. */
  truncated: boolean;
  scannedFiles: number;
  elapsedMs: number;
}
