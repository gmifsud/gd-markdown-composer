# Command Palette and Quick Open Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VS Code–style keyboard navigation: Ctrl/Cmd+P opens tabs, recent files, database documents and folder files by name; Ctrl/Cmd+Shift+P and F1 run any registered app action and show its shortcut; `@` jumps to a heading and `:` to a line.

**Architecture:** A module-level command registry (`lib/commands.ts`) that components fill through `useRegisterCommands`, so each `run` closes over live state. A new `recent` list in the workspace reducer, kept by pure helpers in `lib/recent.ts`. One palette (`components/palette/`) built on Radix Dialog plus `cmdk`. A prefix parser picks the mode (files, `>` commands, `@` headings, `:` line), and a single `keydown` listener opens it. Pure logic (registry, recents, prefix parsing, key matching, item building) is unit-tested with `bun test`. The UI is checked in the running app.

**Tech Stack:** React 18, TypeScript 5.6, Bun (`bun test`), `cmdk` 1.1.1 (`Command`, `defaultFilter`, `forceMount`), `@radix-ui/react-dialog`, wouter.

**Spec:** [docs/superpowers/specs/2026-11-23-command-palette-design.md](../specs/2026-11-23-command-palette-design.md)

## Global Constraints

- Recents: `recent: string[]` in `WorkspaceState`, capped at **50**, most recent first. Updated on every `open(uri)`, persisted with the workspace (`mdc.workspace.v1`), and pruned on `retarget` and when a file or document is deleted.
- Folder search: `fsApi.search({ roots, query, contents: false })`, names only, debounced **150 ms**, the previous request aborted.
- The new shortcuts are Ctrl/Cmd+P (files) and Ctrl/Cmd+Shift+P and F1 (commands). The listener calls `preventDefault()` and does nothing when `e.defaultPrevented` is already set.
- The existing `keydown` listeners (editor Ctrl+F/H/F3, sidebar Ctrl+Shift+F, Ctrl+S) stay as they are. Their actions are *also* registered as commands with matching `keys` labels.
- Nothing palette-related renders while the palette is closed, apart from the key listener.
- No new dependencies. Use `cmdk`'s own ranking (`defaultFilter`) with `shouldFilter` on for local items. Folder results are already filtered by the server, so they get `forceMount`.
- `bun run check` exits 0 and `bun test client/src` passes after every task.
- **Git:** work on a new branch `feature/command-palette` cut from `development`. **The user commits per task and pushes in GitKraken.** Never commit or push. Each task touches its own files only (no file is touched by two tasks), so the user can stage and commit each task's file list afterwards and every commit still builds. Never stage `.serena/`.
- Out of scope: rebinding, the Electron menu, moving the old listeners, Ctrl+Shift+T, full-text search in Quick Open.

## Review Focus

