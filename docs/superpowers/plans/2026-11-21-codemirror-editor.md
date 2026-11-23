# CodeMirror 6 Source Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain `<textarea>` source editor with CodeMirror 6. Users get syntax highlighting, formatting shortcuts, find and replace, inline JSON/YAML errors, and undo that survives Format. No byte the user didn't edit may change.

**Architecture:** Pure CodeMirror extensions (markdown commands, front-matter folding, find highlights, JSON/YAML diagnostics) live in `client/src/components/editor/cm/` and are unit-tested on `EditorState` with `bun test`. No DOM is needed. A thin `SourceEditor` React wrapper owns the `EditorView`. It keeps the editor's state (undo history, scroll position) across remounts when the layout changes. `editor.tsx` keeps React `content` state for autosave, preview and the Outline. CodeMirror is the editing surface, and all source-side positions (find, reveal, front matter) are computed **in CodeMirror document space**, not on the JavaScript string.

**Tech Stack:** React 18, TypeScript 5.6, Bun 1.4.2 (`bun test`), Vite 7, `@codemirror/{state,view,commands,language,search,lint,lang-markdown,lang-json,lang-yaml,lang-html,lang-xml,language-data}`, `@lezer/highlight`.

**Spec:** [docs/competitive-analysis.md §2](../../competitive-analysis.md) (engine choice) and [docs/editor-gap-analysis.md tasks T4.1–T4.4, P6](../../editor-gap-analysis.md).

## Global Constraints

- The editor must not change bytes the user did not edit. CRLF files stay CRLF, and no trailing newline is added or removed.
- `bun run check` (tsc) exits 0 after every task, and `bun test client/src` passes after every task.
- The existing global shortcuts keep working from inside the editor: Ctrl/Cmd+S (save), Ctrl/Cmd+F and F3/Shift+F3 (find), Ctrl/Cmd+Shift+F (explorer content search), and Ctrl/Cmd+0/=/- (Electron zoom). Do not add `searchKeymap` from `@codemirror/search`, because it would take over Ctrl+F.
- Autosave behaviour (`useAutosave`, `pending-saves.ts`) is unchanged. The editor reports every document change through `onDocChange(text)` → `setContent`.
- Light theme only. Dark mode is a separate roadmap item, so put every editor colour in `cm/theme.ts` and nowhere else.
- Add dependencies with `bun add` (caret ranges, matching `package.json` style).
- **Git:** the user commits and pushes themselves (GitKraken). At each "Commit" step, stage the listed files, show the suggested message, and **ask before committing**. Never push, and never stage `.serena/`. Ask before creating the branch `feature/codemirror-editor` from the current HEAD.
- Out of scope: regex or whole-word find, a formatting toolbar, Live Preview decorations, vim mode, dark theme, scroll sync, Milkdown.

## Review Focus

1. **A Windows CRLF file is edited and saved.** Expected: every untouched line ending is still `\r\n`. (Test in Task 5. Manual byte check in Task 6.)
2. **Ctrl+A then Delete, or Backspace at the start of the body, while the front matter is folded.** Expected: the hidden front matter survives, and only visible text is deleted. (Tests in Task 3.)
3. **Undo after Format, after switching Edit/Split/Preview, or after switching tabs on mobile.** Expected: Ctrl+Z restores the earlier text. (Tests in Task 5. Manual check in Task 6.)
4. **Replace in a read-only file, or in the preview-only layout.** Expected: the replace controls are absent, and Ctrl+H only opens find. (Task 7 `canReplace`, manual check.)
5. **Replace where the replacement contains the query** (`a` → `aa`). Expected: "Replace" moves on to the next original match instead of replacing the same spot forever. (Task 7 manual check.)

---

### Task 1: Structured-text analysis and diagnostics module

**Files:**
- Create: `client/src/lib/structured.ts`
- Test: `client/src/lib/structured.test.ts`
- Modify: `client/src/components/editor/editor.tsx:3,54-86`. Remove `Analysis`, `EMPTY_ANALYSIS`, `analyzeJson` and `analyzeYaml` and import them from `@/lib/structured` instead.
- Modify: `package.json` / `bun.lock` (all CodeMirror deps, installed once here)

