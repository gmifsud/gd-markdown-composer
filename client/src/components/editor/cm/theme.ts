import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

// Every colour the source editor uses lives in this file (light theme only for now).

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Layout and chrome; `compact` matches the app's tighter-spacing toggle. */
export function editorTheme(compact: boolean) {
  return EditorView.theme({
    "&": {
      height: "100%",
      fontSize: "13px",
      color: "#374151",
      backgroundColor: "transparent",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: MONO,
      lineHeight: compact ? "1.375" : "1.625",
      overflow: "auto",
    },
    ".cm-content": {
      padding: compact ? "12px 20px" : "24px 32px",
      caretColor: "#111827",
    },
    ".cm-line": { padding: "0" },
    ".cm-activeLine": { backgroundColor: "rgba(0, 0, 0, 0.025)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "#dbeafe",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "#d1d5db",
      border: "none",
    },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#6b7280" },
    ".cm-placeholder": { color: "#d1d5db" },
    ".cm-find-match": { backgroundColor: "rgba(254, 240, 138, 0.8)", borderRadius: "2px" },
    ".cm-find-current": { backgroundColor: "rgba(253, 186, 116, 0.8)", borderRadius: "2px" },
    ".cm-front-matter-fold": {
      display: "block",
      margin: "0 0 4px",
      padding: "2px 8px",
      fontFamily: "inherit",
      fontSize: "11px",
      color: "#6b7280",
      backgroundColor: "#f3f4f6",
      border: "none",
      borderRadius: "4px",
      cursor: "pointer",
    },
    ".cm-front-matter-fold:hover": { color: "#111827", backgroundColor: "#e5e7eb" },
    ".cm-matchingBracket": { backgroundColor: "rgba(37, 99, 235, 0.12)", outline: "none" },
  });
}

/** Token colours for Markdown, JSON, YAML, HTML and XML. */
export const editorHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: t.heading, fontWeight: "600", color: "#111827" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "#2563eb" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "#9ca3af" },
  { tag: t.monospace, color: "#be185d" },
  { tag: t.quote, color: "#6b7280", fontStyle: "italic" },
  { tag: t.propertyName, color: "#0369a1" },
  { tag: t.string, color: "#15803d" },
  { tag: [t.number, t.bool, t.null], color: "#b45309" },
  { tag: t.comment, color: "#9ca3af", fontStyle: "italic" },
  { tag: t.tagName, color: "#7c3aed" },
  { tag: t.attributeName, color: "#0369a1" },
  { tag: t.keyword, color: "#7c3aed" },
]));
