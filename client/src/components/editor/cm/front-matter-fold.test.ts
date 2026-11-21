import { test, expect } from "bun:test";
import { EditorState, Text } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { frontMatterEnd, frontMatterField, frontMatterFold, setFrontMatterHidden } from "./front-matter-fold";

const FM = "---\ntitle: x\n---\n"; // 17 characters
const DOC = FM + "Body";

const make = (doc: string, hidden = true) =>
  EditorState.create({ doc, extensions: [history(), frontMatterFold({ initiallyHidden: hidden, onUnfold() {} })] });

test("frontMatterEnd", () => {
  expect(frontMatterEnd(Text.of(DOC.split("\n")))).toBe(17);
  expect(frontMatterEnd(Text.of(["no", "front matter"]))).toBe(0);
});

test("typing at the start of the body is allowed", () =>
  expect(make(DOC).update({ changes: { from: 17, insert: "X" } }).state.doc.toString()).toBe(FM + "XBody"));

test("deleting the line break before the body is blocked", () =>
  expect(make(DOC).update({ changes: { from: 16, to: 17 } }).state.doc.toString()).toBe(DOC));

test("select all + delete keeps the hidden front matter", () =>
  expect(make(DOC).update({ changes: { from: 0, to: DOC.length } }).state.doc.toString()).toBe(FM));

test("typing over a select-all lands in the body", () =>
  expect(make(DOC).update({ changes: { from: 0, to: DOC.length, insert: "x" } }).state.doc.toString()).toBe(FM + "x"));

test("typing at the very start goes after the hidden block", () =>
  expect(make(DOC).update({ changes: { from: 0, insert: "x" } }).state.doc.toString()).toBe(FM + "xBody"));

test("undo of a front-matter edit still works while folded", () => {
  let s = make(DOC, false).update({ changes: { from: 11, to: 12, insert: "y" } }).state; // title: x → title: y
  s = s.update({ effects: setFrontMatterHidden.of(true) }).state;
  undo({ state: s, dispatch: tr => { s = tr.state; } });
  expect(s.doc.toString()).toBe(DOC);
});

test("nothing is protected while unfolded", () =>
  expect(make(DOC, false).update({ changes: { from: 0, to: DOC.length } }).state.doc.toString()).toBe(""));

test("folding recomputes the end; unfolding clears protection", () => {
  let s = make("Body", false).update({ changes: { from: 0, insert: FM } }).state;
  s = s.update({ effects: setFrontMatterHidden.of(true) }).state;
  expect(s.field(frontMatterField)).toEqual({ hidden: true, end: 17 });
  s = s.update({ effects: setFrontMatterHidden.of(false) }).state;
  expect(s.update({ changes: { from: 0, to: 4 } }).state.doc.toString()).toBe(s.doc.sliceString(4));
});

test("filter:false replacements go through and recompute the end", () => {
  const s = make(DOC).update({ changes: { from: 0, to: DOC.length, insert: "---\na: 1\n---\nNew" }, filter: false }).state;
  expect(s.doc.toString()).toBe("---\na: 1\n---\nNew");
  expect(s.field(frontMatterField).end).toBe(13);
});

test("CRLF documents measure the block in editor positions", () => {
  const s = EditorState.create({
    doc: "---\r\ntitle: x\r\n---\r\nBody",
    extensions: [EditorState.lineSeparator.of("\r\n"), frontMatterFold({ initiallyHidden: true, onUnfold() {} })],
  });
  expect(s.field(frontMatterField).end).toBe(17);
  expect(s.sliceDoc(17)).toBe("Body");
});
