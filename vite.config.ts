import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf8"),
) as { version?: string; buildNumber?: number | string };

function resolveGitSha(): string {
  if (process.env.GIT_SHA) return process.env.GIT_SHA;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: import.meta.dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const baseVersion = pkg.version || "1.0.0";
const buildNumber =
  process.env.BUILD_NUMBER ||
  process.env.GITHUB_RUN_NUMBER ||
  (pkg.buildNumber ? String(pkg.buildNumber) : "");
const appVersion =
  process.env.APP_VERSION ||
  process.env.VITE_APP_VERSION ||
  (buildNumber ? `${baseVersion}.${buildNumber}` : baseVersion);
const gitSha = resolveGitSha();
const buildDate = process.env.BUILD_DATE || new Date().toISOString();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_NUMBER__: JSON.stringify(buildNumber),
    __GIT_SHA__: JSON.stringify(gitSha),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
