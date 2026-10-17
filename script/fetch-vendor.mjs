#!/usr/bin/env bun
/**
 * Fetches the third-party diagram renderers that are too large to commit:
 *
 *   vendor/plantuml/plantuml.jar                         PlantUML (MIT build), run with local Java
 *   client/public/vendor/drawio/viewer-static.min.js     diagrams.net viewer (Apache-2.0)
 *
 * Both paths are gitignored. Downloads are pinned and checked against
 * SHA-256 hashes, and existing files with the right hash are kept.
 *
 * Usage:  bun script/fetch-vendor.mjs
 */
import { mkdir, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const ASSETS = [
  {
    name: "PlantUML 1.2026.9 (MIT build)",
    url: "https://github.com/plantuml/plantuml/releases/download/v1.2026.9/plantuml-mit-1.2026.9.jar",
    sha256: "835b2f2eb1d756da3f03bffdbd0baf252b4b858547a741ac8e972958a09c7f91",
    dest: "vendor/plantuml/plantuml.jar",
  },
  {
    name: "diagrams.net viewer v32.4.1",
    url: "https://raw.githubusercontent.com/jgraph/drawio/v32.4.1/src/main/webapp/js/viewer-static.min.js",
    sha256: "bc7586cb62eec98018c13b78619078d3a7179cc7bfc711c566dda19527520a30",
    dest: "client/public/vendor/drawio/viewer-static.min.js",
  },
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

let failed = false;
for (const asset of ASSETS) {
  const dest = path.resolve(asset.dest);
  const existing = Bun.file(dest);
  if (await existing.exists()) {
    if (sha256(new Uint8Array(await existing.arrayBuffer())) === asset.sha256) {
      console.log(`✓ ${asset.name} (already present)`);
      continue;
    }
  }

  console.log(`> ${asset.name}\n  ${asset.url}`);
  const res = await fetch(asset.url);
  if (!res.ok) {
    console.error(`  download failed: HTTP ${res.status}`);
    failed = true;
    continue;
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const actual = sha256(buf);
  if (actual !== asset.sha256) {
    console.error(`  checksum mismatch\n    expected ${asset.sha256}\n    got      ${actual}`);
    failed = true;
    continue;
  }

  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.download`;
  await Bun.write(tmp, buf);
  await rm(dest, { force: true });
  await rename(tmp, dest);
  console.log(`  wrote ${asset.dest} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
}

process.exit(failed ? 1 : 0);
