#!/usr/bin/env bun
/**
 * Fetch per-platform Bun binaries into bin/ for the Electron packaged app.
 *
 * Usage:
 *   bun script/fetch-bun.mjs                  # fetch current platform only
 *   bun script/fetch-bun.mjs --all            # fetch all platforms
 *   bun script/fetch-bun.mjs --version v1.4.2 # fetch a specific release tag
 *
 * The bin/ tree is gitignored — re-run this script after upgrading Bun.
 */
import { mkdir, rm, rename } from "node:fs/promises";
import { spawn } from "bun";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const wantAll = args.has("--all");
let version;
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--version=")) version = a.slice("--version=".length);
}
const versionIdx = process.argv.indexOf("--version");
if (versionIdx > -1 && !version) version = process.argv[versionIdx + 1];

const tag = version ? `bun-v${version}` : "bun-v1.4.2";

const platforms = {
  "darwin-x64":   "bun-darwin-x64.zip",
  "darwin-arm64": "bun-darwin-aarch64.zip",
  "linux-x64":    "bun-linux-x64.zip",
  "windows-x64":  "bun-windows-x64.zip",
};

function currentPlatformKey() {
  const map = {
    "darwin-x64":   ["darwin", "x64"],
    "darwin-arm64": ["darwin", "arm64"],
    "linux-x64":    ["linux",  "x64"],
    "windows-x64":  ["win32",  "x64"],
  };
  for (const [key, [os, arch]] of Object.entries(map)) {
    if (process.platform === os && process.arch === arch) return key;
  }
  return null;
}

const targets = wantAll
  ? Object.keys(platforms)
  : [currentPlatformKey()].filter(Boolean);

if (targets.length === 0) {
  console.error(`No matching Bun release for ${process.platform}-${process.arch}.`);
  process.exit(1);
}

const tmpDir = path.resolve("node_modules/.cache/bun-fetch");
await mkdir(tmpDir, { recursive: true });

for (const key of targets) {
  const asset = platforms[key];
  const outDir = path.resolve(`bin/bun-${key}`);
  const binName = key.startsWith("windows") ? "bun.exe" : "bun";
  const url = `https://github.com/oven-sh/bun/releases/download/${tag}/${asset}`;
  const zipPath = path.join(tmpDir, asset);

  console.log(`> ${key} (${asset})`);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  console.log(`  downloading ${url}`);
  const dl = spawn([
    "powershell",
    "-NoProfile",
    "-Command",
    `try { Invoke-WebRequest -Uri '${url}' -OutFile '${zipPath}' -UseBasicParsing } catch { exit 1 }`,
  ], { stdout: "inherit", stderr: "inherit" });
  await dl.exited;
  if (dl.exitCode !== 0) {
    console.error(`  download failed for ${key}`);
    continue;
  }

  console.log(`  extracting`);
  const unzipArgs = key.startsWith("windows")
    ? ["Expand-Archive", `-Path`, zipPath, `-DestinationPath`, outDir, `-Force`]
    : null;
  let extract;
  if (unzipArgs) {
    extract = spawn(["powershell", "-NoProfile", "-Command", unzipArgs.join(" ")], {
      stdout: "inherit",
      stderr: "inherit",
    });
  } else {
    extract = spawn(["unzip", "-o", zipPath, "-d", outDir], {
      stdout: "inherit",
      stderr: "inherit",
    });
  }
  await extract.exited;
  if (extract.exitCode !== 0) {
    console.error(`  extraction failed for ${key}`);
    continue;
  }

  // The zip typically extracts `bun-windows-x64/bun.exe` inside the destination.
  // Flatten so outDir contains bun(.exe) directly.
  const inner = path.join(outDir, path.basename(zipPath, ".zip"));
  const innerBin = path.join(inner, binName);
  const flatBin  = path.join(outDir, binName);
  const innerStat = await Bun.file(innerBin).exists().catch(() => false);
  if (innerStat) {
    await rename(innerBin, flatBin);
    await rm(inner, { recursive: true, force: true });
  }

  console.log(`  wrote ${path.relative(process.cwd(), flatBin)}`);
}

console.log("done.");