# Markdown Editor

A web-based document editor with support for **Markdown**, **JSON**, and **YAML** file types. Documents are persisted in a PostgreSQL database and the editor provides a VSCode-style explorer panel, horizontal tab bar, split-pane editing with live preview, auto-save, and local file import/export.

---

## Features

- **Multi-format editing** — Markdown (with live rendered preview), JSON (with validation & prettify), YAML (with validation & prettify)
- **VSCode-style explorer** — collapsible sidebar with documents grouped by type, inline create/delete, and open-folder support
- **Horizontal tabs** — pinnable tabs with right-click context menu; pin state persists across sessions
- **Open Folder** — browse a local folder in the explorer and import `.md`, `.json`, `.yaml` files into the editor with one click (requires Chrome or Edge)
- **Auto-save** — changes are debounced and saved automatically to the database
- **Save As** — download the current document as a local file in its native format
- **Responsive** — full desktop layout (activity bar + explorer + tabs) and a mobile layout with a slide-out sheet menu

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui |
| Routing | Wouter |
| Data fetching | TanStack Query v5 |
| Forms | React Hook Form + Zod |
| Backend | Express 5, TypeScript, Bun runtime |
| Database | SQLite (via `bun:sqlite`) **or** PostgreSQL via Drizzle ORM |
| Schema / validation | Drizzle-Zod, Zod |
| Web build | Vite (client) + `Bun.build` (server) |
| Desktop | Electron 41 + electron-builder (bundles Bun) |

---

## Prerequisites

