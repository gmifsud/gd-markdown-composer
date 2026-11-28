import { test, expect } from "bun:test";
import { buildQuickOpenItems, clampLine, paletteKeyFor, parsePaletteQuery, type KeyLike } from "./palette-logic";

test("prefix parsing", () => {
  expect(parsePaletteQuery(">  save")).toEqual({ mode: "commands", text: "save", line: null });
  expect(parsePaletteQuery("@intro")).toEqual({ mode: "headings", text: "intro", line: null });
  expect(parsePaletteQuery(":12")).toEqual({ mode: "line", text: "12", line: 12 });
  expect(parsePaletteQuery(":")).toEqual({ mode: "line", text: "", line: null });
  expect(parsePaletteQuery(":abc")).toEqual({ mode: "line", text: "abc", line: null });
  expect(parsePaletteQuery(" read ")).toEqual({ mode: "files", text: "read", line: null });
});

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, ...mods,
});

test("key matching", () => {
  expect(paletteKeyFor(key("p", { ctrlKey: true }))).toBe("files");
  expect(paletteKeyFor(key("p", { metaKey: true }))).toBe("files");
  expect(paletteKeyFor(key("P", { ctrlKey: true, shiftKey: true }))).toBe("commands");
  expect(paletteKeyFor(key("F1"))).toBe("commands");
  expect(paletteKeyFor(key("p", { ctrlKey: true, defaultPrevented: true }))).toBeNull();
  expect(paletteKeyFor(key("p", { ctrlKey: true, altKey: true }))).toBeNull();
  expect(paletteKeyFor(key("p"))).toBeNull();
});

test("clampLine", () => {
  expect(clampLine(0, 10)).toBe(1);
  expect(clampLine(99, 10)).toBe(10);
  expect(clampLine(4, 10)).toBe(4);
});

const docs = [{ id: 1, title: "Notes" }, { id: 2, title: "" }];

test("empty query: tabs then recents, deduped", () => {
  const items = buildQuickOpenItems({
    openTabs: ["db:1", "file:/a/b.md"], recent: ["file:/a/b.md", "file:/c/d.md"],
    documents: docs, folderFiles: ["/x/y.md"], query: "",
  });
  expect(items.map(i => [i.uri, i.source])).toEqual([
    ["db:1", "tab"], ["file:/a/b.md", "tab"], ["file:/c/d.md", "recent"],
  ]);
});

test("with a query: tabs, recents, documents, folder files, deduped by uri", () => {
  const items = buildQuickOpenItems({
    openTabs: ["file:/a/b.md"], recent: ["db:1"],
    documents: docs, folderFiles: ["/a/b.md", "/x/y.md"], query: "y",
  });
  expect(items.map(i => [i.uri, i.source])).toEqual([
    ["file:/a/b.md", "tab"], ["db:1", "recent"], ["db:2", "document"], ["file:/x/y.md", "folder"],
  ]);
});

test("labels and details", () => {
  const items = buildQuickOpenItems({
    openTabs: ["db:1", "db:2", "db:9", "file:/a/b.md"], recent: [], documents: docs, folderFiles: [], query: "",
  });
  expect(items.map(i => [i.label, i.detail])).toEqual([
    ["Notes", "Document"], ["Untitled", "Document"], ["Untitled", "Document"], ["b.md", "/a"],
  ]);
});
