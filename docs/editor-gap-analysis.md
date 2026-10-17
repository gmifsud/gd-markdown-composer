# Markdown Composer — Design Review & Gap-Closing Plan

*Reviewed: 2026-10-17, at commit `ec39067`*

Goals for this round: **easy navigation around the UI**, **faster file loading**, **real file closing**, and **closing the feature gap** with typical markdown composers that have a preview (Typora, Obsidian, MarkText, VS Code + preview, StackEdit, Zettlr).

---

## 1. What exists today

```
┌──────────── Electron (main.cjs) ────────────┐
│ spawns bun dist/index.js, polls :5000        │
│ BrowserWindow → http://localhost:5000        │
└──────────────────────────────────────────────┘
          │ HTTP (JSON, whole documents)
┌─────────▼────────── Express 5 / Bun ─────────┐
│ GET  /api/documents      → every row, content included
│ GET  /api/documents/:id  → one row
│ POST / PUT / DELETE      → CRUD
│ request logger JSON.stringify's every response
└─────────┬────────────────────────────────────┘
          │ drizzle
   SQLite (data/editor.db)  |  Postgres (optional)

Client (React 18 + TanStack Query + wouter)
 Home
  ├─ Activity bar (one button: Explorer)
  ├─ ExplorerPanel  — DB docs grouped md/json/yaml + read-only local folder
  ├─ HorizontalTabs — renders EVERY document as a tab (pinned row + rest)
  └─ EditorLoader → Editor
        ├─ <textarea>  (plain)
        └─ ReactMarkdown + remark-gfm (re-rendered on every keystroke)
        auto-save: 1 s debounce → PUT → invalidate list + doc
```

**Strengths:** small and readable codebase; clean shared API contract (`shared/routes.ts`); SQLite default with zero setup; safe markdown rendering (no raw HTML); `cmdk`, `react-resizable-panels`, `command.tsx`, `resizable.tsx`, `context-menu.tsx` and `next-themes` are already installed, so a lot of the UI below needs no new dependencies.

---

## 2. Findings (what to fix before adding features)

### 2.1 Data-loss and correctness bugs — fix first

| # | Finding | Where | Impact |
|---|---|---|---|
| B1 | **The tab "×" deletes the document.** No "open tabs" concept exists: every document is always a tab, so "close" is wired to `handleDelete`. | `horizontal-tabs.tsx:172` | Users can't close files. They can only destroy them (behind a `confirm`). |
| B2 | **Edits from the last second are lost when switching docs, closing the window or following a link.** The debounced value is never flushed. Switching resets `content` before the debounce fires, and there is no `beforeunload`/close flush. | `editor.tsx:144-186` | Silent data loss. |
| B3 | **YAML "Format" flattens the file.** `prettifyYaml` trims every line's indentation, which destroys nesting. The "Formatted" preview shows the same corrupted output. | `editor.tsx:84-141` | Corrupts YAML on one click. |
| B4 | **YAML validator false positives.** `/'([^']*)?$/gm` matches any line with an apostrophe (`it's`), so valid YAML is flagged "Unclosed quote". | `editor.tsx:67-68` | Wrong error state. |
| B5 | **Saving fails for documents over ~100 KB.** `express.json()` defaults to a 100 KB body limit, so large files return 413 and show "Failed to save". | `server/index.ts:15` | Large docs can't be saved. |
| B6 | **Two Editor instances are mounted at once.** `Home` renders both the desktop and mobile layouts and hides one with CSS, so both have their own state and auto-save loop. | `home.tsx:120,143` | Wasted work, and a risk of two saves racing. |
| B7 | **Clicking a link in the preview navigates the app away.** Only `window.open` is intercepted, not normal navigation. Combined with B2, this loses edits. | `editor.tsx:347`, `main.cjs:159` | The app breaks out of itself. |
| B8 | **"Save As" writes YAML as `.md`.** | `editor.tsx:201-202` | Wrong file extension. |
| B9 | **Ctrl/Cmd+S does nothing useful.** No keyboard handling exists, so the browser's "Save page" dialog opens. | — | Breaks a basic expectation. |
| B10 | **The server binds to `0.0.0.0` with no auth on fixed port 5000.** In the desktop app, anyone on the LAN can read and delete documents, and port 5000 is often taken (macOS AirPlay). | `server/index.ts:93-96` | Security risk; startup fails. |
| B11 | *(needs verifying in a packaged build)* `dist/index.js` sits inside `app.asar`, which the bundled Bun can't read. `SQLITE_PATH` defaults to a path relative to the working directory, which may not be writable (Program Files). | `main.cjs:43`, `db.ts:18` | The packaged app may fail to start or save. |

