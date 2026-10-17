# Migrate Markdown Composer from Node + better-sqlite3 to Bun + bun:sqlite

## Context

The project's `better-sqlite3@^12.8.0` native binding is built against a different Node ABI than the installed Node 24, causing a load failure on `npm install` / first server boot. The fix is to leave Node's native-binding ecosystem behind for SQLite and use **Bun** (`bun:sqlite`, built-in, zero compile step) as the runtime, package manager, and bundler.

### Confirmed decisions

- **Scope:** full Bun migration — dev, prod, build, install, Replit deploy, and Electron packaged builds.
- **Backends:** keep both SQLite (now via `bun:sqlite`) and Postgres (`pg` + `drizzle-orm/node-postgres`).
- **Desktop:** keep Electron — Bun's runtime will be bundled as an `extraResource` so the packaged server can still use `bun:sqlite`.

### Why "full Bun" is required here

`bun:sqlite` is a built-in module — it cannot run on the Node binary that Electron embeds. So either we abandon Electron or we ship Bun itself inside the app. The user wants the desktop app, so we bundle Bun.

## Tasks (ordered)

### 1. Replace tooling & deps in `package.json`

- Remove deps: `better-sqlite3`, `@types/better-sqlite3`, `tsx`, `cross-env`, `esbuild`. These exist solely to support Node + native-binding workflows that Bun replaces.
- Keep `drizzle-orm`, `drizzle-kit`, `pg`, `drizzle-orm/node-postgres` (already pulled by `drizzle-orm`).
- Delete `package-lock.json`; let `bun install` create `bun.lock`.
- Update `scripts`:
  - `dev`: `bun --hot server/index.ts`
  - `dev-win`: `bun --hot server/index.ts` (Bun handles Windows natively — `cross-env` no longer needed)
  - `build`: `bun run script/build.mjs` (replaces esbuild script — see task 4)
  - `start`: `bun run dist/index.js`
  - `check`: `bunx tsc --noEmit`
  - `db:push`: `bunx drizzle-kit push`
- Add `engines: { "bun": ">=1.1.0" }` so future installs don't silently downgrade.

### 2. Rewrite the SQLite branch of `server/db.ts`

Replace `server/db.ts:2-3` (`better-sqlite3` import + `drizzle-orm/better-sqlite3` import):

```ts
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
```

In `setupSqlite()` (`server/db.ts:17-38`):

- `new BetterSqlite3(dbPath)` → `new Database(dbPath, { create: true })`.
- `sqlite.exec(\`...\`)` is unchanged — `bun:sqlite` exposes `.exec()`.
- `drizzleSqlite(sqlite, { schema: { documents: sqliteDocuments } })` → `drizzle(sqlite, { schema: { documents: sqliteDocuments } })`.
- Postgres branch (`setupPostgres`, `server/db.ts:41-51`) is untouched.

### 3. Confirm `server/storage.ts` needs no edits

`server/storage.ts:30` already special-cases `dbType === "sqlite"` with `new Date().toISOString()`. `drizzle-orm/bun-sqlite` returns text columns as strings, identical to `better-sqlite3`, so behaviour is preserved. No code change.

### 4. Replace `script/build.ts` with a Bun bundler pipeline

Delete `script/build.ts` (and its `esbuild` `allowlist`). Create `script/build.mjs`:

```js
import { rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });

console.log("building client...");
await (await import("vite")).build();

console.log("building server...");
const result = await Bun.build({
  entrypoints: ["server/index.ts"],
  target: "bun",
  outdir: "dist",
  entryNames: "index",
  format: "esm",
  minify: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
```

