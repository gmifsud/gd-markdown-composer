import { test, expect } from "bun:test";
import { EditorSelection, EditorState, type StateCommand } from "@codemirror/state";
import { insertLink, markdownFormattingKeymap, setHeading, toggleInlineMarkup } from "./markdown-commands";

function run(cmd: StateCommand, doc: string, from: number, to = from) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to),
    extensions: EditorState.allowMultipleSelections.of(true),
  });
  cmd({ state, dispatch: tr => { state = tr.state; } });
  return { doc: state.doc.toString(), sel: [state.selection.main.from, state.selection.main.to] };
}

test("bold wraps the selection", () =>
  expect(run(toggleInlineMarkup("**"), "a word b", 2, 6)).toEqual({ doc: "a **word** b", sel: [4, 8] }));

test("bold unwraps when the inner text is selected", () =>
  expect(run(toggleInlineMarkup("**"), "a **word** b", 4, 8)).toEqual({ doc: "a word b", sel: [2, 6] }));

test("bold unwraps when the markers are selected too", () =>
  expect(run(toggleInlineMarkup("**"), "a **word** b", 2, 10)).toEqual({ doc: "a word b", sel: [2, 6] }));

test("empty selection inserts a pair with the cursor inside", () =>
  expect(run(toggleInlineMarkup("**"), "ab", 1)).toEqual({ doc: "a****b", sel: [3, 3] }));

test("italic does not unwrap bold markers", () =>
  expect(run(toggleInlineMarkup("*"), "**w**", 2, 3)).toEqual({ doc: "***w***", sel: [3, 4] }));

test("each selection range is toggled", () => {
  const s = EditorState.create({
    doc: "a b",
    selection: EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.range(2, 3)]),
    extensions: EditorState.allowMultipleSelections.of(true),
  });
  let out = s;
  toggleInlineMarkup("**")({ state: s, dispatch: tr => { out = tr.state; } });
  expect(out.doc.toString()).toBe("**a** **b**");
});

test("link wraps text and selects the url placeholder", () =>
  expect(run(insertLink, "see docs", 4, 8)).toEqual({ doc: "see [docs](url)", sel: [11, 14] }));

test("link from a selected URL puts the cursor in the text", () =>
  expect(run(insertLink, "go https://x.io", 3, 15)).toEqual({ doc: "go [](https://x.io)", sel: [4, 4] }));

test("link with an empty selection", () =>
  expect(run(insertLink, "a", 1)).toEqual({ doc: "a[](url)", sel: [2, 2] }));

test("setHeading changes, adds and removes #", () => {
  expect(run(setHeading(2), "# Title", 3).doc).toBe("## Title");
  expect(run(setHeading(1), "plain", 0).doc).toBe("# plain");
  expect(run(setHeading(0), "### T", 4).doc).toBe("T");
  expect(run(setHeading(3), "a\nb", 0, 3).doc).toBe("### a\n### b");
});

test("keymap bindings", () =>
  expect(markdownFormattingKeymap.map(k => k.key)).toEqual(
    ["Mod-b", "Mod-i", "Mod-e", "Mod-k", "Mod-Alt-0", "Mod-Alt-1", "Mod-Alt-2", "Mod-Alt-3", "Mod-Alt-4", "Mod-Alt-5", "Mod-Alt-6"]));