### 2.2 Why loading feels slow

| # | Finding | Fix direction |
|---|---|---|
| P1 | `GET /api/documents` returns **every document's full content**, only to draw titles in the tree and tabs. | List endpoint returns metadata only. |
| P2 | Every save **invalidates the list and refetches it**, about once per second while typing, with all content. | Patch the cache with `setQueryData`; don't invalidate. |
| P3 | The request logger **`JSON.stringify`s every response body**, including the full list, on every request. | Log method, path, status and timing only. |
| P4 | Opening a doc not yet in the cache shows a full-screen spinner. There is no prefetch, even though the list response already holds the content. | Prefetch on hover/focus; keep the previous doc visible while loading. |
| P5 | The preview re-parses the whole markdown on **every keystroke**, synchronously and on the input thread. | `useDeferredValue` + memoised renderer; a worker for big docs. |
| P6 | The plain `<textarea>` re-renders the whole controlled value each keystroke, and its typing lag grows with document size. | CodeMirror 6 (virtualised viewport). |
| P7 | Electron polls the server every 500 ms and hides the window until it is ready. | Server prints a ready line on stdout and the window shows a skeleton at once. Or remove the HTTP hop (see §4, D1). |
| P8 | SQLite runs in the default rollback journal mode, with no index on `updated_at`. | `PRAGMA journal_mode=WAL`, add the index. |

### 2.3 Navigation gaps

- No quick open (Ctrl+P), command palette, or search across documents (`cmdk` is installed but unused).
- The tab bar `flex-wrap`s and grows taller with every document. There is no overflow scroll, reorder, middle-click close, dirty dot, or "close others/right/all".
- The explorer tree rows are `div onClick`. They can't take keyboard focus, have no arrow-key navigation, and no ARIA tree roles.
- No document outline/TOC, breadcrumbs, back/forward history, or "recent files".
- Explorer width is fixed at `w-56`, and the editor/preview split is fixed at 50/50. `react-resizable-panels` is installed but unused.
- Rename is only possible through the title field in the editor header, not inline in the tree (F2). No folders or tags for DB documents; everything is grouped by file type only.

---

## 3. Feature gap matrix (typical composers vs. this app)

Legend: ✅ have · 🟡 partial · ❌ missing. **Priority**: P0 = required for the stated goals, P1 = expected by users, P2 = nice to have.

