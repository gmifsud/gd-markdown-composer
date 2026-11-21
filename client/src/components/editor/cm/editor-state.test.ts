import { test, expect } from "bun:test";
import { undo } from "@codemirror/commands";
import { language } from "@codemirror/language";
import {
  createEditorState, docText, lineSeparatorOf, reconfigure, restoreEditorState, type SourceEditorConfig,
} from "./editor-state";

const cfg: SourceEditorConfig = {
  fileType: "md",
  readOnly: false,
  wrap: true,
  compact: false,
  frontMatterHidden: false,
  onUnfoldFrontMatter() {},
  onDocChange() {},
};

test("CRLF round-trips byte for byte", () => {
  expect(docText(createEditorState("a\r\nb\r\n", cfg))).toBe("a\r\nb\r\n");
  expect(docText(createEditorState("a\nb", cfg))).toBe("a\nb");
});

test("new line breaks in a CRLF file are written as CRLF", () => {
  const s = createEditorState("a\r\nb", cfg);
  const typed = s.update({ changes: { from: 1, insert: s.lineBreak } }).state;
  expect(docText(typed)).toBe("a\r\n\r\nb");
  const pasted = s.update({ changes: { from: 1, insert: "x\ny" } }).state;
  expect(docText(pasted)).toBe("ax\r\ny\r\nb");
});

test("editor positions count a CRLF line break as one", () =>
  expect(createEditorState("a\r\nb", cfg).sliceDoc(2, 3)).toBe("b"));

test("lineSeparatorOf", () => {
  expect(lineSeparatorOf("x\r\ny\nz")).toBe("\r\n");
  expect(lineSeparatorOf("x\ny\r\n")).toBe("\n");
  expect(lineSeparatorOf("x")).toBe("\n");
});

test("languages by file type", () => {
  expect(createEditorState("", cfg).facet(language)?.name).toBe("markdown");
  expect(createEditorState("", { ...cfg, fileType: "json" }).facet(language)?.name).toBe("json");
  expect(createEditorState("", { ...cfg, fileType: "yaml" }).facet(language)?.name).toBe("yaml");
  expect(createEditorState("", { ...cfg, fileType: "text" }).facet(language)).toBeNull();
});

test("readOnly can be reconfigured", () => {
  const s = createEditorState("x", { ...cfg, readOnly: true });
  expect(s.readOnly).toBe(true);
  expect(s.update({ effects: reconfigure(cfg) }).state.readOnly).toBe(false);
});

test("Format (whole-document replace) is undoable", () => {
  let s = createEditorState('{"a":1}', { ...cfg, fileType: "json" });
  s = s.update({ changes: { from: 0, to: s.doc.length, insert: '{\n  "a": 1\n}' } }).state;
  undo({ state: s, dispatch: tr => { s = tr.state; } });
  expect(docText(s)).toBe('{"a":1}');
});

test("restoreEditorState keeps undo history", () => {
  let s = createEditorState("abc", cfg);
  s = s.update({ changes: { from: 3, insert: "d" } }).state;
  let r = restoreEditorState(s, "abcd", cfg)!;
  undo({ state: r, dispatch: tr => { r = tr.state; } });
  expect(docText(r)).toBe("abc");
  expect(restoreEditorState(s, "different", cfg)).toBeNull();
});

test("restoreEditorState keeps a CRLF document byte for byte", () => {
  const s = createEditorState("a\r\nb", cfg);
  expect(docText(restoreEditorState(s, "a\r\nb", cfg)!)).toBe("a\r\nb");
});