**Interfaces:**
- Produces:
  - `interface Analysis { error: string | null; formatted: string }` and `EMPTY_ANALYSIS` (moved unchanged)
  - `analyzeJson(text: string): Analysis`, `analyzeYaml(text: string): Analysis` (moved unchanged)
  - `jsonErrorOffset(message: string, text: string): number`
  - `jsonDiagnostics(text: string): Diagnostic[]`, `yamlDiagnostics(text: string): Diagnostic[]` (`Diagnostic` from `@codemirror/lint`, type import)

- [ ] **Step 0: Record the bundle baseline**

Run: `bun run build`, then `ls -l dist/public/assets/*.js`. Note the size of the entry chunk (`index-*.js`) in the Task 8 notes.

- [ ] **Step 1: Install dependencies**

Run: `bun add @codemirror/state @codemirror/view @codemirror/commands @codemirror/language @codemirror/search @codemirror/lint @codemirror/lang-markdown @codemirror/lang-json @codemirror/lang-yaml @codemirror/lang-html @codemirror/lang-xml @codemirror/language-data @lezer/highlight`
Expected: `package.json` lists all 13 dependencies.

- [ ] **Step 2: Write the failing tests** in `structured.test.ts` (`import { test, expect } from "bun:test"`)

```ts
test("jsonErrorOffset reads V8 'at position'", () =>
  expect(jsonErrorOffset("Unexpected token } in JSON at position 15 (line 2 column 3)", "x".repeat(20))).toBe(15));
test("jsonErrorOffset reads line/column", () =>
  expect(jsonErrorOffset("Expected ',' or '}' after property value in JSON at line 2 column 3", '{\n  "a" 1}')).toBe(4));
test("jsonErrorOffset falls back to 0 (JavaScriptCore messages have no position)", () =>
  expect(jsonErrorOffset("JSON Parse error: Expected '}'", "{")).toBe(0));
test("jsonErrorOffset clamps to the text length", () =>
  expect(jsonErrorOffset("at position 99", "abc")).toBe(3));
test("jsonDiagnostics: none for valid or empty", () => {
  expect(jsonDiagnostics('{"a": 1}')).toEqual([]);
  expect(jsonDiagnostics("  ")).toEqual([]);
});
test("jsonDiagnostics: one error inside the text", () => {
  const d = jsonDiagnostics('{"a": }');
  expect(d).toHaveLength(1);
  expect(d[0].severity).toBe("error");
  expect(d[0].from).toBeGreaterThanOrEqual(0);
  expect(d[0].to).toBeLessThanOrEqual(7);
  expect(d[0].to).toBeGreaterThan(d[0].from);
});
test("yamlDiagnostics: error for an unclosed flow sequence", () => {
  const d = yamlDiagnostics("a: 1\nb: [");
  expect(d.length).toBeGreaterThanOrEqual(1);
  expect(d[0].severity).toBe("error");
  expect(d[0].to).toBeLessThanOrEqual(10);
});
test("yamlDiagnostics: apostrophes are fine", () =>
  expect(yamlDiagnostics("a: it's fine\n# it's a comment\n")).toEqual([]));
test("analyzeYaml keeps nesting", () =>
  expect(analyzeYaml("a:\n    b: 1\n").formatted).toBe("a:\n  b: 1\n"));
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `bun test client/src/lib/structured.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 4: Implement `structured.ts`**

- `jsonErrorOffset`: if the message has `at position N`, use N. Otherwise, if it has `line L column C`, use the offset of line L plus C−1. Otherwise use 0. Clamp the result to `[0, text.length]`.
- `jsonDiagnostics`: if `analyzeJson` reports an error, return one diagnostic from `offset` to `min(offset + 1, len)`. When offset == len and len > 0, use `[len − 1, len]`. Its message is the analysis error.
- `yamlDiagnostics`: return one diagnostic per `YAMLError` across `parseAllDocuments(text)`, from `pos[0]` to `max(pos[1], pos[0] + 1)`, clamped to `[0, len]`, with the first line of the error message.

- [ ] **Step 5: Run the tests and the type check**

Run: `bun test client/src/lib/structured.test.ts && bun run check`
Expected: all tests PASS and tsc exits 0.