1. **Ctrl+P or Ctrl+Shift+P pressed with focus in CodeMirror or in the find bar.** Expected: the palette opens. A key the find box already handled (`defaultPrevented`) never opens it. (Key-matching tests in Task 3. Manual check in Task 6.)
2. **A command that moves focus, run from the palette** (Find in Document, Go to Line). Expected: focus ends in the find box or editor, not on whatever the dialog restores focus to. (Task 4 runs the action after the dialog's close-focus step. Manual check in Task 6.)
3. **A workspace saved before this change, or one with a damaged `recent` value.** Expected: it loads with `recent: []` (or the valid strings, capped at 50), and nothing else is lost. (`normalizeRecent` tests in Task 2.)
4. **A recent file deleted on disk, or a recent database document deleted.** Expected: it drops out of recents once the app notices (file-not-found screen, documents list refresh). (`pruneRecent` tests in Task 2. Wiring in Task 2. Manual check in Task 6.)
5. **`:0`, `:abc` or a line past the end of the document.** Expected: `:0` and past-the-end clamp to the first or last line, and `:abc` shows the hint, not a broken jump. (`parsePaletteQuery` and `clampLine` tests in Task 3.)

---

### Task 1: Command registry

**Files:**
- Create: `client/src/lib/commands.ts`
- Test: `client/src/lib/commands.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CommandContext { activeUri: string | null }
  export interface Command {
    id: string; title: string; category: string;
    /** Shortcut label in "Mod+Shift+F" form; Mod is Ctrl, or Cmd on macOS. */
    keys?: string;
    when?(ctx: CommandContext): boolean;
    run(ctx: CommandContext): void;
  }
  export interface CommandRegistry {
    /** Adds commands; an existing id is replaced. Returns a function that removes only what this call added and still owns. */
    register(commands: Command[]): () => void;
    /** Commands whose `when` passes (missing `when` = enabled; a throwing `when` = disabled), sorted by category, then title. */
    enabled(ctx: CommandContext): Command[];
    subscribe(listener: () => void): () => void;
    /** Increments on every register/unregister. */
    version(): number;
  }
  export function createCommandRegistry(): CommandRegistry;
  export const commandRegistry: CommandRegistry;
  export function useRegisterCommands(commands: Command[], deps: DependencyList): void;
  export function useCommandRegistryVersion(): number;
  export const IS_MAC: boolean;
  export function formatKeys(keys: string, mac: boolean): string;
  ```

- [ ] **Step 1: Write the failing tests** in `commands.test.ts` (relative import `./commands`):
  - `register then enabled lists it`, and the unregister function removes it.
  - `when filters`: `when: ctx => ctx.activeUri !== null` is hidden for `{ activeUri: null }` and shown for `{ activeUri: "db:1" }`. A `when` that throws is hidden.
  - `duplicate id replaces`: registering `{ id: "a", title: "Two" }` after `{ id: "a", title: "One" }` lists one command titled `"Two"`. Calling the *first* unregister afterwards leaves `"Two"` in place.
  - `sorted by category then title`.
  - `version and subscribers change on register and unregister`.
  - `formatKeys("Mod+Shift+F", false) === "Ctrl+Shift+F"`, `formatKeys("Mod+Shift+F", true) === "⌘⇧F"`, `formatKeys("F1", true) === "F1"`.

- [ ] **Step 2: Run them to see them fail.** Run: `bun test client/src/lib/commands.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `commands.ts`.** Entries are kept in a `Map<string, { command, owner: symbol }>`, and each `register` call gets its own `owner` symbol. `useRegisterCommands` is `useEffect(() => commandRegistry.register(commands), deps)`. `useCommandRegistryVersion` is `useSyncExternalStore(subscribe, version)`. `IS_MAC` is `/Mac|iPhone|iPad/.test(navigator.platform)` (guarded for `typeof navigator`). On macOS, `formatKeys` maps Mod→⌘, Shift→⇧, Alt→⌥, Ctrl→⌃ and joins with no separator. Elsewhere it maps Mod→Ctrl and joins with `+`.

- [ ] **Step 4: Run the tests and `bun run check`.** Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit (user).** Files: `client/src/lib/commands.ts`, `client/src/lib/commands.test.ts`. Message: `feat(palette): add command registry`.

---

### Task 2: Recently opened list

**Files:**
- Create: `client/src/lib/recent.ts`
- Test: `client/src/lib/recent.test.ts`
- Modify: `client/src/lib/workspace.tsx` (state, `loadState`, reducer cases `open`/`retarget`/`pruneDb`, new action)
- Modify: `client/src/components/editor/editor-loaders.tsx` (file-not-found branch of `FileEditor`)

**Interfaces:**
- Produces:
  ```ts
  export const RECENT_LIMIT = 50;
  /** Moves/adds uri to the front, capped. Returns the same array when uri is already first. */
  export function pushRecent(list: string[], uri: string): string[];
  /** Replaces `from` with `to`, dropping a duplicate `to`. Same array when `from` is absent. */
  export function retargetRecent(list: string[], from: string, to: string): string[];
  /** Keeps entries for which keep(uri) is true. Same array when nothing is removed. */
  export function pruneRecent(list: string[], keep: (uri: string) => boolean): string[];
  /** Stored value → string[] (non-arrays → [], non-strings and duplicates dropped, capped). */
  export function normalizeRecent(value: unknown): string[];
  ```
  - `WorkspaceState.recent: string[]`, and `useWorkspaceActions().forgetRecent(uri: string): void`.

- [ ] **Step 1: Write the failing tests** in `recent.test.ts`:
  - `pushRecent(["b","a"], "a")` → `["a","b"]`. Pushing a new uri onto a 50-item list gives length 50 with the new uri first and the oldest dropped. `pushRecent(list, list[0])` returns `list` itself (`toBe`).
  - `retargetRecent(["x","from","to"], "from", "to")` → `["x","to"]`. With `from` absent it returns the same array.
  - `pruneRecent(["db:1","file:a","db:2"], u => u !== "db:2")` → `["db:1","file:a"]`. With nothing removed it returns the same array.
  - `normalizeRecent(undefined)` → `[]`. `normalizeRecent(["a", 3, "a", "b"])` → `["a","b"]`. An array of 60 strings is capped to 50.

- [ ] **Step 2: Run them to see them fail.** Run: `bun test client/src/lib/recent.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `recent.ts`, then wire it into the workspace.**
  - `initialState.recent = []`. In `loadState`, set `recent: normalizeRecent(parsed.recent)`.
  - In the `open` case, update `recent` with `pushRecent` in **both** branches: a tab that is already open still moves to the front. Return `state` unchanged when neither list changes, so the URL-sync effect doesn't loop.
  - The `retarget` case also runs `retargetRecent`.
  - The `pruneDb` case also prunes `db:` entries from `recent` that are missing from `existingIds`.
  - New action `{ type: "forgetRecent"; uri: string }` and `forgetRecent(uri)` in `createActions`.
  - `editor-loaders.tsx`: when `FileEditor` shows "File Not Found" (`error instanceof FsNotFoundError`), call `forgetRecent(uri)` once in a `useEffect` keyed on `[missing, uri]`. The tab stays open.

- [ ] **Step 4: Run `bun test client/src` and `bun run check`.** Expected: all PASS, and tsc exits 0.

- [ ] **Step 5: Commit (user).** Files: the four above. Message: `feat(workspace): track recently opened files`.

---

### Task 3: Palette logic (prefixes, keys, items)

**Files:**
- Create: `client/src/components/palette/palette-logic.ts`
- Test: `client/src/components/palette/palette-logic.test.ts`

**Interfaces:**
- Consumes: `baseName`, `dirName` from `@/lib/fs-api`, and `parseUri` from `@/lib/workspace`.
- Produces:
  ```ts
  export type PaletteMode = "files" | "commands" | "headings" | "line";
  export interface PaletteQuery { mode: PaletteMode; text: string; line: number | null }
  export function parsePaletteQuery(input: string): PaletteQuery;
  export interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }
  export function paletteKeyFor(e: KeyLike): "files" | "commands" | null;
  /** 1-based line clamped into 1..lineCount (lineCount ≥ 1). */
  export function clampLine(line: number, lineCount: number): number;
  export interface QuickOpenItem { uri: string; label: string; detail: string; source: "tab" | "recent" | "document" | "folder" }
  export function buildQuickOpenItems(src: {
    openTabs: string[]; recent: string[];
    documents: { id: number; title: string }[];
    folderFiles: string[]; query: string;
  }): QuickOpenItem[];
  ```

- [ ] **Step 1: Write the failing tests:**
  - Prefixes:
    - `">  save"` → `{ mode: "commands", text: "save", line: null }`.
    - `"@intro"` → headings `"intro"`.
    - `":12"` → `{ mode: "line", text: "12", line: 12 }`.
    - `":"` and `":abc"` → line mode with `line: null`.
    - `" read "` → `{ mode: "files", text: "read", line: null }`.
  - Keys:
    - Ctrl+`p` and Meta+`p` → `"files"`.
    - Ctrl+Shift+`P` (key `"P"`) → `"commands"`.
    - `F1` with no modifiers → `"commands"`.
    - `defaultPrevented: true` → `null`.
    - Ctrl+Alt+`p` → `null`.
    - plain `p` → `null`.
  - `clampLine(0, 10) === 1`, `clampLine(99, 10) === 10`, `clampLine(4, 10) === 4`.
  - Items:
    - With `query: ""`, only tabs then recents come back, deduped: a recent that is also a tab appears once, as `source: "tab"`.
    - With a query, the order is tabs → recents → documents → folder files, deduped by uri.
    - A `db:` item uses the document title (`"Untitled"` when the title is empty or the document is unknown) and `detail: "Document"`.
    - A `file:` item uses `baseName` as label and `dirName` as detail.

- [ ] **Step 2: Run them to see them fail.** Run: `bun test client/src/components/palette`. Expected: FAIL.

- [ ] **Step 3: Implement `palette-logic.ts`.** For files mode, `text` is `input.trim()`. For the prefixed modes it is the rest of the input after the prefix, trimmed. `line` is `Number(text)` only when `/^\d+$/` matches. `paletteKeyFor` lowercases `e.key`.

- [ ] **Step 4: Run the tests and `bun run check`.** Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit (user).** Files: the two above. Message: `feat(palette): add prefix parsing, key matching and quick-open items`.

---

### Task 4: Palette UI and its own commands

**Files:**
- Create: `client/src/components/palette/palette-store.ts`
- Create: `client/src/components/palette/use-folder-file-search.ts`
- Create: `client/src/components/palette/command-palette.tsx`
- Modify: `client/src/lib/active-editor.ts` (add a getter)
- Modify: `client/src/App.tsx` (mount `<CommandPalette />` after `<Router />` inside `MoveFileProvider`)

**Interfaces:**
- Consumes: Task 1 (`commandRegistry`, `useRegisterCommands`, `useCommandRegistryVersion`, `formatKeys`, `IS_MAC`), Task 2 (`state.recent`), Task 3 (all exports), `useDocuments`, `useFsStatus`, `fsApi.search`, `parseOutline`, `requestReveal`, `useActiveEditor`.
- Produces:
  - `palette-store.ts`:
    - `openPalette(input?: string): void` (default `""`)
    - `closePalette(): void`
    - `setPaletteInput(input: string): void`
    - `usePaletteState(): { open: boolean; input: string }` (`useSyncExternalStore`)
  - `use-folder-file-search.ts`:
    - `useFolderFileSearch(query: string, roots: string[], enabled: boolean): { files: string[]; loading: boolean; truncated: boolean }`
    - Runs no search for queries shorter than 2 characters.
    - Waits 150 ms, then aborts the previous request. Results from an aborted request are ignored.
    - Keeps only results with `kind === "file"`, at most `FOLDER_RESULT_LIMIT = 50`.
    - `truncated` is the server's flag OR'd with "more than 50".
  - `active-editor.ts`: `getActiveEditor(): ActiveEditorInfo | null`.
  - `command-palette.tsx`: `CommandPalette()`.

- [ ] **Step 1: Implement the store, the search hook and the getter** with the signatures above.

- [ ] **Step 2: Implement `CommandPalette`.**
  - **Outer component** (always mounted):
    - One `window` `keydown` listener in the bubble phase. When `paletteKeyFor(e)` is non-null, it calls `e.preventDefault()`, then `openPalette("")` for `"files"` or `openPalette(">")` for `"commands"`.
    - It registers the palette's own commands (category `"Go"`):

      | id | title | keys | when |
      |---|---|---|---|
      | `go.file` | `Go to File…` | `Mod+P` | — |
      | `go.line` | `Go to Line…` | — | `getActiveEditor()?.uri === ctx.activeUri` |
      | `go.heading` | `Go to Heading…` | — | `getActiveEditor()?.fileType === "md"` |

      They open the palette with `""`, `":"` and `"@"` respectively.
    - It renders the dialog only while `open`.
  - **Dialog:**
    - Built from `@radix-ui/react-dialog` primitives: Root, Portal, Overlay `bg-black/20`, Content placed near the top (`top-[12%]`, `w-[min(640px,calc(100vw-32px))]`, centred horizontally), and an sr-only `Title` "Command palette".
    - Inside is cmdk's `Command` with a controlled `Command.Input` bound to the store, and `filter={(value, _search, keywords) => defaultFilter(value, query.text, keywords)}`, where `query = parsePaletteQuery(input)`.
    - Rows are `h-7 text-[13px]`, with the detail at `text-[11px] text-gray-400 truncate`, matching the explorer's density.
  - **Choosing an item:**
    - Store the action in a ref, then `closePalette()`.
    - In `Content`'s `onCloseAutoFocus`, run the stored action with `setTimeout(action, 0)`, so it runs after Radix restores focus (Review Focus 2).
  - **Files mode:**
    - Items come from `buildQuickOpenItems`. Folder files come from `useFolderFileSearch(query.text, state.folders, fsStatus?.enabled && state.folders.length > 0)`.
    - Groups: "Open tabs", "Recently opened", "Documents", "In folders". Folder items get `forceMount`.
    - Each item is `value={uri}`, `keywords={[label]}`. Enter calls `open(uri)`.
    - While loading, show a muted "Searching folders…" row. When truncated, show "More matches — keep typing".
    - Empty state: `No matching files. Type > for commands, @ for headings, : for a line.`
  - **Commands mode:**
    - Lists `commandRegistry.enabled({ activeUri })`, re-read when `useCommandRegistryVersion()` changes, grouped by `category`.
    - Each row shows the title and, on the right, `formatKeys(keys, IS_MAC)` (`CommandShortcut` styling).
    - Item `value={id}`, `keywords={[title, category]}`. Empty state: `No matching commands.`
  - **Headings mode:**
    - Lists `parseOutline(active.content)` when `getActiveEditor()`/`useActiveEditor()` is Markdown and matches `activeUri`. Each row shows `H{level}`, indented by level, with the text.
    - Enter calls `requestReveal(uri, { line, heading: { text, occurrence } })`.
    - Empty states: `Open a Markdown document to jump to its headings.` and `No headings in this document.`
  - **Line mode:**
    - With an active editor and `query.line !== null`, show one `forceMount` item, `Go to line {n}`, where `n = clampLine(query.line, lineCount)` and `lineCount = content.split(/\r?\n/).length`. Enter calls `requestReveal(uri, { line: n - 1 })`.
    - Otherwise show the hint `Type a line number between 1 and {lineCount}.`, or `Open a document to go to a line.` when there is no active editor.
  - **Placeholder** by mode:
    - files: `Search files by name — > commands, @ headings, : line`
    - commands: `Run a command`
    - headings: `Go to heading`
    - line: `Go to line`

- [ ] **Step 3: Run `bun run check` and `bun test client/src`.** Expected: tsc exits 0, and all tests PASS.

- [ ] **Step 4: Check in the app** (dev server `dev` from `.claude/launch.json`, port 5000):
  - Ctrl+P opens files mode.
  - Typing `>` lists Go to File/Line/Heading with `Ctrl+P` shown on Go to File.
  - Escape closes the palette.
  - Expected: no console errors.

- [ ] **Step 5: Commit (user).** Files: the five above. Message: `feat(palette): add Quick Open and command palette dialog`.

---

### Task 5: Register the app's commands

**Files:**
- Modify: `client/src/components/layout/app-toolbar.tsx`
- Modify: `client/src/components/layout/workbench-sidebar.tsx` (`ActivityBar`)
- Modify: `client/src/components/layout/tab-bar.tsx`
- Modify: `client/src/components/editor/editor.tsx`

**Interfaces:**
- Consumes: `useRegisterCommands`, `Command` (Task 1).

Commands to register (id · title · keys · when → run). Categories are `File`, `View`, `Tabs`, `Go`, `Search` and `Help`.

- **`app-toolbar.tsx`** (deps `[state.sidebar.visible, fsStatus?.enabled]`):
  - `file.newMarkdown` · New Markdown Document → `createDocument("md")`.
  - `file.newJson` · New JSON Document → `createDocument("json")`.
  - `file.newYaml` · New YAML Document → `createDocument("yaml")`.
  - `file.openFolder` · Open Folder… · when `fsStatus?.enabled` → `openFolder()`.
  - `file.saveAll` · Save All → `flushAllPendingSaves()`.
  - `view.toggleSidebar` · Toggle Sidebar → flip `sidebar.visible`.
  - `help.about` · About GD Markdown Composer → `setAboutOpen(true)`.
- **`workbench-sidebar.tsx`, `ActivityBar`:**
  - Extract the Ctrl+Shift+F body into a local `searchInFolders()`, used by both the listener and the command.
  - `view.showExplorer` · Show Explorer, `view.showDocuments` · Show Documents and `view.showOutline` · Show Outline each call `setSidebar({ visible: true, panel })`.
  - `search.inFolders` · Search in Folders · `Mod+Shift+F` → `searchInFolders()`.
- **`tab-bar.tsx`** (register **before** the `tabs.length === 0` early return):
  - `tabs.close` · Close Tab · when `activeUri` → `close([activeUri])`.
  - `tabs.closeOthers` · Close Other Tabs · when at least one visible, unpinned, non-active tab exists → close those tabs (the context menu's "Close Others" rule).
  - `tabs.closeAll` · Close All Tabs · when any visible unpinned tab exists → close them (the context menu's "Close All" rule).
  - `go.revealActive` · Reveal Active File in Explorer · when `activeUri` → `reveal(activeUri)`.
- **`editor.tsx`:**
  - Keep a `live` ref, refreshed every render, with `{ flush, openFind, setMode, mode, readOnly, canReplace, isPlainText, isMobile, isMarkdown, fullWidthAvailable, fullWidth, compact, hasFrontMatter, frontMatterOpen }`.
  - Register once per document (deps `[source.uri]`). Every `when` and `run` reads `live.current`, so typing never re-registers.
  - `file.save` · Save · `Mod+S` · when `!readOnly` → `flush()`.
  - `view.editOnly` · Layout: Edit Only, `view.split` · Layout: Split and `view.previewOnly` · Layout: Preview Only each have the when `!isPlainText && !isMobile && mode !== target` → `setMode(target)`.
  - `view.toggleCompact` · Toggle Compact Spacing · when `isMarkdown && !isMobile`.
  - `view.toggleFullWidth` · Toggle Full-Width Preview · when the full-width button would show: `!isPlainText && !isStructured && !isDiagramFile && !isMobile && mode !== "edit"`.
  - `view.foldFrontMatter` · Fold Front Matter · when `hasFrontMatter && frontMatterOpen`. `view.unfoldFrontMatter` · Unfold Front Matter · when `hasFrontMatter && !frontMatterOpen`.
  - `search.find` · Find in Document · `Mod+F` → `openFind()`.
  - `search.replace` · Replace in Document · `Mod+H` · when `canReplace` → `openFind(true)`.

- [ ] **Step 1: Add the registrations above.**

- [ ] **Step 2: Run `bun run check` and `bun test client/src`.** Expected: tsc exits 0, and all tests PASS.

- [ ] **Step 3: Check in the app:** with a Markdown file open, Ctrl+Shift+P lists every spec command group, with shortcuts on Save, Find, Replace, Search in Folders and Go to File.
  - Running "Layout: Preview Only" switches the layout.
  - "Close Tab" closes the active tab.

- [ ] **Step 4: Commit (user).** Files: the four above. Message: `feat(palette): register app actions as commands`.

---

### Task 6: End-to-end check and roadmap note

**Files:**
- Modify: `docs/editor-gap-analysis.md` (status log near the "T4.1 done." entry)

- [ ] **Step 1: Run the spec's in-app checks** in the web build (dev server):
  - Ctrl+P, then about two keystrokes, then Enter opens a recent file.
  - `>` switches modes, and backspacing it returns to files mode.
  - `@` jumps to a heading, and `:40` goes to line 40 with the editor focused.
  - Ctrl+P does not open the browser's print dialog.
  - Ctrl+P and Ctrl+Shift+P work with focus in the editor and in the find bar. "Find in Document" from the palette leaves focus in the find box.
  - A missing file's tab drops out of recents.

- [ ] **Step 2: Add a status entry:** `**T3.1 / T3.2 done.**`, one paragraph: the registry, Quick Open sources and prefixes, and what is still open (rebinding, the Electron menu, moving the old listeners into the registry).

- [ ] **Step 3: Final `bun run check` and `bun test client/src`.** Expected: tsc exits 0, and all tests PASS.

- [ ] **Step 4: Commit (user).** Files: `docs/editor-gap-analysis.md`, plus this plan and the spec if the user wants them tracked. Message: `docs: mark command palette done`.