| Area | Typical feature | Status | Priority |
|---|---|---|---|
| **Files & tabs** | Open/close tabs independent of storage | ❌ (B1) | P0 |
| | Dirty indicator per tab, prompt on close | ❌ | P0 |
| | Ctrl+W close, Ctrl+Tab / Ctrl+PgUp/PgDn cycle, Ctrl+Shift+T reopen | ❌ | P0 |
| | Restore open tabs/session on restart | 🟡 (pins only) | P0 |
| | Edit real files on disk (open/save in place, watch for external changes) | 🟡 (read-only import, creates copies) | P1 |
| | Recent files / recent folders | ❌ | P1 |
| | Rename / duplicate / move / folders | 🟡 | P1 |
| | Drag-and-drop a file onto the window to open it | ❌ | P1 |
| **Navigation** | Quick open (fuzzy file search) | ❌ | P0 |
| | Command palette | ❌ | P0 |
| | Full-text search across docs | ❌ | P1 |
| | Find / replace in doc (regex) | ❌ (browser only) | P0 |
| | Outline / TOC panel, click to jump | ❌ | P0 |
| | Back/forward navigation history | 🟡 (browser history in web only) | P1 |
| | Keyboard-navigable explorer | ❌ | P1 |
| | Resizable panes, toggle sidebar/preview | 🟡 | P0 |
| | Wiki-links `[[doc]]` + backlinks | ❌ | P2 |
| **Editor** | Syntax highlighting of markdown source | ❌ | P1 |
| | Line numbers, soft wrap toggle, current-line highlight | ❌ | P1 |
| | Formatting shortcuts (Ctrl+B/I/K), toolbar | ❌ | P1 |
| | Auto-continue lists, Tab/Shift+Tab indent | ❌ | P1 |
| | Undo that survives "Format" | ❌ (setState breaks native undo) | P1 |
| | Paste/drag image → saved asset + link | ❌ | P2 |
| | Table editing helpers | ❌ | P2 |
| | Spell check toggle | ❌ (forced off) | P2 |
| | Vim keymap | ❌ | P2 |
| **Preview** | Live GFM preview | ✅ | — |
| | Scroll sync editor ↔ preview | ❌ | P0 |
| | View modes: editor / split / preview | ❌ (split only on desktop) | P0 |
| | Code-block syntax highlighting | ❌ | P1 |
| | Heading anchors, in-doc `#links` work | ❌ | P1 |
| | External links open in system browser | ❌ (B7) | P0 |
| | Relative image paths resolve | ❌ | P1 |
| | Math (KaTeX) | ❌ | P1 |
| | Mermaid diagrams | ❌ | P1 |
| | Front-matter (YAML) shown or hidden | ❌ | P1 |
| | Footnotes, task-list checkbox toggling | 🟡 (gfm renders, not interactive) | P2 |
| | Callouts/admonitions (`> [!NOTE]`) | ❌ | P2 |
| **Export** | Download source | ✅ | — |
| | Export HTML / PDF / print | ❌ | P1 |
| | Copy as HTML / rich text | ❌ | P2 |
| **App** | Dark mode / theme | ❌ (half-dark explorer, light editor) | P1 |
| | Status bar: words, characters, reading time, cursor line/column | ❌ | P1 |
| | Settings (font, size, line height, autosave delay, wrap) | ❌ | P1 |
| | Focus / zen / typewriter mode | ❌ | P2 |
| | Version history / local snapshots | ❌ | P2 |

---

## 4. Target design

### 4.1 Key decisions and trade-offs

**D1 — Storage: keep the DB, add file-backed documents behind one interface.**
Composers like Typora and Obsidian edit files on disk; this app stores rows in SQLite. Rewriting to files-only would break the web and Postgres deployments. Instead, add a `DocumentSource` abstraction with two implementations: `db` (current) and `fs` (Electron IPC with `fs` + a watcher; browser File System Access API with `readwrite`). Tabs, editor and preview only see `{uri, content, version}`.
- *Trade-off:* more code than picking one model, but it keeps both deploy targets. *Revisit:* if desktop becomes the main target, make `fs` the default and keep the DB as an index or cache (FTS, recent files).
- *Desktop shortcut:* in Electron, a preload + IPC channel to the main process removes the localhost HTTP hop for file I/O. It also removes the need to expose a network port, which fixes B10.

**D2 — Editor engine: CodeMirror 6, not Monaco.**
CM6 is modular (about 150–300 KB for the markdown set versus 2 MB+ for Monaco), renders only the visible viewport so large docs stay fast, has first-class markdown/YAML/JSON language support, search/replace, keymaps (including vim), and gives exact source positions for scroll sync. Monaco is stronger for code but heavy, and awkward to theme like prose.
- *Trade-off:* this replaces the textarea, and the mobile experience needs testing (CM6 handles mobile reasonably well).

