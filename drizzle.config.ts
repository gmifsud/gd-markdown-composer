import { defineConfig } from "drizzle-kit";

const dbType = (process.env.DB_TYPE ?? "sqlite").toLowerCase();

export default defineConfig(
  dbType === "postgres"
    ? {
        out: "./migrations/pg",
        schema: "./shared/schema.ts",
        dialect: "postgresql",
        dbCredentials: {
          url: process.env.DATABASE_URL ?? (() => { throw new Error("DATABASE_URL must be set for postgres mode"); })(),
        },
      }
    : {
        out: "./migrations/sqlite",
        schema: "./server/schema.sqlite.ts",
        dialect: "sqlite",
        dbCredentials: {
          url: process.env.SQLITE_PATH ?? "./data/editor.db",
        },
      }
);
