// Shared contract for the local filesystem API (/api/fs/*). Only available
// when the server runs on the user's machine (desktop app or local dev).

/** Every /api/fs request must send this header (blocks cross-site form/img requests). */
export const FS_CLIENT_HEADER = "X-MDC-Client";

/** Files with these extensions open in the editor and can be saved back to disk. */
export const EDITABLE_EXTENSIONS = {
  ".md": "md",
  ".markdown": "md",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
} as const;

export type EditableFileType = (typeof EDITABLE_EXTENSIONS)[keyof typeof EDITABLE_EXTENSIONS];

export function editableTypeOf(filePath: string): EditableFileType | null {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = filePath.slice(dot).toLowerCase() as keyof typeof EDITABLE_EXTENSIONS;
  return EDITABLE_EXTENSIONS[ext] ?? null;
}

export interface FsStatus {
  enabled: boolean;
  home: string;
  sep: "/" | "\\";
  /** True on Windows and macOS, where paths compare case-insensitively. */
  caseInsensitive: boolean;
}

export interface FsEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
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
