import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { Expandable } from "@/components/editor/lightbox";
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
      {svg ? (
        <Expandable
          title="Mermaid diagram"
          renderFull={() => (
            <div
              className="w-full h-full flex items-center justify-center [&_svg]:!max-w-none [&_svg]:!w-full [&_svg]:!h-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
        >
          <div className="flex justify-center [&_svg]:max-w-full [&_svg]:h-auto" dangerouslySetInnerHTML={{ __html: svg }} />
        </Expandable>
      ) : !error && <Pending label="Rendering Mermaid diagram…" />}
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
      {result.svg && (() => {
        // As an <img>, the SVG can't run scripts or reach the page.
        const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`;
        return (
          <Expandable
            title="PlantUML diagram"
            renderFull={() => <img className="w-full h-full object-contain" src={src} alt="PlantUML diagram" draggable={false} />}
          >
            <img className="mx-auto max-w-full h-auto" src={src} alt="PlantUML diagram" />
          </Expandable>
        );
      })()}
      {result.error && <DiagramError title="PlantUML error">{result.error}</DiagramError>}
    </>
  );
}

// ── Draw.io (bundled diagrams.net viewer, loaded on first use) ──────────────

interface DrawioGraph {
  container: HTMLElement;
  maxFitScale: number;
  fit(border?: number): void;
  center(horizontal?: boolean, vertical?: boolean): void;
}

interface GraphViewerStatic {
  createViewerForElement(element: HTMLElement, callback?: (viewer: { graph: DrawioGraph }) => void): void;
}

declare global {
  interface Window {
    GraphViewer?: GraphViewerStatic;
  }
}

const DRAWIO_VIEWER_URL = "/vendor/drawio/viewer-static.min.js";
// Room left for the viewer's own zoom/layers toolbar under the diagram.
const DRAWIO_TOOLBAR_HEIGHT = 40;
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
  const xml = code.trim();
  const looksLikeDrawio = /<mxfile[\s>]|<mxGraphModel[\s>]/.test(xml);

  if (!looksLikeDrawio) {
    return (
      <DiagramError title="Not a draw.io diagram">
        Put the diagram's XML (draw.io: File › Export as › XML, or the contents of a .drawio file) inside the ```drawio block.
      </DiagramError>
    );
  }

  return (
    // The viewer has its own zoom controls, so the lightbox doesn't pan or zoom it.
    <Expandable title="Draw.io diagram" pannable={false} renderFull={() => <DrawioCanvas xml={xml} large />}>
      <DrawioCanvas xml={xml} />
    </Expandable>
  );
}

/** Mounts the diagrams.net viewer for `xml`; `large` fits it to a full-screen box. */
function DrawioCanvas({ xml, large = false }: { xml: string; large?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | null = null;
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
          resize: !large,
          "auto-fit": true,
          lightbox: false,
          highlight: "#007fd4",
        }));
        if (large) el.style.width = "100%";
        host.current.appendChild(el);
        viewer.createViewerForElement(el, ({ graph }) => {
          if (!large || cancelled || !host.current) return;
          // Full screen: fill the box (the viewer's auto-fit only ever shrinks).
          const hostEl = host.current;
          const refit = () => {
            graph.container.style.height = `${Math.max(200, hostEl.clientHeight - DRAWIO_TOOLBAR_HEIGHT)}px`;
            graph.maxFitScale = 8;
            graph.fit(24);
            graph.center(true, true);
          };
          refit();
          observer = new ResizeObserver(refit);
          observer.observe(hostEl);
        });
        setError(null);
        setReady(true);
      })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [xml, large]);

  return (
    <div className={large ? "w-full h-full flex flex-col" : "w-full"}>
      {!ready && !error && <Pending label="Loading draw.io viewer…" />}
      <div ref={host} className={large ? "w-full flex-1 min-h-0" : "w-full"} data-testid="drawio-host" />
      {error && <DiagramError title="Draw.io error">{error}</DiagramError>}
    </div>
  );
}