- [ ] **Step 6: Commit** (ask first)

`git add package.json bun.lock client/src/lib/structured.ts client/src/lib/structured.test.ts client/src/components/editor/editor.tsx`. Suggested message: `refactor: move JSON/YAML analysis to lib/structured and add diagnostics`

---

### Task 2: Markdown formatting commands

**Files:**
- Create: `client/src/components/editor/cm/markdown-commands.ts`
- Test: `client/src/components/editor/cm/markdown-commands.test.ts`

**Interfaces:**
- Produces:
  - `toggleInlineMarkup(marker: string): StateCommand`
  - `insertLink: StateCommand`
  - `setHeading(level: 0 | 1 | 2 | 3 | 4 | 5 | 6): StateCommand` (0 = plain paragraph)
  - `markdownFormattingKeymap: readonly KeyBinding[]`

- [ ] **Step 1: Write the failing tests**

Helper: `run(cmd, doc, from, to = from)`. It builds `EditorState.create({ doc, selection: EditorSelection.single(from, to), extensions: EditorState.allowMultipleSelections.of(true) })`, runs `cmd`, and returns `{ doc, sel: [main.from, main.to] }`.

```ts
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
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `bun test client/src/components/editor/cm/markdown-commands.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement**

- Use `state.changeByRange` so that every selection range is handled in one transaction.
- Unwrap only when the surrounding characters are exactly `marker` **and** are not part of a longer run of the same character. This is the rule the italic test pins.
- A selection counts as a URL when it matches `/^(https?:\/\/|mailto:|\.{0,2}\/)\S+$/`.
- `setHeading` replaces the `^#{1,6}\s+` prefix on each line the selection touches.
- Keymap: `Mod-b` → `"**"`, `Mod-i` → `"*"`, `Mod-e` → `` "`" ``, `Mod-k` → `insertLink`, `Mod-Alt-N` → `setHeading(N)`. Each `run` is wrapped so it works on a view, e.g. `({ state, dispatch }) => cmd({ state, dispatch })`.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `bun test client/src/components/editor/cm/markdown-commands.test.ts && bun run check`
Expected: PASS and tsc exits 0.

- [ ] **Step 5: Commit** (ask first)

Suggested message: `feat: markdown formatting commands for the source editor`

---

### Task 3: Front-matter folding that cannot be deleted by accident

**Files:**
- Create: `client/src/components/editor/cm/front-matter-fold.ts`
- Test: `client/src/components/editor/cm/front-matter-fold.test.ts`

**Interfaces:**
- Consumes: `splitFrontMatter` from `@/lib/markdown-source` (its regex defines what front matter is)
- Produces:
  - `frontMatterEnd(doc: Text): number`: the position just after the block, or 0 when there is none. Scans `doc.sliceString(0, Math.min(doc.length, 200_000))`, and the block is measured in **CodeMirror positions**, where a line break counts as 1.
  - `setFrontMatterHidden: StateEffectType<boolean>`
  - `frontMatterField: StateField<{ hidden: boolean; end: number }>`
  - `frontMatterFold(opts: { initiallyHidden: boolean; onUnfold(): void }): Extension`, which bundles the field, a block replace decoration, atomic ranges and a change filter

- [ ] **Step 1: Write the failing tests**

Helper: `make(doc, hidden = true)` → `EditorState.create({ doc, extensions: [history(), frontMatterFold({ initiallyHidden: hidden, onUnfold() {} })] })`. Fixture: `FM = "---\ntitle: x\n---\n"` (end = 17), `DOC = FM + "Body"`.

```ts
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
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `bun test client/src/components/editor/cm/front-matter-fold.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement**