**D3 — Client state: split "workspace" state from "server" state.**
TanStack Query stays the cache for the server/files. A new small workspace store (React context + `useReducer`, or `zustand` if preferred) owns:

```ts
type Workspace = {
  openTabs: TabRef[];            // ordered; TabRef = { uri, pinned, preview }
  activeUri: string | null;
  mru: string[];                 // for Ctrl+Tab and "recent"
  closedStack: TabRef[];         // for Ctrl+Shift+T
  buffers: Record<string, {      // unsaved edits live here, not in component state
    content: string; baseVersion: number; dirty: boolean;
  }>;
  layout: { explorer: number; previewMode: 'split'|'editor'|'preview'; split: number };
};
```

The workspace store is saved to `localStorage` (and later to the Electron user-data folder). URLs become `/d/:id` → `?open=` deep links, or stay `/d/:id` for the active tab.

**D4 — Save pipeline: an explicit queue with flushes.**

```
keystroke → buffer.dirty = true → debounce(800ms) ─┐
switch tab / close tab / blur / Ctrl+S ─────────────┼─► saveQueue.flush(uri)
beforeunload / Electron 'close' (IPC ask) ──────────┘        │
                                                     PATCH {content, baseVersion}
                                                             │
                                  200 → setQueryData(doc), buffer.dirty=false
                                  409 → conflict banner (reload / overwrite / diff)
```

Add a `version` integer column for optimistic concurrency, so two windows can't silently overwrite each other.

**D5 — API shape.**

| Endpoint | Change |
|---|---|
| `GET /api/documents` | Return `{id, title, fileType, updatedAt, size, version}`, with no `content`. |
| `GET /api/documents/:id` | Unchanged; add `ETag: version`. |
| `PATCH /api/documents/:id` | Partial update with `baseVersion`; 409 on mismatch; returns metadata. |
| `GET /api/search?q=` | SQLite FTS5 over title + content; returns snippets. |
| Body limit | `express.json({ limit: '25mb' })`. |

**D6 — Preview pipeline.**
`content → useDeferredValue → unified(remark-parse, remark-gfm, remark-frontmatter, remark-math) → rehype(slug, autolink-headings, katex, highlight) → React`. Each block element gets a `data-line` from the mdast position, which drives scroll sync and the outline. Mermaid is lazy-loaded only when a ```` ```mermaid ```` block is present. Above about 200 KB, parsing moves to a Web Worker that returns HAST.
- *Trade-off:* `rehype-highlight` (small, good enough) vs `shiki` (exact VS Code themes, heavy, async). Start with highlight.js and lazy-load the languages.

### 4.2 Target component layout

```
Home
 ├─ ActivityBar        [Explorer | Search | Outline | Settings]
 ├─ ResizablePanelGroup
 │   ├─ SidePanel (resizable, collapsible: Ctrl+B)
 │   │    ├─ Explorer   (ARIA tree, keyboard nav, F2 rename, context menu)
 │   │    ├─ SearchPanel (FTS results with snippets)
 │   │    └─ OutlinePanel (headings of the active doc, click → scroll)
 │   └─ EditorArea
 │        ├─ TabStrip (open tabs only; scrolls, reorders by drag, dirty dot, middle-click close)
 │        ├─ Breadcrumb  (folder › file › current heading)
 │        └─ ResizablePanelGroup (mode: editor | split | preview)
 │             ├─ CodeMirrorPane (keyed by uri)
 │             └─ PreviewPane   (scroll-synced)
 ├─ StatusBar          [saved state · words · line:col · type · encoding]
 ├─ CommandPalette     (Ctrl+Shift+P; Ctrl+P = quick open; reuses ui/command.tsx)
 └─ KeybindingProvider (single registry; Electron menu accelerators map to the same commands)
