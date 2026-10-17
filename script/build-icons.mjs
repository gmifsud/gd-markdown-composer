#!/usr/bin/env bun
/**
 * Renders electron/icons/icon.svg to the PNGs the app uses:
 *
 *   electron/icons/icon.png        1024px  installer/app icon (electron-builder converts it)
 *   electron/icons/icon-256.png     256px  window/taskbar icon
 *   client/public/favicon.png        64px  browser tab icon
 *   client/public/favicon.svg               crisp browser tab icon
 *
 * Usage:  bun script/build-icons.mjs   (re-run after editing icon.svg)
 */
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const svg = await readFile("electron/icons/icon.svg", "utf8");

const outputs = [
  ["electron/icons/icon.png", 1024],
  ["electron/icons/icon-256.png", 256],
  ["client/public/favicon.png", 64],
];

for (const [file, size] of outputs) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  await writeFile(file, png);
  console.log(`wrote ${file} (${size}px)`);
}

await copyFile("electron/icons/icon.svg", "client/public/favicon.svg");
console.log("wrote client/public/favicon.svg");