- Field update rule: recompute `end` with `frontMatterEnd(tr.state.doc)` when a `setFrontMatterHidden` effect arrives, or when `hidden && tr.docChanged && tr.changes.touchesRange(0, end)`. The second case only happens with `filter: false`. Otherwise keep `end`, because changes after `end` don't move it.
- Change filter (`EditorState.changeFilter`): while `hidden && end > 0`, return suppressed ranges so that any change starting before `end` is dropped, and an insertion at exactly `end` is kept. Use the tests to settle the exact boundary.
- Decoration: provide it from the field through `EditorView.decorations.from(...)`. It is a `Decoration.replace({ block: true, widget })` over `[0, end − 1]`, so that it ends at the closing `---` line's end. If the document ends right after the block with no line break, it covers `[0, end]`. Feed the same range to `EditorView.atomicRanges`.
- Widget `FrontMatterWidget(lines, onUnfold)`: a `<button class="cm-front-matter-fold">` with the text `Front matter · {lines} lines — click to show`, which calls `onUnfold` on mousedown. `eq` compares `lines`.
- If `bun test` fails on importing `@codemirror/view` with `document is not defined`: run `bun add -d @happy-dom/global-registrator` and add `bunfig.toml` with `[test] preload = ["./client/src/test-setup.ts"]`, where the setup file calls `GlobalRegistrator.register()`.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `bun test client/src/components/editor/cm/front-matter-fold.test.ts && bun run check`
Expected: PASS and tsc exits 0.

- [ ] **Step 5: Commit** (ask first)

Suggested message: `feat: protected front-matter folding for the source editor`

---

### Task 4: Find and replace in CodeMirror document space

**Files:**
- Create: `client/src/components/editor/cm/find.ts`
- Test: `client/src/components/editor/cm/find.test.ts`