```

Mobile renders a separate component tree selected by `useIsMobile()` (the hook already exists), not CSS-hidden duplicates. That fixes B6.

---

## 5. Task list

Size: **S** ≈ ≤ ½ day, **M** ≈ 1–2 days, **L** ≈ 3–5 days. Tasks in a phase can mostly run in parallel. Phases are ordered by dependency.

### Phase 0 — Stop the bleeding (bugs, data safety) · ~3 days

> **Status (2026-10-17): done, not yet committed.** Extra fixes made along the way:
> - The editor wrapper in `home.tsx` wasn't height-constrained, so the preview couldn't scroll on its own and long docs were clipped.
> - Two existing packaging blockers: `electron`/`electron-builder` were in `dependencies`, and `main:` in `electron-builder.yml` isn't a valid option (the entry point is now `main` in `package.json`).
> - The Bun binary folders (`bin/bun-windows-x64` etc.) didn't match electron-builder's `${os}` macro (`win`/`mac`), so Bun was never bundled.
>
> Verified: switch/reload/Ctrl+S saves, tab close vs delete + Undo, YAML format/validation, 3–5 MB saves, link handling, a single editor on desktop and mobile, port fallback, and a packaged Windows `--dir` build that starts and listens on 127.0.0.1 only.
> Not verified: closing the Electron window with unsaved edits, the default `userData` database path with the one-time copy of `./data/editor.db`, and the macOS/Linux packages.

| ID | Task | Size | Acceptance criteria |
|---|---|---|---|
| T0.1 | Rewire the tab "×" to **close** (temporary: hide the tab via local state). Delete only from the context menu or explorer, with an undo toast. | S | Clicking × never calls DELETE. |
| T0.2 | Flush pending saves on doc switch, unmount, `visibilitychange`, and `beforeunload`. Key `<Editor key={doc.id}>`. Bind Ctrl/Cmd+S to an immediate save. | S | Type, then switch within 200 ms → reload → text is there. Ctrl+S never opens the browser dialog. |
| T0.3 | Replace the hand-rolled YAML logic with the `yaml` package (`parse` for validation with line/column errors; `stringify` for Format, preserving comments via `parseDocument`). | S | Nested YAML round-trips through Format unchanged. `it's` isn't flagged. |
| T0.4 | `express.json({ limit: '25mb' })`. Strip response bodies from the request log. | S | Saving a 5 MB doc succeeds. Logs contain no content. |
| T0.5 | Render one layout based on `useIsMobile()` instead of mounting both. | S | React DevTools shows one `Editor`. |
| T0.6 | Preview links: external links → `target=_blank rel=noopener` (Electron opens them in the system browser); add a `will-navigate` guard in `main.cjs`; `#anchors` scroll inside the preview. | S | Clicking any preview link never replaces the app. |
| T0.7 | "Save As" uses the right extension and MIME type for YAML. Use a `Blob` URL instead of a `data:` URI (data URIs fail for large files). | S | A `.yaml` doc downloads as `.yaml`. |
| T0.8 | Bind the server to `127.0.0.1` when launched by Electron. Pick a free port (`PORT=0`) and pass it back over stdout. | S | The desktop app starts when port 5000 is busy and isn't reachable from the LAN. |
| T0.9 | Verify the packaged build. Unpack the server (`asarUnpack: dist/**`). Default `SQLITE_PATH` to `app.getPath('userData')`. | S | Installed app on Windows creates and saves docs. |

### Phase 1 — Tabs and closing (open-tab model) · ~1 week

