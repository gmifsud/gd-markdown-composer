import { test, expect } from "bun:test";
import { Text } from "@codemirror/state";
import { lineRangeInDoc, needsSourceForReveal } from "./reveal";

const d = Text.of(["a", "foo bar", ""]);

test("narrows to the query on the line", () => expect(lineRangeInDoc(d, 1, "BAR")).toEqual([6, 9]));

test("whole line without a query", () => expect(lineRangeInDoc(d, 1)).toEqual([2, 9]));

test("whole line when the query is not on it", () => expect(lineRangeInDoc(d, 1, "zzz")).toEqual([2, 9]));

test("clamps past the end", () => expect(lineRangeInDoc(d, 99)).toEqual([10, 10]));

test("a bare line jump needs the source when no editor is mounted", () => {
  expect(needsSourceForReveal({ line: 39 }, false)).toBe(true);
  expect(needsSourceForReveal({ line: 39 }, true)).toBe(false);
  // Headings and search matches can be shown in the preview alone.
  expect(needsSourceForReveal({ line: 3, heading: { text: "Intro", occurrence: 0 } }, false)).toBe(false);
  expect(needsSourceForReveal({ line: 3, query: "foo" }, false)).toBe(false);
});
