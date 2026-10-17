import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { FS_CLIENT_HEADER } from "@shared/fs";
import type { PlantUmlRenderResponse } from "@shared/diagrams";

/** Fenced code languages rendered as diagrams instead of code. */
export const DIAGRAM_LANGUAGES = {
  mermaid: "mermaid",
  plantuml: "plantuml",
  puml: "plantuml",
  drawio: "drawio",
} as const;

export type DiagramKind = (typeof DIAGRAM_LANGUAGES)[keyof typeof DIAGRAM_LANGUAGES];

// Diagrams re-render only after typing pauses.
const RENDER_DELAY_MS = 400;

export function DiagramBlock({ kind, code }: { kind: DiagramKind; code: string }) {
  const debounced = useDebounce(code, RENDER_DELAY_MS);
  return (
    <div className="not-prose my-4 rounded-lg border border-gray-200 bg-white p-3 overflow-x-auto" data-diagram={kind}>
      {kind === "mermaid" ? <MermaidDiagram code={debounced} />
        : kind === "plantuml" ? <PlantUmlDiagram code={debounced} />
        : <DrawioDiagram code={debounced} />}
    </div>
  );
}

function Pending({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-gray-400 py-6 justify-center">
      <Loader2 className="w-3.5 h-3.5 animate-spin" /> {label}
    </div>
  );
}

function DiagramError({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-100 px-3 py-2 text-[12px] text-red-700" data-testid="diagram-error">
      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="whitespace-pre-wrap break-words">{children}</div>
      </div>
    </div>
  );
}

// ── Mermaid (rendered in the page; loaded only when a diagram is shown) ──────

type Mermaid = (typeof import("mermaid"))["default"];
let mermaidLoader: Promise<Mermaid> | null = null;
let mermaidCounter = 0;
const mermaidCache = new Map<string, string>();

function loadMermaid() {
  mermaidLoader ??= import("mermaid").then(({ default: mermaid }) => {
    // "strict" sanitises labels and disables click handlers and scripts.
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default", fontFamily: "Inter, sans-serif" });
    return mermaid;
  });
  return mermaidLoader;
}

function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState(() => mermaidCache.get(code) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = mermaidCache.get(code);
    if (cached) {
      setSvg(cached);
      setError(null);
      return;
    }
    void loadMermaid().then(async mermaid => {
      const id = `mdc-mermaid-${++mermaidCounter}`;
      try {
        const result = await mermaid.render(id, code);
        mermaidCache.set(code, result.svg);
        if (!cancelled) { setSvg(result.svg); setError(null); }
      } catch (err) {
        // Keep the last good drawing while the diagram is being edited.
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        // Mermaid leaves its scratch element behind when rendering fails.
        document.getElementById(`d${id}`)?.remove();
      }
    });
    return () => { cancelled = true; };
  }, [code]);

  return (
    <>
      {svg ? <div className="flex justify-center [&_svg]:max-w-full [&_svg]:h-auto" dangerouslySetInnerHTML={{ __html: svg }} />
        : !error && <Pending label="Rendering Mermaid diagram…" />}
      {error && <DiagramError title="Mermaid error">{error}</DiagramError>}
    </>
  );
}

// ── PlantUML (rendered by local Java through the app's server) ──────────────

function PlantUmlDiagram({ code }: { code: string }) {
  const [result, setResult] = useState<PlantUmlRenderResponse | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/diagrams/plantuml", {
      method: "POST",
      headers: { "Content-Type": "application/json", [FS_CLIENT_HEADER]: "1" },
      body: JSON.stringify({ source: code }),
    })
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setUnavailable(body?.message ?? `PlantUML rendering failed (HTTP ${res.status})`);
          return;
        }
        setUnavailable(null);
        setResult(body as PlantUmlRenderResponse);
      })
      .catch(err => { if (!cancelled) setUnavailable(err.message); });
    return () => { cancelled = true; };
  }, [code]);

  if (unavailable) return <DiagramError title="PlantUML unavailable">{unavailable}</DiagramError>;
  if (!result) return <Pending label="Rendering PlantUML diagram…" />;

  return (
    <>
      {result.svg && (
        // As an <img>, the SVG can't run scripts or reach the page.
        <img
          className="mx-auto max-w-full h-auto"
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`}
          alt="PlantUML diagram"
        />
      )}
      {result.error && <DiagramError title="PlantUML error">{result.error}</DiagramError>}
    </>
  );
}

// ── Draw.io (bundled diagrams.net viewer, loaded on first use) ──────────────

interface GraphViewerStatic {
  createViewerForElement(element: HTMLElement, callback?: () => void): void;
}

declare global {
  interface Window {
    GraphViewer?: GraphViewerStatic;
  }
}

const DRAWIO_VIEWER_URL = "/vendor/drawio/viewer-static.min.js";
let drawioLoader: Promise<GraphViewerStatic> | null = null;

function loadDrawioViewer() {
  drawioLoader ??= new Promise<GraphViewerStatic>((resolve, reject) => {
    if (window.GraphViewer) return resolve(window.GraphViewer);
    const script = document.createElement("script");
    script.src = DRAWIO_VIEWER_URL;
    script.async = true;
    script.onload = () => window.GraphViewer
      ? resolve(window.GraphViewer)
      : reject(new Error("The draw.io viewer loaded but didn't start."));
    script.onerror = () => {
      drawioLoader = null;
      reject(new Error("The draw.io viewer is missing. Run: bun script/fetch-vendor.mjs"));
    };
    document.head.appendChild(script);
  });
  return drawioLoader;
}

function DrawioDiagram({ code }: { code: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const xml = code.trim();
  const looksLikeDrawio = /<mxfile[\s>]|<mxGraphModel[\s>]/.test(xml);

  useEffect(() => {
    if (!looksLikeDrawio) return;
    let cancelled = false;
    loadDrawioViewer()
      .then(viewer => {
        if (cancelled || !host.current) return;
        host.current.replaceChildren();
        const el = document.createElement("div");
        el.className = "mxgraph";
        el.setAttribute("data-mxgraph", JSON.stringify({
          xml,
          toolbar: "zoom layers pages",
          nav: true,
          resize: true,
          "auto-fit": true,
          lightbox: false,
          highlight: "#007fd4",
        }));
        host.current.appendChild(el);
        viewer.createViewerForElement(el);
        setError(null);
        setReady(true);
      })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [xml, looksLikeDrawio]);

  if (!looksLikeDrawio) {
    return (
      <DiagramError title="Not a draw.io diagram">
        Put the diagram's XML (draw.io: File › Export as › XML, or the contents of a .drawio file) inside the ```drawio block.
      </DiagramError>
    );
  }

  return (
    <>
      {!ready && !error && <Pending label="Loading draw.io viewer…" />}
      <div ref={host} className="w-full" data-testid="drawio-host" />
      {error && <DiagramError title="Draw.io error">{error}</DiagramError>}
    </>
  );
}