| ID | Task | Size | Acceptance criteria |
|---|---|---|---|
| T1.1 | Build the **Workspace store** (D3): `openTabs`, `activeUri`, `mru`, `closedStack`, `layout`; saved to localStorage; migrate existing `pinnedTabIds`. | M | Reload restores the same open tabs, order, active tab and pins. |
| T1.2 | **TabStrip** shows only open tabs. Single row with horizontal scroll and an overflow dropdown; drag to reorder; middle-click close; dirty dot replaces × while unsaved. | M | 50 open tabs stay one row high. |
| T1.3 | Close semantics: close / close others / close to the right / close saved / close all, in the context menu. Prompt Save / Don't save / Cancel for a dirty buffer that can't auto-save. | M | Closing the active tab activates the MRU neighbour, not the first tab. |
| T1.4 | Shortcuts: Ctrl+W close, Ctrl+Shift+T reopen closed, Ctrl+Tab / Ctrl+Shift+Tab MRU switcher, Ctrl+PgUp/PgDn neighbour, Alt+1..9 jump. | S | All work in both web and Electron, and don't clash with the Electron menu. |
| T1.5 | Preview tabs (italic, replaced by the next single-click open; double-click or edit makes them permanent), VS Code-style. | S | Browsing the explorer doesn't pile up tabs. |
| T1.6 | Explorer click = open in tab, not "navigate". Show the open/dirty state in the tree. | S | — |

### Phase 2 — Faster loading · ~1 week

| ID | Task | Size | Acceptance criteria |
|---|---|---|---|
| T2.1 | Metadata-only list endpoint (D5). Update the shared schema and types. | S | List payload is under 50 KB for 1,000 docs. |
| T2.2 | Replace `invalidateQueries` after saves with `setQueryData` on the doc and the list entry. | S | No list refetch while typing (check the Network tab). |
| T2.3 | Prefetch on hover/focus in the explorer, tabs and quick open (`queryClient.prefetchQuery`). Keep the previous editor visible with a thin progress bar instead of a full-screen spinner. | S | Opening a hovered doc shows no spinner. |
| T2.4 | `PATCH` with `version` and optimistic concurrency (D4/D5). Add `version` and an index on `updated_at`. SQLite `PRAGMA journal_mode=WAL; synchronous=NORMAL`. | M | Two windows editing → the second gets a conflict banner, not a silent overwrite. |
| T2.5 | Preview: `useDeferredValue`, memoise `remarkPlugins`/`components`, and `React.memo` the preview. | S | Typing in a 200 KB doc stays smooth (under 16 ms input latency in Performance). |
| T2.6 | Code-split heavy parts: lazy-load CodeMirror languages, KaTeX, Mermaid, the highlight languages, and the export code. | S | Initial JS payload is under the current size after the CM6 switch. |
| T2.7 | Electron start-up: the server signals ready on stdout (no polling); `show: true` with a skeleton/splash at once; reuse one server across windows. | S | Time to first paint is under 1 s on a warm start. |
| T2.8 | *(optional, large docs)* Parse markdown in a Web Worker above a size threshold. | M | A 2 MB doc never blocks typing. |

### Phase 3 — Navigation · ~1–1.5 weeks

| ID | Task | Size | Acceptance criteria |
|---|---|---|---|
| T3.1 | **Command registry + KeybindingProvider**: one table of `{id, title, keys, run, when}` that powers shortcuts, the palette and the Electron menu. | M | Every action is reachable from the palette and shows its shortcut. |
| T3.2 | **Command palette** (Ctrl+Shift+P) and **Quick Open** (Ctrl+P, fuzzy over titles + MRU, `>` prefix switches to commands, `@` to headings, `:` to a line). Reuses `ui/command.tsx`. | M | Open any doc in two keystrokes plus the query. |
| T3.3 | **Outline panel** built from heading AST positions; click scrolls both panes; current section highlighted; also used for a breadcrumb under the tab strip. | M | — |
| T3.4 | **Global search** panel: SQLite FTS5 table synced on save (`GET /api/search`); results with highlighted snippets; Enter opens the doc at the match. | M | Search across 1,000 docs takes under 100 ms. |
| T3.5 | **Resizable layout**: explorer width, editor/preview split, collapsible side panel (Ctrl+B), view modes editor / split / preview (Ctrl+\ or Ctrl+Shift+V). All saved in the workspace store. | S | — |
| T3.6 | **Accessible explorer tree**: `role=tree/treeitem`, roving tabindex, arrows/Home/End/type-ahead, Enter opens, F2 renames inline, Delete with confirm, context menu (rename, duplicate, delete, reveal, copy path). | M | Fully usable without a mouse. |
| T3.7 | Back/forward cursor-location history (Alt+←/→), and recent files in the palette and on the empty state. | S | — |
| T3.8 | *(P2)* Folders and tags for DB docs (`parent_id`/`path` column) so the explorer can group by folder, not only by file type. | M | — |

