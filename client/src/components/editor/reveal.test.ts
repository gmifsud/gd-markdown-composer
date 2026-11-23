import { test, expect } from "bun:test";
import { Text } from "@codemirror/state";
import { lineRangeInDoc } from "./reveal";

const d = Text.of(["a", "foo bar", ""]);

test("narrows to the query on the line", () => expect(lineRangeInDoc(d, 1, "BAR")).toEqual([6, 9]));

test("whole line without a query", () => expect(lineRangeInDoc(d, 1)).toEqual([2, 9]));

test("whole line when the query is not on it", () => expect(lineRangeInDoc(d, 1, "zzz")).toEqual([2, 9]));

test("clamps past the end", () => expect(lineRangeInDoc(d, 99)).toEqual([10, 10]));