**Interfaces:**
- Produces:
  - `type Range = [start: number, end: number]` (moves here from `find.tsx`)
  - `findInDoc(doc: Text, query: string, matchCase: boolean, from?: number): Range[]`. Matches starting before `from` (default 0) are left out. At most 10,000 matches.
  - `setFindHighlights: StateEffectType<{ ranges: Range[]; current: number } | null>`
  - `findHighlightField: StateField<DecorationSet>`. It provides `EditorView.decorations`, uses mark classes `cm-find-match` and `cm-find-current`, and maps through changes.
  - `replaceMatchesSpec(ranges: Range[], replacement: string): TransactionSpec`. One transaction (so one undo step), with `userEvent: "input.replace"`.

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `bun test client/src/components/editor/cm/find.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement.** Use `SearchCursor(doc, query, from, doc.length, matchCase ? undefined : s => s.toLowerCase())`. That is the same normalisation `@codemirror/search` uses.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `bun test client/src/components/editor/cm/find.test.ts && bun run check`
Expected: PASS and tsc exits 0.

- [ ] **Step 5: Commit** (ask first)

Suggested message: `feat: find/replace primitives in editor document space`

---

### Task 5: Editor state factory, languages, theme and the `SourceEditor` component

**Files:**
- Create: `client/src/components/editor/cm/languages.ts`, `cm/theme.ts`, `cm/editor-state.ts`, `client/src/components/editor/source-editor.tsx`
- Test: `client/src/components/editor/cm/editor-state.test.ts`

**Interfaces:**
- Consumes: Task 1 `jsonDiagnostics`/`yamlDiagnostics`; Task 2 `markdownFormattingKeymap`; Task 3 `frontMatterFold`, `setFrontMatterHidden`; Task 4 `findHighlightField`, `setFindHighlights`, `Range`.
- Produces:
  - `languageFor(fileType: FileKind): Extension`. `md` → `markdown({ base: markdownLanguage, codeLanguages: languages })`; `json` → `json()`; `yaml` → `yaml()`; `html` → `html()`; `drawio` → `xml()`; anything else → `[]`.
  - `editorTheme(compact: boolean): Extension` and `editorHighlight: Extension`
  - `interface SourceEditorConfig { fileType: FileKind; readOnly: boolean; wrap: boolean; compact: boolean; placeholder?: string; frontMatterHidden: boolean; onUnfoldFrontMatter(): void; onDocChange(text: string): void }`
  - `lineSeparatorOf(text: string): "\r\n" | "\n"`: `"\r\n"` when the first line break is CRLF
  - `createEditorState(text: string, config: SourceEditorConfig): EditorState`
  - `reconfigure(config: SourceEditorConfig): StateEffect<unknown>[]`: compartment updates for readOnly, wrap and compact
  - `restoreEditorState(saved: EditorState, text: string, config: SourceEditorConfig): EditorState | null`: the saved state with fresh extensions (`StateEffect.reconfigure`) when `saved.doc.toString() === text`, otherwise `null`
  - `interface SavedEditor { state: EditorState; scroll: StateEffect<unknown> }` (all of the above live in `cm/editor-state.ts`)
  - In `source-editor.tsx`: `SourceEditor(props: SourceEditorConfig & { value: string; viewRef: MutableRefObject<EditorView | null>; cache: MutableRefObject<SavedEditor | null>; highlights?: { ranges: Range[]; current: number }; invalid?: boolean; className?: string; "data-testid"?: string }): JSX.Element`

- [ ] **Step 1: Write the failing tests**

`cfg` is a `SourceEditorConfig` with `fileType: "md"`, `readOnly: false`, `wrap: true`, `compact: false`, `frontMatterHidden: false`, and no-op callbacks.

```ts
test("CRLF round-trips byte for byte", () => {
  expect(createEditorState("a\r\nb\r\n", cfg).doc.toString()).toBe("a\r\nb\r\n");
  expect(createEditorState("a\nb", cfg).doc.toString()).toBe("a\nb");
});
test("lineSeparatorOf", () => {
  expect(lineSeparatorOf("x\r\ny\nz")).toBe("\r\n");
  expect(lineSeparatorOf("x")).toBe("\n");
});
test("languages by file type", () => {
  expect(createEditorState("", cfg).facet(language)?.name).toBe("markdown");
  expect(createEditorState("", { ...cfg, fileType: "json" }).facet(language)?.name).toBe("json");
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
  expect(s.doc.toString()).toBe('{"a":1}');
});
test("restoreEditorState keeps undo history", () => {
  let s = createEditorState("abc", cfg);
  s = s.update({ changes: { from: 3, insert: "d" } }).state;
  let r = restoreEditorState(s, "abcd", cfg)!;
  undo({ state: r, dispatch: tr => { r = tr.state; } });
  expect(r.doc.toString()).toBe("abc");
  expect(restoreEditorState(s, "different", cfg)).toBeNull();
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `bun test client/src/components/editor/cm/editor-state.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement `languages.ts`, `theme.ts` and `editor-state.ts`**

Extensions, in this order:
- `EditorState.lineSeparator.of(lineSeparatorOf(text))`, `history()`, `drawSelection()`, `highlightActiveLine()`
- `lineNumbers()` + `highlightActiveLineGutter()` for every type except `md`
- `bracketMatching()`, `indentOnInput()`
- `keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab])`, plus `Prec.high(keymap.of(markdownFormattingKeymap))` for `md`. The high priority beats `defaultKeymap`'s `Mod-i` (selectParentSyntax).
- `languageFor`, `editorHighlight`. Keep `markdown()`'s default `addKeymap: true`: its Enter continues lists and quotes, and its Backspace removes markup (T4.3).
- Compartments: theme (`editorTheme(compact)`), wrap (`EditorView.lineWrapping` or `[]`), readOnly (`EditorState.readOnly.of(ro)` + `EditorView.editable.of(!ro)`)
- `placeholder(...)` when given
- `md`: `frontMatterFold({ initiallyHidden, onUnfold })`
- `findHighlightField`
- `json`/`yaml`: `linter(v => jsonDiagnostics|yamlDiagnostics(v.state.doc.toString()), { delay: 300 })` + `lintGutter()`
- `EditorView.contentAttributes.of({ "aria-label": "<Markdown|JSON|YAML|…> source" })`
- `EditorView.updateListener` calling `onDocChange(update.state.doc.toString())` when `docChanged`

Theme values (`theme.ts`):
- Font `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`, 13px. Line height 1.625, or 1.375 when compact.
- Content padding `24px 32px`, or `12px 20px` when compact. Text `#374151`, transparent background, no focus outline.
- Active line `rgba(0,0,0,.025)`. Selection `#dbeafe`. `.cm-find-match` `rgba(254,240,138,.8)`, `.cm-find-current` `rgba(253,186,116,.8)`.
- Gutter transparent, `#d1d5db`, no border. `.cm-front-matter-fold`: 11px, `#6b7280`, `#f3f4f6` background, rounded.