### Phase 4 — Editor upgrade · ~1 week

| ID | Task | Size | Acceptance criteria |
|---|---|---|---|
| T4.1 | Replace the textarea with **CodeMirror 6** (markdown/json/yaml modes, line numbers, active line, soft wrap, bracket matching, a theme matching the app). | L | Same auto-save behaviour; undo/redo works through Format. |
| T4.2 | Search/replace (Ctrl+F / Ctrl+H, regex, case, whole word) via `@codemirror/search`. | S | — |
| T4.3 | Markdown commands: bold, italic, code, link (Ctrl+K), heading levels, list toggles, auto-continue lists, Tab indent, a small formatting toolbar. | M | — |
| T4.4 | JSON/YAML: inline diagnostics (squiggles at line/column), Format via the editor transaction (keeps undo). | S | — |
| T4.5 | *(P2)* Paste/drop images → store as an asset (DB blob or a file next to the doc) → insert `![](…)`. | M | — |
| T4.6 | *(P2)* Settings: font family/size, line height, tab size, wrap, spell check, vim mode, autosave delay. | M | — |

### Phase 5 — Preview parity · ~1 week

| ID | Task | Size | Acceptance criteria |
|---|---|---|---|
| T5.1 | **Scroll sync** both ways using `data-line` positions (D6), with a toggle. | M | The heading at the top of the editor is at the top of the preview, ±1 block. |
| T5.2 | Code highlighting (`rehype-highlight`, lazy languages) + copy button on code blocks. | S | — |
| T5.3 | `rehype-slug` + autolink headings; in-document `#links` work. | S | — |
| T5.4 | Math (`remark-math` + `rehype-katex`), Mermaid (lazy, rendered client-side, errors shown inline). | M | — |
| T5.5 | Front-matter: parse and hide it from the body; show it as a small metadata card. | S | — |
| T5.6 | Task-list checkboxes toggle the source; footnotes; GitHub-style callouts. | S | — |
| T5.7 | Relative images: resolve against the doc's folder (fs source) or an asset endpoint (db source). | S | — |

### Phase 6 — Real files and desktop integration · ~1.5 weeks

| ID | Task | Size | Acceptance criteria |
|---|---|---|---|
| T6.1 | `DocumentSource` interface (D1); move DB access behind it; URIs like `db:42`, `file:///…`. | M | Tabs, editor and preview don't know where content came from. |
| T6.2 | Electron preload + IPC: `openFile`, `openFolder`, `readFile`, `writeFile` (atomic temp + rename), `watch` (chokidar), native dialogs, recent documents (`app.addRecentDocument`). | L | Edit a `.md` on disk, save, and see it changed in another editor. |
| T6.3 | Browser: File System Access with `readwrite`, handles kept in IndexedDB so the folder reopens after reload; skip `.git`/`node_modules`; replace the "import" duplicate-copy flow. | M | Reopening the app restores the last folder (with one permission prompt). |
| T6.4 | External-change handling: a clean buffer reloads silently; a dirty buffer gets a banner with Keep mine / Load theirs / Compare. | M | — |
| T6.5 | Drag a file onto the window to open it; OS "Open with" / file association (`electron-builder fileAssociations`); single-instance lock forwards files to the running app. | M | — |
| T6.6 | Full Electron menu wired to the command registry (File / Edit / View / Go), so shortcuts appear in the native menu. | S | — |

### Phase 7 — Polish · ~1 week

