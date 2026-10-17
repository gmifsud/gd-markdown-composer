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