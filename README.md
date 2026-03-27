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
| Backend | Express 5, TypeScript, tsx |
| Database | PostgreSQL via Drizzle ORM |
| Schema / validation | Drizzle-Zod, Zod |
| Web build | Vite (client) + esbuild (server) |
| Desktop | Electron 41 + electron-builder |

---

## Prerequisites

- **Node.js** 20 or later
- **npm** 10 or later
- **PostgreSQL** 14+ — only required when `DB_TYPE=postgres`

---

## Database Configuration

The app supports two database backends, switchable via the `DB_TYPE` environment variable:

| `DB_TYPE` | Backend | Notes |
|---|---|---|
| `sqlite` *(default)* | SQLite file (`./data/editor.db`) | Zero setup — works out of the box |
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
npm install
```

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
DB_TYPE=postgres npm run db:push
```

### 5. Start the development server

```bash
npm run dev
```

This starts a single process that serves both the Express API (port 5000) and the Vite dev server with HMR. Open your browser at:

```
http://localhost:5000
```

> The Vite frontend proxies API requests to Express automatically — no separate ports or proxy configuration is needed.

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
| `npm run dev` | Start development server (Express + Vite HMR) |
| `npm run build` | Build for production (outputs to `dist/`) |
| `npm run start` | Run the production build |
| `npm run check` | TypeScript type-check the entire project |
| `npm run db:push` | Apply the Drizzle schema to the database |

---

## Building for Production

### 1. Build the application

```bash
npm run build
```

This runs two steps in sequence:

1. **Client** — Vite compiles and bundles the React frontend into `dist/public/`
2. **Server** — esbuild compiles and bundles the Express server into `dist/index.cjs`

The final `dist/` folder is self-contained and only requires Node.js and a PostgreSQL database to run.

### 2. Set production environment variables

Ensure the following variables are available in your production environment:

```env
DATABASE_URL=postgresql://user:password@host:5432/markdown_editor
SESSION_SECRET=<long-random-secret>
NODE_ENV=production
```

### 3. Apply the database schema (first deploy only)

```bash
npm run db:push
```

### 4. Start the production server

```bash
npm run start
```

The server listens on port **5000** by default and serves both the API and the compiled frontend assets from `dist/public/`.

---

## Electron Desktop App

The app can be packaged and run as a native desktop application using Electron. When packaged, no separate browser is required — everything runs inside a standalone window.

**How it works:** Electron starts the bundled Express server as a child process, waits for it to respond, then opens a native window pointing at `http://localhost:5000`. External links are opened in the system browser.

With the default SQLite backend, the packaged Electron app is **fully self-contained** — no database server is needed. All data is stored in a local `editor.db` file next to the app. To use PostgreSQL instead, set `DB_TYPE=postgres` and `DATABASE_URL` before launching.

---

### Running the Desktop App in Development

Ensure your `.env` is configured and `npm run db:push` has been run, then:

```bash
node electron/dev.mjs
```

This automatically starts the Express + Vite dev server and then opens the Electron window once the server is ready. Press **Ctrl-C** to shut everything down.

---

### Packaging the Desktop App for Distribution

#### 1. Build the web application

```bash
npm run build
```

This produces the compiled server (`dist/index.cjs`) and the compiled frontend (`dist/public/`).

#### 2. (Optional) Add app icons

Place platform-specific icons in the `electron/icons/` directory before building:

| File | Platform | Size |
|---|---|---|
| `electron/icons/icon.icns` | macOS | 512×512 (multi-size ICNS) |
| `electron/icons/icon.ico` | Windows | 256×256 (multi-size ICO) |
| `electron/icons/icon.png` | Linux | 512×512 PNG |

If icons are omitted, electron-builder uses a default Electron icon.

#### 3. Package the app

```bash
# Current platform only
npx electron-builder --config electron-builder.yml

# Windows installer (.exe via NSIS)
npx electron-builder --win --config electron-builder.yml

# macOS disk image (.dmg)
npx electron-builder --mac --config electron-builder.yml

# Linux AppImage
npx electron-builder --linux --config electron-builder.yml
```

> **Cross-compilation note:** Building a Windows installer from macOS/Linux (or vice versa) requires additional setup. For reliable cross-platform builds, run each command on its target OS, or use a CI pipeline (GitHub Actions, etc.).

The packaged distributable is written to `electron-dist/`.

#### 4. Distribute the environment variables

The packaged app still connects to PostgreSQL via `DATABASE_URL`. The end user must set this variable before launching the app, or you can embed a `.env` file by adding it to the `files` array in `electron-builder.yml`.

---

### Available Commands (Electron)

| Command | Description |
|---|---|
| `node electron/dev.mjs` | Start dev server + Electron window together |
| `npx electron-builder --config electron-builder.yml` | Package for the current platform |
| `npx electron-builder --win --config electron-builder.yml` | Package for Windows |
| `npx electron-builder --mac --config electron-builder.yml` | Package for macOS |
| `npx electron-builder --linux --config electron-builder.yml` | Package for Linux |

---

## Project Structure

```
.
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
│   └── vite.ts              # Vite dev-server integration
├── electron/                # Electron desktop app
│   ├── main.cjs             # Electron main process (CommonJS)
│   ├── dev.mjs              # Dev launcher (starts server + Electron)
│   └── icons/               # App icons (icns / ico / png)
├── shared/
│   └── schema.ts            # Drizzle table schema + Zod types (shared by client & server)
├── script/
│   └── build.ts             # Production build script
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