| ID | Task | Size |
|---|---|---|
| T7.1 | Consistent light/dark/system theme via `next-themes` (editor, preview, explorer, highlight theme). | M |
| T7.2 | Status bar: save state, words/characters/reading time, line:col, selection count, doc type. | S |
| T7.3 | Export: HTML (standalone with CSS), PDF (Electron `printToPDF`, `window.print` on the web), copy as HTML. | M |
| T7.4 | Focus/zen mode, typewriter scrolling, max line width setting. | S |
| T7.5 | Local version history: keep a snapshot every N minutes or on manual save; diff and restore. | M |
| T7.6 | Tests: Playwright smoke tests (open, edit, switch, close, reload → content kept); unit tests for the save queue and workspace reducer. | M |
| T7.7 | Remove unused deps (passport, express-session, connect-pg-simple, memorystore, recharts, embla, vaul, input-otp, …) and the unused `ui/*` files to cut install size and packaging time. | S |

---

### Progress after Phase 0 (2026-10-17, not yet committed)

Done as part of a workspace round:
- **T1.1 / T1.3 (partial):** a workspace store (`client/src/lib/workspace.tsx`) with real open tabs, pins and saved layout. Tab menu has Close, Close Others, Close to the Right, Close Tabs in Folder and Close All.
- **T1.2 (partial):** one slim row of tabs that scrolls sideways, with a folder colour hint on each tab. Drag-to-reorder isn't done yet.
- **T3.5 (partial):** the sidebar is resizable (drag, arrow keys, double-click to reset). The explorer and a separate Documents-by-type panel are switched from the activity bar.
- **T6.1–T6.3 (partial):** local folders through `/api/fs/*` (desktop app and local dev only, loopback + header guarded). Several folders can be open at once; `.md`/`.json`/`.yaml` are edited in place on disk with conflict detection; any other text file opens read-only. Includes the native multi-folder picker in Electron, Copy Path / Copy Relative Path / Reveal, and New File in a folder.
- **Toolbar:** New ▾ (Markdown / JSON / YAML document, or a new file in a folder), Open Folder, Save.

Still open from those tasks: Ctrl+W / Ctrl+Tab shortcuts, tab drag-to-reorder, watching for external changes (T6.4), keyboard arrow navigation in the tree (T3.6), and relative images for files (T5.7).

## 6. Suggested order and milestones

```
Week 1   Phase 0 (all) ─────────► M0: "no data loss"
Week 2   Phase 1 ─────────────────► M1: real tabs + closing
Week 3   Phase 2 (T2.1–T2.5, T2.7) ► M2: fast open/switch
Week 4   Phase 3 (T3.1–T3.5) ──────► M3: palette, quick open, outline, resizable
Week 5   Phase 4 (CodeMirror) ─────► M4: real editor
Week 6   Phase 5 ─────────────────► M5: preview parity
Week 7–8 Phase 6 + 7 ─────────────► M6: real files, desktop polish
```

Phase 4 (CodeMirror) can start alongside Phase 3 if two people are working. T3.3 (outline) and T5.1 (scroll sync) both depend on the source-position work in D6, so do them in that order.

## 7. Assumptions and what to revisit later

- **Assumed:** a single user per install (desktop-first), up to a few thousand documents, files mostly under 1 MB. Multi-user hosting would need auth (passport is already a dependency), per-user scoping, and real-time collaboration (Yjs + CM6), which is out of scope here.
- **Revisit when:**
  - **Desktop is the main target.** Make `fs` the default source, use SQLite only as an index (FTS, recents, history), and drop the Express hop in Electron entirely (IPC only).
  - **Documents regularly exceed about 1 MB.** Move preview rendering fully into a worker and render the preview incrementally.
  - **The DB grows past about 10k docs.** Virtualise the explorer list and the quick-open results.
  - **Collaboration is needed.** Replace the version-number concurrency with a CRDT (Yjs) and a WebSocket sync (`ws` is already installed).
