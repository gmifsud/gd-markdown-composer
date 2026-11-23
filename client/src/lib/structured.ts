import { parseAllDocuments } from "yaml";
import type { Diagnostic } from "@codemirror/lint";

/** Result of checking JSON or YAML text. */
export interface Analysis {
  /** Error message, or null when the text parses. */
  error: string | null;
  /** Formatted text; empty when the input is empty or invalid. */
  formatted: string;
}

export const EMPTY_ANALYSIS: Analysis = { error: null, formatted: "" };

export function analyzeJson(text: string): Analysis {
  if (!text.trim()) return EMPTY_ANALYSIS;
  try {
    return { error: null, formatted: JSON.stringify(JSON.parse(text), null, 2) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid JSON", formatted: "" };
  }
}

export function analyzeYaml(text: string): Analysis {
  if (!text.trim()) return EMPTY_ANALYSIS;
  // parseAllDocuments handles multi-document files (separated by ---) and
  // keeps comments, so formatting only normalises indentation and spacing.
  const parsed = parseAllDocuments(text);
  const docs = Array.isArray(parsed) ? parsed : [parsed];
  const error = docs.flatMap(doc => doc.errors)[0];
  if (error) {
    return { error: error.message.split("\n")[0].replace(/:$/, ""), formatted: "" };
  }
  return {
    error: null,
    formatted: docs.map(doc => doc.toString({ indent: 2, lineWidth: 0 })).join(""),
  };
}

/**
 * Where a JSON.parse error points in `text`. V8 (Chromium, Electron) says
 * "at position N" and/or "line L column C"; JavaScriptCore gives no position,
 * so the start of the text is used.
 */
export function jsonErrorOffset(message: string, text: string): number {
  const clamp = (n: number) => Math.max(0, Math.min(n, text.length));
  const position = /at position (\d+)/.exec(message);
  if (position) return clamp(Number(position[1]));
  const lineColumn = /line (\d+) column (\d+)/.exec(message);
  if (lineColumn) {
    let lineStart = 0;
    for (let line = 1; line < Number(lineColumn[1]); line++) {
      const next = text.indexOf("\n", lineStart);
      if (next < 0) break;
      lineStart = next + 1;
    }
    return clamp(lineStart + Number(lineColumn[2]) - 1);
  }
  return 0;
}

/** A one-character (at least) span at `from`, kept inside the text. */
function span(from: number, to: number, length: number): { from: number; to: number } {
  let start = Math.max(0, Math.min(from, length));
  let end = Math.max(start, Math.min(to, length));
  if (end === start) {
    if (end < length) end++;
    else if (start > 0) start--;
  }
  return { from: start, to: end };
}

/** Inline error for invalid JSON (empty text and valid JSON have none). */
export function jsonDiagnostics(text: string): Diagnostic[] {
  const { error } = analyzeJson(text);
  if (!error) return [];
  const at = jsonErrorOffset(error, text);
  return [{ ...span(at, at + 1, text.length), severity: "error", message: error }];
}

/** Inline errors for invalid YAML, one per parser error across all documents. */
export function yamlDiagnostics(text: string): Diagnostic[] {
  if (!text.trim()) return [];
  const parsed = parseAllDocuments(text);
  const docs = Array.isArray(parsed) ? parsed : [parsed];
  return docs.flatMap(doc => doc.errors).map(error => {
    const [from, to] = error.pos;
    return {
      ...span(from, Math.max(to, from + 1), text.length),
      severity: "error" as const,
      message: error.message.split("\n")[0].replace(/:$/, ""),
    };
  });
}