Highlight (`editorHighlight`):
- Headings 600 `#111827`. Emphasis italic. Strong 600. Link/url `#2563eb`.
- Markdown markers (`processingInstruction`, `meta`) `#9ca3af`. Inline code/monospace `#be185d`. Quote `#6b7280` italic.
- `propertyName` `#0369a1`. String `#15803d`. Number/bool/null `#b45309`. Comment `#9ca3af` italic. `tagName` `#7c3aed`. `attributeName` `#0369a1`.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `bun test client/src/components/editor/cm/editor-state.test.ts && bun run check`
Expected: PASS and tsc exits 0.

- [ ] **Step 5: Implement `source-editor.tsx`**

- Mount: `state = (cache.current && restoreEditorState(cache.current.state, value, config)) ?? createEditorState(value, config)`. Create a `new EditorView({ state, parent })`. When restored, dispatch `cache.current.scroll`. Set `viewRef.current`.
- Unmount: `cache.current = { state: view.state, scroll: view.scrollSnapshot() }`, then `view.destroy()` and `viewRef.current = null`.
- Callbacks (`onDocChange`, `onUnfoldFrontMatter`) are read through refs, so extensions are built once per mount.
- Prop effects: readOnly/wrap/compact → `dispatch({ effects: reconfigure(config) })`. `frontMatterHidden` → `setFrontMatterHidden`. `highlights` → `setFindHighlights` (`null` when undefined).
- `value` that differs from the last text emitted by `onDocChange` → replace the whole document with `filter: false`, so external updates are never blocked.
- Wrapper: `<div className={`relative flex-1 min-h-0 overflow-hidden ${invalid ? "border-l-2 border-red-500" : ""} ${className}`} data-testid={...}>`, with `.cm-editor { height: 100% }` set in the theme.

- [ ] **Step 6: Type check**

Run: `bun run check`
Expected: tsc exits 0. The component is not mounted anywhere yet.

- [ ] **Step 7: Commit** (ask first)

Suggested message: `feat: CodeMirror state factory, theme and SourceEditor component`

---

### Task 6: Swap the textarea for `SourceEditor` in `Editor`

**Files:**
- Modify: `client/src/components/editor/editor.tsx` (lines 14-28 imports, 174-312 front matter/reveal/find, 344-355 format, 416-436 source pane, 605-616 plain text, 647-657 mobile)
- Modify: `client/src/components/editor/find.tsx`. Delete `findMatches`, `Range`, `SourceTextarea` and their imports. `FindBar` and the preview highlight helpers stay.
- Modify: `client/src/components/editor/reveal.ts`. Delete `MIRRORED_STYLES`, `caretTop` and `revealInTextarea`. Add the two helpers below.
- Test: `client/src/components/editor/reveal.test.ts`

**Interfaces:**
- Consumes: everything from Task 5, plus Task 3 `frontMatterEnd`, plus Task 4 `findInDoc` and `Range`.
- Produces (`reveal.ts`):
  - `lineRangeInDoc(doc: Text, line: number, query?: string): Range`: 0-based line, clamped to the last line, narrowed to the first case-insensitive match of `query` on that line
  - `revealInEditor(view: EditorView, range: Range, opts?: { focus?: boolean }): void`: selects the range and scrolls it to a third of the way down (`EditorView.scrollIntoView(from, { y: "start", yMargin: view.scrollDOM.clientHeight / 3 })`). Focuses unless `focus: false`.

- [ ] **Step 1: Write the failing test** for `lineRangeInDoc`

```ts
const d = Text.of(["a", "foo bar", ""]);
test("narrows to the query on the line", () => expect(lineRangeInDoc(d, 1, "BAR")).toEqual([6, 9]));
test("whole line without a query", () => expect(lineRangeInDoc(d, 1)).toEqual([2, 9]));
test("clamps past the end", () => expect(lineRangeInDoc(d, 99)).toEqual([10, 10]));
```

- [ ] **Step 2: Run the test to confirm it fails, then implement both helpers and run it to confirm it passes**

Run: `bun test client/src/components/editor/reveal.test.ts`
Expected: first FAIL, then PASS.

- [ ] **Step 3: Rewire `editor.tsx`**