This produces `dist/index.js` (Bun's loader-compatible ESM). Output extension is `.js` (was `.cjs`) — update Electron + Replit references (tasks 5, 6).

### 5. Update `electron/main.cjs` for Bun runtime

- `electron/main.cjs:43` — change `dist/index.cjs` → `dist/index.js`.
- `electron/main.cjs:50` — replace `process.execPath` (Electron's embedded Node) with the bundled Bun binary:

```js
const bunName = process.platform === 'win32' ? 'bun.exe' : 'bun';
const bunPath = isPacked
  ? path.join(process.resourcesPath, bunName)
  : 'bun'; // dev: must be on PATH
serverProcess = spawn(bunPath, [serverPath], { env, stdio: [...] });
```

- `electron/main.cjs:8` — keep `process.env.PORT || 5000`.

### 6. Bundle Bun binary per-platform via `electron-builder.yml`

Add to `electron-builder.yml`:

```yaml
extraResources:
  - from: "bin/bun-${os}-${arch}/"
    to: "."
    filter: ["bun", "bun.exe"]
```

Create `bin/bun-darwin-x64/bun`, `bin/bun-darwin-arm64/bun`, `bin/bun-linux-x64/bun`, `bin/bun-windows-x64/bun.exe` — each populated from the matching asset on https://github.com/oven-sh/bun/releases. Add `bin/` to `.gitignore` and provide a `bin/README.md` (or a `script/fetch-bun.mjs`) so the implementer can re-download on Bun upgrades.

Update the `files:` array — already correct (`dist/**/*`, `electron/main.cjs`, `package.json`).

### 7. Update `electron/dev.mjs` launcher

- `electron/dev.mjs:32` — `spawn('npm', ['run', 'dev'], …)` → `spawn('bun', ['run', 'dev'], …)`.
- `electron/dev.mjs:54` — `spawn(electronCmd, ['electron/main.cjs'], …)` → spawn via Bun too, e.g. `spawn('bun', ['electron/main.cjs'], …)` (or invoke Electron directly — both work; pick direct Electron since Bun launching Electron on Windows can be finicky).
- Add `bunx electron electron/main.cjs` style for the dev runner. Concretely: keep Electron direct, swap only the dev-server spawn to `bun`.

Add a root script `electron-dev: "bun electron/dev.mjs"` for convenience.

### 8. Update Replit config (`.replit`)

- `modules` line: drop `nodejs-20`, add `bun-1.1` (pin to current stable).
- `[deployment].run`: `["bun", "./dist/index.js"]`.
- `[workflows].Start application.args`: `"bun run dev"`.
- `[nix].packages`: add `bun` (channel stays `stable-24_05`).

### 9. Update `README.md`

- Prerequisites → "Bun ≥ 1.1" instead of Node 20 + npm.
- Scripts table → all commands now `bun run …` (the table cells).
- Electron section → add one paragraph: "The packaged app bundles a per-platform Bun runtime in `resources/` because the server uses `bun:sqlite`. Replace the binaries in `bin/bun-*/` and rebuild when upgrading Bun."
- Note that `package-lock.json` is gone and `bun.lock` is the lockfile.

### 10. Validation (run after each task lands)

1. `bun install` — clean install, no `node-gyp` step.
2. `bun run check` — zero TS errors (Bun's type-checking via `tsc --noEmit` is authoritative; `bun --hot` does not type-check by default).
3. `bun run dev` (SQLite default) — server boots on `:5000`, `GET /api/documents` returns `[]`, create + read + update + delete a document works, `./data/editor.db` is created.
4. `DB_TYPE=postgres bun run dev` (with `DATABASE_URL` pointing at a local Postgres) — same CRUD flow works.
5. `bun run build` — produces `dist/public/` and `dist/index.js`.
6. `bun run start` — boots the built bundle and serves the SPA from `dist/public/`.
7. `bun run db:push` against Postgres — schema applies cleanly via Bun.
8. `bun electron/dev.mjs` — Electron window opens, dev server reachable.
9. `bunx electron-builder --win --config electron-builder.yml` — installer produced; launching it spawns the bundled `bun.exe` from `resources/`, which in turn launches `dist/index.js`. Check that `resources/bun.exe` is present in the unpacked app.
10. Sanity check: grep for `better-sqlite3`, `tsx`, `cross-env`, `esbuild` — expect zero hits in non-`node_modules` files.

## Risks & mitigations

- **`Bun.build` quirk with a transitive CJS dep.** If the server bundle fails on `pg` or `connect-pg-simple`, add `--external pg` (or use the `external` array in `Bun.build` config) and rely on `node_modules` resolution at run time. `bun:sqlite` is *not* externalizable — it must stay bundled.
- **Bun binary size in installer.** Each platform adds ~80–100 MB of Bun to the unpacked Electron app. Acceptable (Electron + Chromium already dwarfs this), but call it out in the README.
- **`bun.lock` churn on first install.** Drizzle + Electron ecosystems sometimes rewrite lock entries after the first run. Commit it once, then treat it like any other lockfile.
- **Drizzle Kit on Bun.** `bunx drizzle-kit push` works in current Bun; if a regression appears, fall back to `npx drizzle-kit push` (Node) without code changes — `drizzle.config.ts` is runtime-agnostic.

## Out of scope

- Removing Postgres support.
- Replacing Drizzle ORM.
- Replacing Electron with Tauri or a PWA shell.
- Changing the React frontend build (Vite stays).