- **Bun** 1.1 or later — [install instructions](https://bun.com/docs/installation)
- **PostgreSQL** 14+ — only required when `DB_TYPE=postgres`
- **Java** 11+ — only required to render PlantUML diagrams (rendered locally; set `JAVA_HOME` or put `java` on `PATH`)

---

## Database Configuration

The app supports two database backends, switchable via the `DB_TYPE` environment variable:

| `DB_TYPE` | Backend | Notes |
|---|---|---|
| `sqlite` *(default)* | SQLite file (`./data/editor.db`) via `bun:sqlite` | Zero setup — works out of the box |
| `postgres` | PostgreSQL via `DATABASE_URL` | Requires a running PostgreSQL server |

You can also override the SQLite file location with `SQLITE_PATH=./my/custom/path.db`.

---

## Development Setup

### 1. Clone the repository

```bash
git clone <repository-url>
cd <repository-folder>
```

### 2. Install dependencies

```bash
bun install
```

Then fetch the diagram renderers that are too large to commit (PlantUML jar and the diagrams.net viewer; pinned and checksum-verified, saved to gitignored folders):

```bash
bun run fetch:vendor
```

Markdown previews render ` ```mermaid `, ` ```plantuml ` / ` ```puml ` and ` ```drawio ` (diagram XML) code blocks as diagrams. Nothing is sent to an outside service.

### 3. Configure environment variables

Create a `.env` file in the project root. For the default **SQLite** setup, only one variable is required:

```env
# Required — used to sign HTTP sessions
SESSION_SECRET=change-me-to-a-long-random-secret

# Optional — database backend (default: sqlite)
# DB_TYPE=sqlite

# Optional — custom SQLite file path (default: ./data/editor.db)
# SQLITE_PATH=./data/editor.db
```

To switch to **PostgreSQL**, add:

```env
DB_TYPE=postgres
DATABASE_URL=postgresql://user:password@localhost:5432/markdown_editor
```

### 4. (PostgreSQL only) Push the database schema

SQLite creates its table automatically on first start. PostgreSQL requires this step:

```bash
bun run db:push
```

### 5. Start the development server

```bash
bun run dev
```

This starts a single process that serves both the Express API (port 5000) and the Vite dev server with HMR. Open your browser at:

```
http://localhost:5000
```

> The Vite frontend proxies API requests to Express automatically — no separate ports or proxy configuration are needed.

> `bun --hot` does **not** type-check. Run `bun run check` separately (it's wired to `tsc --noEmit`).

---

### Database table — `documents`

| Column | SQLite type | PostgreSQL type | Description |
|---|---|---|---|
| `id` | INTEGER (auto) | serial (PK) | Auto-incrementing primary key |
| `title` | TEXT | text | Document title (default: `"Untitled Document"`) |
| `content` | TEXT | text | Raw document content |
| `file_type` | TEXT | text | One of `md`, `json`, `yaml` |
| `created_at` | TEXT (ISO) | timestamp | Creation time |
| `updated_at` | TEXT (ISO) | timestamp | Last-updated time |

---

## Available Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start the development server (Express + Vite HMR) |
| `bun run build` | Build for production (outputs to `dist/`) |
| `bun run start` | Run the production build |
| `bun run check` | TypeScript type-check the entire project |
| `bun run db:push` | Apply the Drizzle schema to the database |
| `bun run electron-dev` | Launch Electron with the dev server |

---

## Building for Production

### 1. Build the application

```bash
bun run build
```

This runs two steps in sequence:

1. **Client** — Vite compiles and bundles the React frontend into `dist/public/`
2. **Server** — `Bun.build` bundles the Express server into `dist/index.js` (ESM)

The final `dist/` folder is self-contained and only requires a Bun runtime and (optionally) a PostgreSQL database to run.

### 2. Set production environment variables

Ensure the following variables are available in your production environment:

```env
DATABASE_URL=postgresql://user:password@host:5432/markdown_editor
SESSION_SECRET=<long-random-secret>
NODE_ENV=production
```

### 3. Apply the database schema (first deploy only)

```bash
bun run db:push
```

### 4. Start the production server

```bash
bun run start
```

The server listens on port **5000** by default and serves both the API and the compiled frontend assets from `dist/public/`.

---

## Electron Desktop App

The app can be packaged and run as a native desktop application using Electron. When packaged, no separate browser is required — everything runs inside a standalone window.

**How it works:** Electron starts the bundled Express server as a child process (using the Bun runtime bundled inside the app), waits for it to respond, then opens a native window pointing at `http://localhost:5000`. External links are opened in the system browser.

> **Why bundle Bun?** The server uses `bun:sqlite`, a built-in module that is unavailable in the Node binary that Electron embeds. The packaged app therefore ships a per-platform Bun runtime in its `resources/` folder (`bin/bun-<os>-<arch>/`). When upgrading Bun, re-run `bun script/fetch-bun.mjs --all` and rebuild. Each platform adds ~80–100 MB on top of Electron + Chromium.

With the default SQLite backend, the packaged Electron app is **fully self-contained** — no database server is needed. All data is stored in a local `editor.db` file next to the app. To use PostgreSQL instead, set `DB_TYPE=postgres` and `DATABASE_URL` before launching.

---

### Running the Desktop App in Development

Ensure your `.env` is configured and `bun run db:push` has been run (Postgres only), then:

```bash
bun run electron-dev
```

This automatically starts the Express + Vite dev server (under Bun) and then opens the Electron window once the server is ready. Press **Ctrl-C** to shut everything down.

---

### Packaging the Desktop App for Distribution

#### 1. Build the web application

```bash
bun run build
```

This produces the compiled server (`dist/index.js`) and the compiled frontend (`dist/public/`).

#### 2. Ensure the platform-appropriate Bun binary is present

The `bin/` directory is git-ignored. After cloning, populate it once:

```bash
# Current platform only:
bun script/fetch-bun.mjs

# All desktop platforms:
bun script/fetch-bun.mjs --all
```

#### 3. (Optional) Add app icons

Place platform-specific icons in the `electron/icons/` directory before building:

| File | Platform | Size |
|---|---|---|
| `electron/icons/icon.icns` | macOS | 512×512 (multi-size ICNS) |
| `electron/icons/icon.ico` | Windows | 256×256 (multi-size ICO) |
| `electron/icons/icon.png` | Linux | 512×512 PNG |

If icons are omitted, electron-builder uses a default Electron icon.

#### 4. Package the app

```bash
# Current platform only
bunx electron-builder --config electron-builder.yml

# Windows installer (.exe via NSIS)
bunx electron-builder --win --config electron-builder.yml

# macOS disk image (.dmg)
bunx electron-builder --mac --config electron-builder.yml

# Linux AppImage
bunx electron-builder --linux --config electron-builder.yml
```

> **Cross-compilation note:** Building a Windows installer from macOS/Linux (or vice versa) requires additional setup. For reliable cross-platform builds, run each command on its target OS, or use a CI pipeline (GitHub Actions, etc.).

The packaged distributable is written to `electron-dist/`.

#### 5. Distribute the environment variables

The packaged app still connects to PostgreSQL via `DATABASE_URL`. The end user must set this variable before launching the app, or you can embed a `.env` file by adding it to the `files` array in `electron-builder.yml`.

---

### Available Commands (Electron)

| Command | Description |
|---|---|
| `bun run electron-dev` | Start dev server + Electron window together |
| `bunx electron-builder --config electron-builder.yml` | Package for the current platform |
| `bunx electron-builder --win --config electron-builder.yml` | Package for Windows |
| `bunx electron-builder --mac --config electron-builder.yml` | Package for macOS |
| `bunx electron-builder --linux --config electron-builder.yml` | Package for Linux |
| `bun script/fetch-bun.mjs --all` | Refresh bundled Bun binaries for every platform |

---

## Project Structure

```
.
├── bin/                    # Per-platform Bun binaries (gitignored; populated by script/fetch-bun.mjs)
│   ├── bun-darwin-x64/bun
│   ├── bun-darwin-arm64/bun
│   ├── bun-linux-x64/bun
│   └── bun-windows-x64/bun.exe
├── client/                  # Frontend source (React + Vite)
│   └── src/
│       ├── components/
│       │   ├── editor/      # Editor component (MD/JSON/YAML)
│       │   ├── layout/      # Explorer panel, tabs, sidebar
│       │   └── ui/          # shadcn/ui component library
│       ├── hooks/           # TanStack Query hooks (documents)
│       ├── lib/             # Query client, utilities
│       └── pages/           # Page components (home.tsx)
├── server/                  # Backend source (Express)
│   ├── index.ts             # Server entry point
│   ├── routes.ts            # API route handlers
│   ├── storage.ts           # Database access layer (Drizzle)
│   ├── schema.sqlite.ts     # SQLite Drizzle schema (used by bun:sqlite)
│   └── vite.ts              # Vite dev-server integration
├── electron/                # Electron desktop app
│   ├── main.cjs             # Electron main process (CommonJS)
│   ├── dev.mjs              # Dev launcher (starts server + Electron)
│   └── icons/               # App icons (icns / ico / png)
├── shared/
│   └── schema.ts            # Drizzle table schema + Zod types (Postgres; shared by client & server)
├── script/
│   ├── build.mjs            # Production build (Vite + Bun.build)
│   └── fetch-bun.mjs        # Helper to populate bin/ with the Bun runtime
├── electron-builder.yml     # electron-builder packaging configuration
├── migrations/              # Drizzle-generated SQL migrations
├── drizzle.config.ts        # Drizzle Kit configuration
├── vite.config.ts           # Vite configuration
├── tailwind.config.ts       # Tailwind CSS configuration
└── tsconfig.json            # TypeScript configuration
```

---

## API Reference

All endpoints are prefixed with `/api`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/documents` | List all documents |
| `GET` | `/api/documents/:id` | Get a single document |
| `POST` | `/api/documents` | Create a new document |
| `PATCH` | `/api/documents/:id` | Update a document |
| `DELETE` | `/api/documents/:id` | Delete a document |

---

## Browser Compatibility

The **Open Folder** feature uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) and requires **Chrome 86+** or **Edge 86+**. All other features work in any modern browser.