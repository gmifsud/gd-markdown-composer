import type { Express } from "express";
import { spawn, execFile } from "child_process";
import { createHash } from "crypto";
import { existsSync } from "fs";
import path from "path";
import { isFsAccessEnabled, localOnlyGuard } from "./fs-routes";
import type { DiagramStatus, PlantUmlRenderResponse } from "@shared/diagrams";

// PlantUML runs locally with Java and the jar fetched by script/fetch-vendor.mjs,
// so diagram text never leaves the machine.

const RENDER_TIMEOUT_MS = 20_000;
const MAX_SOURCE_LENGTH = 200_000;
const MAX_CONCURRENT = 2;
const CACHE_SIZE = 100;

function javaCommand() {
  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    const candidate = path.join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java");
    if (existsSync(candidate)) return candidate;
  }
  return "java";
}

function plantUmlJar(): string | null {
  const candidates = [
    process.env.PLANTUML_JAR,
    path.resolve("vendor/plantuml/plantuml.jar"),
  ].filter((p): p is string => !!p);
  return candidates.find(p => existsSync(p)) ?? null;
}

let javaCheck: Promise<string | null> | null = null;

/** Resolves null when Java runs, or a reason it doesn't. Checked once. */
function checkJava(): Promise<string | null> {
  javaCheck ??= new Promise(resolve => {
    execFile(javaCommand(), ["-version"], { timeout: 10_000, windowsHide: true }, (err) => {
      resolve(err ? "Java was not found. Install Java (or set JAVA_HOME) to render PlantUML." : null);
    });
  });
  return javaCheck;
}

async function plantUmlStatus(): Promise<DiagramStatus["plantuml"]> {
  if (!isFsAccessEnabled()) return { available: false, reason: "PlantUML rendering is only available in the desktop app and when running locally." };
  if (!plantUmlJar()) return { available: false, reason: "plantuml.jar is missing. Run: bun script/fetch-vendor.mjs" };
  const javaProblem = await checkJava();
  return javaProblem ? { available: false, reason: javaProblem } : { available: true };
}

// ── Rendering with a small cache and a concurrency limit ─────────────────────

const cache = new Map<string, PlantUmlRenderResponse>();
let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>(r => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function renderPlantUml(source: string, jar: string): Promise<PlantUmlRenderResponse> {
  return new Promise(resolve => {
    const child = spawn(javaCommand(), [
      "-Djava.awt.headless=true",
      // No local file includes or URL fetches from diagram text.
      "-DPLANTUML_SECURITY_PROFILE=SANDBOX",
      "-jar", jar,
      "-tsvg", "-pipe", "-charset", "UTF-8",
    ], { windowsHide: true });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ svg: null, error: `Rendering took longer than ${RENDER_TIMEOUT_MS / 1000}s` });
    }, RENDER_TIMEOUT_MS);

    child.stdout.setEncoding("utf8").on("data", d => { stdout += d; });
    child.stderr.setEncoding("utf8").on("data", d => { stderr += d; });
    child.on("error", err => {
      clearTimeout(timer);
      resolve({ svg: null, error: err.message });
    });
    child.on("close", code => {
      clearTimeout(timer);
      const svgStart = stdout.indexOf("<svg");
      const svg = svgStart >= 0 ? stdout.slice(svgStart) : null;
      // PlantUML exits non-zero on syntax errors but still draws an error image.
      const error = code === 0 ? undefined : stderr.trim().split(/\r?\n/).filter(Boolean).join(" · ") || `PlantUML exited with code ${code}`;
      resolve({ svg, error });
    });

    child.stdin.end(source, "utf8");
  });
}

export function registerDiagramRoutes(app: Express) {
  app.get("/api/diagrams/status", async (_req, res) => {
    const status: DiagramStatus = { plantuml: await plantUmlStatus() };
    res.json(status);
  });

  app.post("/api/diagrams/plantuml", localOnlyGuard, async (req, res) => {
    const status = await plantUmlStatus();
    const jar = plantUmlJar();
    if (!status.available || !jar) return res.status(503).json({ message: status.reason });

    let source = req.body?.source;
    if (typeof source !== "string" || !source.trim()) return res.status(400).json({ message: "source is required" });
    if (source.length > MAX_SOURCE_LENGTH) return res.status(413).json({ message: "Diagram is too large" });
    // Fenced blocks often omit the @start/@end lines.
    if (!/^\s*@start\w+/m.test(source)) source = `@startuml\n${source}\n@enduml\n`;

    const key = createHash("sha256").update(source).digest("hex");
    let result = cache.get(key);
    if (!result) {
      result = await withSlot(() => renderPlantUml(source, jar));
      cache.set(key, result);
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
    }
    res.json(result);
  });
}
