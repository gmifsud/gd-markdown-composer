import { test, expect } from "bun:test";
import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { findHighlightField, findInDoc, replaceMatchesSpec, setFindHighlights } from "./find";

const doc = (s: string) => EditorState.create({ doc: s }).doc;

test("case-insensitive by default", () =>
  expect(findInDoc(doc("Foo foo FOO"), "foo", false)).toEqual([[0, 3], [4, 7], [8, 11]]));

test("match case", () => expect(findInDoc(doc("Foo foo FOO"), "foo", true)).toEqual([[4, 7]]));

test("from skips earlier matches", () => expect(findInDoc(doc("ab ab"), "ab", false, 1)).toEqual([[3, 5]]));

test("empty query", () => expect(findInDoc(doc("abc"), "", false)).toEqual([]));

test("CRLF documents use editor positions", () => {
  const s = EditorState.create({ doc: "a\r\nfoo", extensions: EditorState.lineSeparator.of("\r\n") });
  const [m] = findInDoc(s.doc, "foo", false);
  expect(s.sliceDoc(m[0], m[1])).toBe("foo");
});

test("replace all is one undo step", () => {
  let s = EditorState.create({ doc: "a x b x", extensions: history() });
  s = s.update(replaceMatchesSpec([[2, 3], [6, 7]], "yy")).state;
  expect(s.doc.toString()).toBe("a yy b yy");
  undo({ state: s, dispatch: tr => { s = tr.state; } });
  expect(s.doc.toString()).toBe("a x b x");
});

test("highlights map through edits", () => {
  let s = EditorState.create({ doc: "x x", extensions: findHighlightField });
  s = s.update({ effects: setFindHighlights.of({ ranges: [[0, 1], [2, 3]], current: 1 }) }).state;
  s = s.update({ changes: { from: 0, insert: "zz" } }).state;
  const marks: [number, number, string][] = [];
  s.field(findHighlightField).between(0, s.doc.length, (f, t, d) => { marks.push([f, t, d.spec.class]); });
  expect(marks).toEqual([[2, 3, "cm-find-match"], [4, 5, "cm-find-current"]]);
});

test("clearing highlights", () => {
  let s = EditorState.create({ doc: "x", extensions: findHighlightField });
  s = s.update({ effects: setFindHighlights.of({ ranges: [[0, 1]], current: 0 }) }).state;
  s = s.update({ effects: setFindHighlights.of(null) }).state;
  expect(s.field(findHighlightField).size).toBe(0);
});
