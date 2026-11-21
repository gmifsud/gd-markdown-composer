# Competitive Analysis — Markdown Composers

*Written: 2026-11-21, on branch `feature/explorergroups-mermaid-default` (commit `69dc914`).*
*Companion to [editor-gap-analysis.md](editor-gap-analysis.md), which lists our internal gaps. This document looks outward: who we compete with, which editor engines we could embed, and which features are worth building.*

The request had two parts, so this report has two layers:

1. **Editor engines we could embed** ("deploy in our application"): open-source components that would replace our `<textarea>` editor.
2. **Competing products**: what they ship, what users complain about, and which features we should take from them.

---

## 1. Where we stand today

What the app does well, based on the code and recent commits:

- **Many file types in one workspace.** Markdown, JSON, YAML, `.mermaid`/`.mmd`, `.drawio`, HTML preview, images, and read-only Word and Excel. Any other text file opens read-only.
- **Diagrams render locally.** Mermaid, PlantUML and draw.io diagrams render in fenced code blocks and as their own files. Nothing goes to an outside service.
- **Two places to store files.** Documents can live in the database (SQLite or Postgres), or as real files on disk across several folders, edited in place with conflict detection.
- **Workbench UI.** Explorer groups with tab hiding, pinned tabs, close commands, outline panel, explorer search, view modes, find in document, code-block select and copy, foldable front matter, `![[image]]` embeds.
- **Runs on desktop and the web.** The Electron app registers file types with the OS. The same app runs self-hosted in a browser.

Where we fall behind: the editor is still a plain `<textarea>` (`client/src/components/editor/find.tsx:109`). So the markdown source has no syntax highlighting, there are no formatting shortcuts or replace, and undo is fragile. We also have no command palette, no content search for database documents (folders already have it, with Ctrl+Shift+F), no dark theme, no export to PDF or HTML, no image paste and no math.

---

## 2. Editor engines we could embed