Each change below decides one thing:
- **State:** add `viewRef = useRef<EditorView | null>(null)` and `editorCache = useRef<SavedEditor | null>(null)`. Remove `textareaRef`, `sourceText` and `onSourceChange`. The editor always holds the full `content`, and `onDocChange = setContent`.
- **Front matter:** pass `frontMatterHidden={hideFrontMatter}` and `onUnfoldFrontMatter={() => setFrontMatterOpen(true)}`. Keep `frontMatter` (from `splitFrontMatter(content)`) for the header toggle and the preview's `fm.body`.
- **Reveal handler:** lines are now whole-file lines in the editor. Keep the "unfold, then retry" branch when `fm.hidden && target.line < fm.lines`. Then `revealInEditor(view, lineRangeInDoc(view.state.doc, target.line, target.query))`. The preview branch is unchanged, and `!viewRef.current` replaces `!textareaRef.current`.
- **Find matches:** `sourceMatches = find.open && view ? findInDoc(view.state.doc, find.query, find.matchCase, hideFrontMatter ? frontMatterEnd(view.state.doc) : 0) : []`, memoised on `[find.open, content, find.query, find.matchCase, hideFrontMatter]`.
- **Preview current index** (replaces `occurrencesBeforeOffset`, which you delete): `findIndex − (number of sourceMatches starting before frontMatterEnd(doc))` when the front matter is visible, and `findIndex` when it is hidden. Clamp to `ranges.length − 1`.
- **Caret and selection:** `firstMatchFromCaret` uses `view.state.selection.main.head`. `openFind` takes the selection text only when `view.hasFocus`. `closeFind` focuses the view and selects the match.
- **Scroll to the current match:** dispatch `EditorView.scrollIntoView` without focusing.
- **Format:** if there is a view, `view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatted } })`. Otherwise use `setContent(formatted)`.
- **Panes:** the three `SourceTextarea`s become `<SourceEditor … data-testid="source-editor" />`, sharing `viewRef` and `editorCache`. Plain text gets `wrap={false}`. Mobile gets `compact={false}`. `invalid={!!analysis.error}`.

- [ ] **Step 4: Type check and tests**

Run: `bun run check && bun test client/src`
Expected: tsc exits 0 and all tests PASS. `grep -rn "SourceTextarea\|caretTop\|textareaRef" client/src` finds nothing.

- [ ] **Step 5: Verify in the app.** Run `bun run dev`, then open http://localhost:5000 in the browser pane. Use the desktop app (`bun run electron-dev`) for item 7.

