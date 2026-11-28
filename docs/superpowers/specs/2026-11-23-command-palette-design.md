# Command palette and Quick Open — design

*2026-11-23. Roadmap item 2 in [competitive-analysis.md](../../competitive-analysis.md); tasks T3.1–T3.2 in [editor-gap-analysis.md](../../editor-gap-analysis.md). The user approved diving straight in. The calls marked **(call)** are the executor's, made without asking.*

## Intent

Keyboard navigation in the style of VS Code:
- **Ctrl/Cmd+P** opens any open tab, recent file, database document or file in the open folders by typing part of its name.
- **Ctrl/Cmd+Shift+P** (and **F1**) runs any app action by name and shows its shortcut.

The goal is that a power user rarely needs the mouse to move around the workspace.

## What exists today (checked 2026-11-23 on `main` @ `fab1513`)

- **The palette UI is already installed.** `cmdk` and `client/src/components/ui/command.tsx` (shadcn `CommandDialog`) are in the project but unused.
- **No command registry.** Actions are spread across `layout/app-toolbar.tsx`, the explorer context menus, the editor header (`editor/editor.tsx`) and `lib/workspace.tsx` actions (`open`, `close`, `setSidebar`, `setEditorMode`, `setCompact`, …).
- **Shortcuts live in separate `window` `keydown` listeners:**
  - `editor/editor.tsx`: Ctrl+F, Ctrl+H, F3. It skips events where `e.defaultPrevented` is set.
  - `layout/workbench-sidebar.tsx`: Ctrl+Shift+F.
  - `lib/pending-saves.ts`: Ctrl+S.
  - The Electron menu (`electron/main.cjs`) only has role items plus zoom (Ctrl+0/=/-).
- **No recents.** The workspace state (`WorkspaceState` in `lib/workspace.tsx`, stored in localStorage `mdc.workspace.v1`) has `openTabs` and `pinned`, but no recently-opened list.
- **Sources of files:**
  - Database documents come from the documents list (`hooks/use-documents.tsx`).
  - Folder files are listed lazily per directory, but `fsApi.search({ roots, query, contents: false })` (`POST /api/fs/search`) already walks the open folders on the server and matches names (substring, case-insensitive, abortable, may be `truncated`).
- **Tab URIs:** `db:<id>` and `file:<path>`. Use `useWorkspaceActions().open(uri)`.
- **Headings** for `@`: `lib/outline.ts` together with `lib/active-editor.ts` (`useActiveEditor()` gives the active text; `requestReveal(uri, { line, heading })` jumps).

## Goals

1. **Command registry** `client/src/lib/commands.ts`.
   - Each command is `{ id, title, category, keys?, when?(ctx), run(ctx) }`, held in one table.
   - Commands are registered from the components that own the action, through a `useRegisterCommands(commands, deps)` hook, so each `run` closes over live state.
   - The palette lists every command that is currently enabled, with its shortcut.
2. **One keybinding listener** for the new shortcuts:
   - Ctrl/Cmd+P (quick open), Ctrl/Cmd+Shift+P and F1 (commands).
   - It calls `preventDefault()`, so the web build's Print and other browser defaults don't fire.
   - **(call)** The existing listeners stay as they are in this round. Their actions are *also* registered as commands with matching `keys` labels, so the palette shows them. Moving them into the registry's listener is a later cleanup.
3. **Quick Open** (one `CommandDialog`, mode set by prefix):
   - **No prefix:** files and documents, in this order:
     1. Open tabs.
     2. Recents: a new `recent: string[]` in `WorkspaceState`, capped at **50**, most recent first. Updated on every `open(uri)`, persisted, and pruned on `retarget` and when a file is deleted.
     3. Database documents by title.
     4. Folder files from `fsApi.search` (names only, debounced **150 ms**, the previous request aborted).

     Each row shows the name and a muted path (or "Document" for `db:`). Shown when the query is empty: open tabs, then recents.
   - **`>`** switches to commands, so Ctrl+Shift+P is the same dialog opened with `>` pre-filled.
   - **`@`** lists headings of the active Markdown document; Enter jumps through `requestReveal`.
   - **`:`** followed by a number goes to that line in the active document (`requestReveal(uri, { line: n - 1 })`).
4. **Commands to register in this round (call):**
   - **New:** Markdown / JSON / YAML document.
   - **Files:** Open Folder; Save; Save All.
   - **Sidebar:** Toggle Sidebar; Show Explorer / Documents / Outline.
   - **Layout:** Edit only / Split / Preview only; Toggle Compact; Toggle Full-Width Preview; Fold/Unfold Front Matter.
   - **Tabs:** Close Tab; Close Other Tabs; Close All Tabs.
   - **Navigation:** Reveal Active File in Explorer; Find in Document; Replace in Document; Search in Folders (Ctrl+Shift+F); Go to Line…; Go to Heading…
   - **Help:** About.

## Non-goals (this round)

- Rebinding shortcuts and user keybindings.
- Wiring the Electron native menu to the registry (T6.6).
- Moving the existing `keydown` listeners into the registry.
- A closed-tab stack (Ctrl+Shift+T).
- Content (full-text) search inside Quick Open: Ctrl+Shift+F already does that.

## Anti-goals

- Ctrl+P or Ctrl+Shift+P must not fire while the CodeMirror find bar or another dialog has focus and wants the key. Respect `e.defaultPrevented`, as the editor's handler does.
- The dialog must never block typing in the editor. It opens on demand only; nothing is rendered while it is closed.
- No new heavy dependency. Use `cmdk`'s own ranking. **(call)** Keep `shouldFilter` on for local items. Folder results are filtered by the server and passed through with `forceMount`.

## Approach

- **Picked:** a registry with `cmdk` in one dialog with prefix modes. It reuses installed UI, matches VS Code muscle memory, and the registry becomes the base for menus and rebinding later.
- **Considered:**
  - Hard-code a palette list inside the dialog: faster, but every new action has to be added in two places, which is the problem T3.1 exists to solve.
  - Separate dialogs for files and commands: duplicated UI, and no `>` switching.

## Testing

- **`bun test`, pure logic:**
  - Registry: register, unregister, `when` filtering, duplicate id replaces.
  - `recent` reducer: dedupe, cap 50, retarget, prune.
  - Prefix parsing: `>`, `@`, `:12`, plain.
  - Key matching: Ctrl/Cmd+P, Shift, F1, `defaultPrevented`.
- **In the app:**
  - Ctrl+P opens a recent file in about two keystrokes.
  - `>` switches modes.
  - `@` jumps to a heading; `:40` goes to line 40.
  - The web build's Ctrl+P doesn't print.
  - Shortcuts still work with focus in the editor and in the find bar.

## Left to the builder

File layout under `client/src/components/palette/`, row styling (match the explorer's density), exact category names, and the empty-state copy.