| Engine | Model | Markdown round-trip | Bundle | Fit for us |
|---|---|---|---|---|
| **CodeMirror 6** | Source editor. Decorations can render content inline (Obsidian's Live Preview is built on it). | **Lossless.** The text is the document. | Small and modular (load only the languages you use) | ⭐ **Best fit.** Handles md, JSON, YAML, Mermaid and PlantUML sources in one editor, plus search and replace, vim, multiple cursors and a virtualised viewport. Works on phones too. |
| **Monaco** | VS Code's editor | Lossless | Large (several MB). Weak on mobile. | Too heavy for the web and mobile layouts. We would get VS Code features we don't need. |
| **Milkdown / Crepe** (ProseMirror + remark) | WYSIWYG with markdown in and out. Crepe ships a toolbar, slash menu, tables, LaTeX and CodeMirror code blocks. | **Lossy.** It re-serialises the markdown, which changes list markers, escaping and spacing. | Medium | Worth it only as an **optional "Rich" mode** for documents stored in the database. Keep it off by default for files on disk that are tracked in git. |
| **MDXEditor** (Lexical) | WYSIWYG with markdown string in and out | Lossy. Supports GFM tables only, not HTML tables. Reported inline rendering issues. | Larger | Milkdown does the same job and is more actively maintained (7.22.1, Aug 2026). |
| **Tiptap / BlockNote** | Headless framework / Notion-style blocks | Markdown is an add-on, not the native format | Medium | Wrong model. These suit block-document products, not markdown files. |
| **@uiw/react-md-editor, EasyMDE** | A textarea plus a preview | Lossless | Small | Little better than what we already have. `react-simplemde-editor` has had no update since 2022. |

**Recommendation: move to CodeMirror 6 now. Consider Milkdown later, and only as an opt-in mode.**

What CodeMirror 6 replaces or unlocks:
- It replaces `SourceTextarea` and the find-highlight layer in `find.tsx`, and the textarea caret helpers in `reveal.ts`.
- It unlocks syntax highlighting of the markdown source, `@codemirror/search` (regex replace), formatting keymaps, undo that survives Format, lint squiggles for JSON and YAML, vim mode, and folding. Front-matter folding already exists, so it would move over to the editor's own folding.
- It also opens a path to **Obsidian-style Live Preview** later: render headings, emphasis, images, checkboxes and Mermaid inline, and show the raw syntax again on the line where the cursor is. That gives users most of the WYSIWYG feel without losing a single byte of the markdown.

---

## 3. Feature comparison matrix

Legend: ✅ yes · 🟡 partial or via plugin · ❌ no

| Feature | **Us** | Typora | Obsidian | VS Code (built-in md) | MarkText | Zettlr | HackMD / HedgeDoc | iA Writer |
|---|---|---|---|---|---|---|---|---|
| Editing model | Source + preview | Inline WYSIWYG | Live Preview / source | Source + preview | Inline WYSIWYG | Source (styled) | Source + preview | Styled source |
| Source syntax highlighting | ❌ | n/a | ✅ | ✅ | n/a | ✅ | ✅ | ✅ |
| Formatting shortcuts / toolbar | ❌ | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ |
| Find & **replace** | 🟡 find only | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tabs / multiple open docs | ✅ | ❌ (one doc per window) | ✅ | ✅ | ✅ | ✅ | ❌ | 🟡 |
| File tree / multiple folders | ✅ multi-root + groups | 🟡 | ✅ one vault | ✅ | 🟡 weak | ✅ | ❌ | 🟡 |
| Quick open / command palette | ❌ | 🟡 | ✅ | ✅ | 🟡 | 🟡 | ❌ | 🟡 |
| Full-text search across files | 🟡 open folders (Ctrl+Shift+F); not database docs | 🟡 | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ |
| Outline / TOC | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Wiki-links + backlinks | 🟡 `![[img]]` only | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | 🟡 |
| Link validation / rename updates links | ❌ | ❌ | ✅ | ✅ | ❌ | 🟡 | ❌ | ❌ |
| Paste / drop image → saved file | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (upload) | ✅ |
| Math (KaTeX / MathJax) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Mermaid | ✅ | ✅ | ✅ | 🟡 ext | ✅ | ✅ | ✅ | ❌ |
| **PlantUML + draw.io, offline** | ✅ | ❌ | 🟡 plugins | 🟡 ext | ❌ | ❌ | 🟡 PlantUML via a server | ❌ |
| Callouts `> [!NOTE]` | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | 🟡 | ❌ |
| Scroll sync | ❌ | n/a | n/a | ✅ | n/a | n/a | ✅ | n/a |
| Export HTML / PDF | ❌ | ✅ (+ Pandoc) | ✅ PDF | 🟡 ext | ✅ | ✅ Pandoc | ✅ | ✅ |
| Dark mode / themes | ❌ | ✅ CSS themes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Focus / typewriter mode | ❌ | ✅ | 🟡 | 🟡 Zen | ✅ | ✅ | ❌ | ✅ (signature feature) |
| Word count / status bar | ❌ | ✅ | ✅ | 🟡 | ✅ | ✅ | 🟡 | ✅ |
| Version history | ❌ | 🟡 OS | 🟡 paid Sync | ✅ Timeline + git | ❌ | 🟡 | ✅ | 🟡 |
| Real-time collaboration | ❌ | ❌ | ❌ | 🟡 Live Share | ❌ | ❌ | ✅ (core) | ❌ |
| Slides / presentation | ❌ | ❌ | 🟡 | ❌ | ❌ | 🟡 | ✅ reveal.js | 🟡 separate app |
| Structured views of front matter | ❌ | ❌ | ✅ Bases (1.9–1.10) | ❌ | ❌ | 🟡 | ❌ | ❌ |
| Citations / Zotero | ❌ | ❌ | 🟡 plugin | 🟡 ext | ❌ | ✅ | ❌ | 🟡 |
| AI assistance | ❌ | ❌ | 🟡 plugins | ✅ Copilot | ❌ | 🟡 | 🟡 | 🟡 Authorship (marks AI text) |
| JSON / YAML editing + validation | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Office files (docx / xlsx) viewer | ✅ | ❌ | ❌ | 🟡 ext | ❌ | ❌ | ❌ | ❌ |
| Self-hosted web **and** desktop | ✅ | ❌ | ❌ | ✅ (code-server) | ❌ | ❌ | ✅ web only | ❌ |
| Price / licence | Ours | $14.99 one-off | Free; Sync/Publish paid | Free | Free (maintenance has stalled) | Free, GPL | Free / SaaS; HedgeDoc AGPL | Paid |

---

## 4. UX approach summary

| Aspect | Typora | Obsidian | VS Code | HackMD / HedgeDoc | iA Writer |
|---|---|---|---|---|---|
| Onboarding | Open a file and type. No setup. | Pick or create a vault, then a "Welcome" note. Plugins come later. | Open a folder. Markdown support is built in. | Open the URL and type. No account needed for HedgeDoc. | One blank page. The defaults *are* the product. |
| Core interaction | Syntax disappears as you type. | Live Preview. Raw syntax shows on the line where the cursor is. | Source on the left, preview on the right (Ctrl+K V). | Split view, with other people's cursors visible. | Focus mode, syntax highlighting of parts of speech. |
| Information architecture | One document per window, plus a file and outline sidebar. | Vault → folders, plus a graph, backlinks and Bases. | Workspace → explorer, with every action in the command palette. | A flat list of notes, tags and teams. | Library → folders, with smart folders. |
| Visual style | Minimal. CSS themes are a community scene. | Dense, and themeable without limit. | A dense developer tool. | Plain web app. | Typography-led, with very few controls. |
| Notable | Lossless-feeling WYSIWYG | Plugin ecosystem (1,000+). Bases turns notes into databases. | Paste or drop files, link validation, smart select | Collaboration and slides from one source | Authorship marks AI text vs. human text |

---

## 5. Technical trade-offs seen across competitors

- **Editor core.** Obsidian, Zettlr and HedgeDoc are all built on CodeMirror, and they keep the text lossless. Typora and MarkText use custom contenteditable engines. These feel better to type in, but they are hard to maintain: MarkText's custom "muya" engine is a large part of why its maintenance stalled. **Lesson:** build on CodeMirror 6, not on a custom engine.
- **Storage.** The winners keep **plain files on disk** (Obsidian, Typora, Zettlr, VS Code). Database-first tools (HackMD, Notion) win on collaboration but lose on portability. We have both. Make the disk the default for "real" work, and keep the database for scratch work and the web.
- **Rendering.** We use the unified / remark / rehype pipeline, like Zettlr and MDX-based tools. It is extensible, but the preview re-parses the whole document on every keystroke. CodeMirror decorations work on the visible area only, which suits big documents better (see P5 and P6 in the gap analysis).
- **Shell.** Typora, Obsidian, MarkText and Zettlr all run on Electron, so Electron is not a disadvantage. What *is* unusual is our HTTP hop between Electron and Bun. It makes the self-hosted web version possible, and nobody else in this group has one.
- **Collaboration.** HedgeDoc uses OT/CRDT over websockets. If we ever add it, Yjs + `y-codemirror.next` drops into CodeMirror 6. That is another reason to choose CodeMirror 6 now.

---

## 6. Gaps and differentiation opportunities

User pain points from forums and reviews. The sample is thin, so treat these as signals rather than a survey:
- **Lossy WYSIWYG makes people angry.** Quire users protested when an editor upgrade removed raw markdown input. Writers who use git notice when a tool rewrites their markdown.
- **Obsidian Live Preview "jumps"** as raw syntax appears when the cursor enters a block. Some users want a calmer writing mode.
- **MarkText**: no maintainer since around 2022, weak folder handling, no word wrap in code blocks.
- **Typora**: one document per window, and file management is basic.
- Developers keep asking for **diagrams, link checking, and git-friendly output**. Most writing-focused editors don't serve them.

Underserved segment: **docs-as-code / technical writers**. They live in repositories full of `.md`, `.yaml`, `.json`, `.mermaid`, `.drawio` and `.puml` files. VS Code is too general for them, and Obsidian is too notes- and vault-centred. This is where we already lead (multi-root folders, explorer groups, offline diagrams, JSON and YAML, Office viewers).

### Differentiation opportunities

1. **The docs-as-code workbench.** Lean into multi-format plus offline diagrams. Add **link validation** (broken relative links, missing anchors and missing images, shown as squiggles and in a Problems panel) and **rename/move updates links**. File moves already exist, so updating links is the natural next step.
2. **Git awareness without being VS Code.** Show file status colours in the explorer, a change gutter in the editor, and a "diff with HEAD" view. No writing-focused markdown editor does this well.
3. **Front-matter table views** (Obsidian Bases for repositories). We already parse YAML front matter, so a folder could show as a sortable table of its files' front matter, with inline editing. That suits ADRs, runbooks and changelogs.
4. **Local version history**: snapshots on save, with a diff and restore. This is a safety net for files outside git and for database documents.
5. **Present from markdown.** A reveal.js-style slide mode using `---` separators, in the style of HackMD. Mermaid and diagrams render in the slides as well.
6. **AI assist with provenance** *(later)*: rewrite, summarise, generate a Mermaid diagram from a description. Mark AI-inserted text the way iA Writer's Authorship does, so it can be reviewed. Use the Claude API and keep it opt-in.
7. **Self-hosted collaboration** *(large effort)*: the server already exists. Yjs on CodeMirror 6 would give HedgeDoc-style editing together, which none of the desktop editors offer.

---

## 7. Lessons from prior art

- **Adopt:** a CodeMirror-based source editor with optional live decorations. Proven by Obsidian, Zettlr and HedgeDoc, and lossless.
- **Adopt:** a command palette and quick open as the backbone for every action. Obsidian and VS Code have trained users to expect them.
- **Adopt:** paste or drop an image → copy it into a configurable assets folder → insert a relative link (VS Code's `markdown.copyFiles.destination` model).
- **Adopt:** export to HTML and PDF. Every competitor except VS Code without extensions has it. Electron's `printToPDF` makes PDF cheap.
- **Adopt:** dark mode. Every competitor has it, and `next-themes` is already installed.
- **Avoid:** a WYSIWYG mode that rewrites markdown by default (Quire's backlash, git-diff noise). If we add Milkdown, keep it opt-in and per document.
- **Avoid:** a custom editing engine (MarkText's maintenance collapse).
- **Avoid (for now):** a public plugin API. Obsidian's ecosystem is its moat, but it costs years of API stability work. A command registry gives us extension points inside the app first.
- **Avoid:** the one-document-per-window model (Typora). Our tabs and groups are already better.
- **Innovate:** link health, git awareness and structured front-matter views for docs-as-code repositories. No competitor covers all three.

### Table stakes vs. differentiators

| Table stakes (users leave without them) | Differentiators (users switch for them) |
|---|---|
| Real source editor (highlighting, shortcuts, replace, undo) | Offline PlantUML / draw.io / Mermaid in one workspace ✅ |
| Command palette + quick open | JSON / YAML / Office files next to markdown ✅ |
| Search across files | Explorer groups across several folders ✅ |
| Dark mode | Link validation + rename updates links |
| Paste image | Git status and diff |
| Export HTML / PDF | Front-matter table views |
| Math, callouts, task toggles | Slides from markdown |
| Word count / status bar | Self-hosted collaboration |

---

## 8. Recommended feature roadmap

**Tier 1: table stakes, do next** (most are already in the gap analysis as T-items)

| # | Feature | Why | Effort | Gap-doc ref |
|---|---|---|---|---|
| 1 | **CodeMirror 6 editor** (md / json / yaml / mermaid / puml modes, search and replace, formatting keymap, lint for JSON and YAML) | Unlocks most of the rest. It is the biggest gap against every competitor. | L | T4.1–T4.4 |
| 2 | **Command palette + quick open** (`cmdk` already installed) | Every power-user competitor has these | M | T3.1–T3.2 |
| 3 | **Dark / system theme** (`next-themes` already installed) | Every competitor has it | M | T7.1 |
| 4 | **Paste or drop an image → assets folder → relative link** | Every competitor has it; we already render images | M | T4.5 |
| 5 | **Export HTML / PDF / copy as HTML** (`printToPDF`) | Every competitor has it | M | T7.3 |
| 6 | **Status bar** (words, reading time, line:col, save state) | Cheap and expected | S | T7.2 |

**Tier 2: parity for technical writers**

| # | Feature | Effort |
|---|---|---|
| 7 | Content search for database documents (FTS5), merged with the existing folder content search; add a results list with snippets | M |
| 8 | KaTeX math, GitHub callouts, clickable task checkboxes | S–M |
| 9 | Scroll sync between editor and preview | M |
| 10 | Wiki-links `[[doc]]` + a backlinks panel (we already resolve `![[img]]`) | M |

**Tier 3: differentiators**

| # | Feature | Effort |
|---|---|---|
| 11 | **Link validation + rename/move updates links** (Problems panel) | M |
| 12 | **Git status in the explorer + change gutter + diff view** | M–L |
| 13 | **Front-matter table view** for a folder | M |
| 14 | Local version history with diff and restore | M |
| 15 | Slide mode from markdown | M |
| 16 | AI assist with authorship marks (opt-in) | M–L |
| 17 | Live Preview decorations in CodeMirror 6 (WYSIWYG feel, lossless) | L |
| 18 | Real-time collaboration (Yjs) for database documents on the web | XL |

---

## 9. Handoffs

- **Architecture** (`architect/system-design`): the CodeMirror 6 migration touches `editor.tsx`, `find.tsx` and `reveal.ts`, plus the scroll-sync and outline position model. Design how source positions map between the editor, the preview and the outline before starting.
- **User research** (`advocate/user-story`): the pain-point evidence above is thin. Before Tier 3, confirm with real users that the docs-as-code segment is the target.

---

## Sources

- [Best Markdown Editors Compared (2026)](https://lifa-su.github.io/blog/markdown-editors-comparison-2026.html)
- [Zettlr features](https://zettlr.com/features)
- [Typora vs Obsidian (AFFiNE)](https://affine.pro/blog/typora-vs-obsidian)
- [Strapi: Top markdown editors for React](https://strapi.io/blog/top-5-markdown-editors-for-react)
- [Liveblocks: Which rich text editor framework (2025)](https://liveblocks.io/blog/which-rich-text-editor-framework-should-you-choose-in-2025)
- [MDXEditor on GitHub](https://github.com/mdx-editor/editor)
- [Obsidian 1.10.0 changelog](https://obsidian.md/changelog/2025-10-01-desktop-v1.10.0/) · [1.10.3](https://obsidian.md/changelog/2025-11-11-desktop-v1.10.3/)
- [iA Writer Authorship](https://ia.net/writer/support/editor/authorship) · [See what AI wrote](https://ia.net/topics/see-what-ai-wrote)
- [HedgeDoc](https://hedgedoc.org/) · [HedgeDoc on Markdown Guide](https://www.markdownguide.org/tools/hedgedoc/)
- [Markdown in VS Code (official docs)](https://code.visualstudio.com/docs/languages/markdown)
- [MarkText on AlternativeTo](https://alternativeto.net/software/mark-text/about) · [Linux Mint listing](https://community.linuxmint.com/software/view/com.github.marktext.marktext)
- [Quire feedback thread #6267](https://quire.io/w/Quire_Feedback/6267)