1. A Markdown file shows highlighted headings, emphasis and fenced code (` ```ts ` is coloured). JSON and YAML show line numbers.
2. Fold the front matter, then Ctrl+A and Delete. Unfold: the front matter is still there. Backspace at the first body character doesn't touch it, and the "Front matter · N lines" widget unfolds it on click.
3. Outline and search jumps select the right line. A jump into folded front matter unfolds it first.
4. Ctrl+F counts match, F3 and Shift+F3 cycle, the preview highlights the same occurrence, and closing find leaves the match selected. This works both with the front matter folded and unfolded.
5. Type, switch Edit → Split → Preview → Edit, then Ctrl+Z: the typing is undone. Repeat with the mobile layout (resize to 375 px) by switching the Edit/Preview tabs.
6. Invalid JSON shows a squiggle and a gutter marker at the error. On valid JSON, Format then Ctrl+Z restores the original.
7. Use a CRLF file on disk. Before editing, run `bun -e "const t=await Bun.file(process.argv[1]).text();console.log((t.match(/\r\n/g)||[]).length,(t.match(/(?<!\r)\n/g)||[]).length)" <file>` and note the output. Edit one character, let it autosave, and run the command again. The first number is unchanged and the second is still 0.
8. A read-only file ignores typing. **Edit** unlocks it. Ctrl+S saves, Ctrl+Shift+F opens explorer search from inside the editor, and Ctrl+B / Ctrl+I / Ctrl+K format the text. Enter in a `- item` or `1. item` line continues the list, and Tab / Shift+Tab indent and outdent it.
9. Generate a 2 MB Markdown file in the scratchpad (`bun -e "await Bun.write(process.argv[1], Array.from({length:40000},(_, i)=>'## H'+i+'\\nSome *text* here with a [link](x).\\n').join(''))" <path>`), open it and type quickly. No characters are dropped and there's no visible lag.

- [ ] **Step 6: Commit** (ask first; the user may want to try the desktop build before committing)

Suggested message: `feat: CodeMirror 6 source editor replaces the textarea`

---

### Task 7: Replace in the find bar (Ctrl/Cmd+H)

**Files:**
- Modify: `client/src/components/editor/find.tsx` (`FindBar`)
- Modify: `client/src/components/editor/editor.tsx` (find state, key handler, `FindBar` props)

**Interfaces:**
- Consumes: Task 4 `replaceMatchesSpec`, `findInDoc`.
- Produces: new `FindBar` props `replaceOpen: boolean; replacement: string; canReplace: boolean; onReplacement(value: string): void; onToggleReplace(): void; onReplace(): void; onReplaceAll(): void`.

- [ ] **Step 1: Extend `FindBar`**

- A chevron toggle (`data-testid="find-replace-toggle"`) to the left of the find input, rendered only when `canReplace`.
- When `replaceOpen && canReplace`, a second row with:
  - an input (`find-replace-input`, placeholder `Replace`, Enter → `onReplace`, Ctrl/Cmd+Alt+Enter → `onReplaceAll`, Esc → `onClose`)
  - a **Replace** button (`find-replace-one`)
  - a **Replace all** button (`find-replace-all`)

  Both buttons are disabled when `total === 0`.

- [ ] **Step 2: Wire it into `editor.tsx`**

- Find state gains `replaceOpen: false` and `replacement: ""`.
- `canReplace = !readOnly && sourceShown && !!viewRef.current`.
- The window key handler adds Ctrl/Cmd+H (no Shift/Alt): `preventDefault()`, then open find with `replaceOpen: canReplace`.
- `onReplace`: if `canReplace` and there is a current match, dispatch `replaceMatchesSpec([match], replacement)` **with** `selection: { anchor: match[0] + replacement.length }`. Then set `index` to `firstMatchFromCaret(query, matchCase)`. This keeps the `a` → `aa` case moving forward.
- `onReplaceAll`: if `canReplace`, dispatch `replaceMatchesSpec(sourceMatches, replacement)` and show the toast `Replaced ${n} occurrence${n === 1 ? "" : "s"}`.

- [ ] **Step 3: Type check**

Run: `bun run check && bun test client/src`
Expected: tsc exits 0 and tests PASS.

- [ ] **Step 4: Verify in the app**

1. Ctrl+H opens find with the replace row. Replace walks through matches. With `a` → `aa` in `a a a`, three clicks of **Replace** give `aa aa aa`.
2. **Replace all** is undone in one Ctrl+Z.
3. In a read-only file, and in the Preview-only layout, there is no replace toggle and Ctrl+H opens find only.
4. With the front matter folded, **Replace all** leaves text inside the front matter untouched.

- [ ] **Step 5: Commit** (ask first)

Suggested message: `feat: replace and replace all in the find bar (Ctrl+H)`

---

### Task 8: Bundle check and docs

**Files:**
- Modify: `docs/editor-gap-analysis.md` (add a "Progress: CodeMirror 6" note under §5. Mark T4.1, T4.4 and P6 done. Mark T4.2 done except regex/whole word, and T4.3 done except the toolbar.)
- Modify: `docs/competitive-analysis.md` §3 rows: "Source syntax highlighting" → ✅, "Formatting shortcuts / toolbar" → 🟡 shortcuts, no toolbar, "Find & replace" → ✅. Also strike the textarea sentence in §1.

- [ ] **Step 1: Build and compare with the Task 1 baseline**

Run: `bun run build && ls -l dist/public/assets/*.js`
Expected: the entry chunk grows by **no more than 300 KB** (minified). The `@codemirror/language-data` languages show up as separate chunks, not in the entry chunk.

- [ ] **Step 2: Update both docs.** Then run `bun run check && bun test client/src` one last time.

- [ ] **Step 3: Commit** (ask first)

Suggested message: `docs: record the CodeMirror 6 editor in the gap and competitive analyses`
