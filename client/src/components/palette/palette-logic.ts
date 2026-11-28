import { baseName, dirName } from "@/lib/fs-api";
import { dbUri, fileUri, parseUri } from "@/lib/workspace";

/**
 * Pure logic behind the palette: which mode the typed prefix selects, which
 * keys open it, and the Quick Open rows built from tabs, recents, documents
 * and folder search results.
 */

export type PaletteMode = "files" | "commands" | "headings" | "line";

export interface PaletteQuery {
  mode: PaletteMode;
  /** The input without its prefix, trimmed. */
  text: string;
  /** Line mode: the typed 1-based line number, or null when it isn't a number. */
  line: number | null;
}

const PREFIXES: Record<string, PaletteMode> = { ">": "commands", "@": "headings", ":": "line" };

export function parsePaletteQuery(input: string): PaletteQuery {
  const mode = PREFIXES[input[0]];
  if (!mode) return { mode: "files", text: input.trim(), line: null };
  const text = input.slice(1).trim();
  return { mode, text, line: mode === "line" && /^\d+$/.test(text) ? Number(text) : null };
}

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/** Ctrl/Cmd+P → files; Ctrl/Cmd+Shift+P or F1 → commands; anything already handled → null. */
export function paletteKeyFor(e: KeyLike): "files" | "commands" | null {
  if (e.defaultPrevented || e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "p") return e.shiftKey ? "commands" : "files";
  if (e.key === "F1" && !mod && !e.shiftKey) return "commands";
  return null;
}

/** A 1-based line clamped into 1..lineCount. */
export function clampLine(line: number, lineCount: number) {
  return Math.max(1, Math.min(line, Math.max(1, lineCount)));
}

export interface QuickOpenItem {
  uri: string;
  label: string;
  /** Muted text after the name: the parent folder, or "Document". */
  detail: string;
  source: "tab" | "recent" | "document" | "folder";
}

export function buildQuickOpenItems(src: {
  openTabs: string[];
  recent: string[];
  documents: { id: number; title: string }[];
  folderFiles: string[];
  query: string;
}): QuickOpenItem[] {
  const titles = new Map(src.documents.map(d => [d.id, d.title]));
  const seen = new Set<string>();
  const items: QuickOpenItem[] = [];
  const add = (uri: string, source: QuickOpenItem["source"]) => {
    if (seen.has(uri)) return;
    const ref = parseUri(uri);
    if (!ref) return;
    seen.add(uri);
    items.push(ref.kind === "db"
      ? { uri, label: titles.get(ref.id) || "Untitled", detail: "Document", source }
      : { uri, label: baseName(ref.path), detail: dirName(ref.path), source });
  };

  src.openTabs.forEach(u => add(u, "tab"));
  src.recent.forEach(u => add(u, "recent"));
  if (src.query.trim()) {
    src.documents.forEach(d => add(dbUri(d.id), "document"));
    src.folderFiles.forEach(p => add(fileUri(p), "folder"));
  }
  return items;
}
