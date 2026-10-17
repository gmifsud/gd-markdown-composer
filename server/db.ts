import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import pg from "pg";
import { mkdirSync, existsSync } from "fs";
import path from "path";
import { documents as pgDocuments } from "@shared/schema";
import { documents as sqliteDocuments } from "./schema.sqlite";

const { Pool } = pg;

export const dbType = (
  (process.env.DB_TYPE ?? "sqlite").toLowerCase()
) as "sqlite" | "postgres";

// ── SQLite ────────────────────────────────────────────────────────────────────
function setupSqlite() {
  const dbPath = path.resolve(process.env.SQLITE_PATH ?? "./data/editor.db");
  const dir = path.dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const sqlite = new Database(dbPath, { create: true });

  // Create table if not already present (no separate migration step required)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT    NOT NULL DEFAULT 'Untitled Document',
      content    TEXT    NOT NULL DEFAULT '',
      file_type  TEXT    NOT NULL DEFAULT 'md',
      created_at TEXT             DEFAULT (datetime('now')),
      updated_at TEXT             DEFAULT (datetime('now'))
    )
  `);

  const db = drizzleSqlite(sqlite, { schema: { documents: sqliteDocuments } });
  return { db, documents: sqliteDocuments };
}

// ── PostgreSQL ────────────────────────────────────────────────────────────────
function setupPostgres() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be set when DB_TYPE=postgres. " +
        "Add it to your .env file or environment."
    );
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzlePg(pool, { schema: { documents: pgDocuments } });
  return { db, documents: pgDocuments };
}

// ── Export the active connection ──────────────────────────────────────────────
const setup = dbType === "postgres" ? setupPostgres() : setupSqlite();

export const db        = setup.db        as any;
export const documents = setup.documents as any;

console.log(`[db] Using ${dbType === "postgres" ? "PostgreSQL" : "SQLite"} database`);