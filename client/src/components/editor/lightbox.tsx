import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { Maximize, Maximize2, Minimize, Minus, Plus, Scan, X } from "lucide-react";

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const STEP = 1.25;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

interface LightboxProps {
  title: string;
  onClose(): void;
  /**
   * Zoom and pan the content with the wheel, drag and the toolbar. Turn off
   * for content with its own zoom controls (the draw.io viewer).
   */
  pannable?: boolean;
  children: ReactNode;
}

/**
 * Shows a diagram or image over the whole app window. "Full screen" also
 * takes over the screen; Esc or the restore/close buttons go back.
 */
export function Lightbox({ title, onClose, pannable = true, children }: LightboxProps) {
  const root = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  scaleRef.current = scale;
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const fit = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const zoomBy = useCallback((factor: number) => setScale(s => clampScale(s * factor)), []);

  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    onClose();
  }, [onClose]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen().catch(() => undefined);
  };

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      previousFocus?.focus?.();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // In true full screen the browser uses the first Esc to leave full screen.
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (!pannable) return;
    if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(STEP); }
    if (e.key === "-") { e.preventDefault(); zoomBy(1 / STEP); }
    if (e.key === "0") { e.preventDefault(); fit(); }
  };

  // Wheel zooms around the pointer.
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!pannable) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - rect.width / 2;
    const py = e.clientY - rect.top - rect.height / 2;
    const prev = scaleRef.current;
    const next = clampScale(prev * (e.deltaY < 0 ? STEP : 1 / STEP));
    const ratio = next / prev;
    scaleRef.current = next;
    setScale(next);
    setOffset(o => ({ x: px - (px - o.x) * ratio, y: py - (py - o.y) * ratio }));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!pannable || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setOffset({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y });
  };
  const endDrag = () => { drag.current = null; };

  const toolButton = "flex items-center justify-center w-8 h-8 rounded text-gray-200 hover:bg-white/15 hover:text-white";

  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex flex-col bg-[#0b0d10]/95 text-white"
      onKeyDown={onKeyDown}
      data-testid="lightbox"
    >
      <div className="h-11 shrink-0 flex items-center gap-1 px-3 border-b border-white/10">
        <span className="flex-1 truncate text-[13px] text-gray-300">{title}</span>
        {pannable && (
          <>
            <button className={toolButton} onClick={() => zoomBy(1 / STEP)} title="Zoom out (-)" data-testid="lightbox-zoom-out">
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-12 text-center text-[12px] tabular-nums text-gray-300" data-testid="lightbox-scale">
              {Math.round(scale * 100)}%
            </span>
            <button className={toolButton} onClick={() => zoomBy(STEP)} title="Zoom in (+)" data-testid="lightbox-zoom-in">
              <Plus className="w-4 h-4" />
            </button>
            <button className={toolButton} onClick={fit} title="Fit to window (0)" data-testid="lightbox-fit">
              <Scan className="w-4 h-4" />
            </button>
            <div className="w-px h-5 bg-white/15 mx-1" />
          </>
        )}
        <button
          className={toolButton}
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit full screen" : "Full screen"}
          data-testid="lightbox-fullscreen"
        >
          {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
        </button>
        <button ref={closeButton} className={toolButton} onClick={close} title="Restore (Esc)" data-testid="lightbox-close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div
        className={`relative flex-1 min-h-0 ${pannable ? "overflow-hidden cursor-grab active:cursor-grabbing" : "overflow-auto"}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={pannable ? fit : undefined}
      >
        <div
          className="absolute inset-0 p-6 flex items-center justify-center"
          style={pannable ? { transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transformOrigin: "center" } : undefined}
        >
          <div className="w-full h-full flex items-center justify-center rounded-lg bg-white p-4 select-none">
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Hover button that opens a Lightbox; wraps the inline diagram or image. */
export function Expandable({ title, renderFull, pannable, inline = false, className = "", children }: {
  title: string;
  renderFull(): ReactNode;
  pannable?: boolean;
  /** For images inside text: render as an inline box. */
  inline?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const Wrapper = inline ? "span" : "div";
  return (
    <Wrapper className={`group/expand relative ${inline ? "inline-block max-w-full" : "block"} ${className}`}>
      {children}
      <button
        type="button"
        className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1 h-7 px-2 rounded-md bg-gray-900/75 text-white text-[11px] opacity-0 group-hover/expand:opacity-100 focus:opacity-100 transition-opacity"
        onClick={(e) => {
          // Images can sit inside links; expanding must not follow the link.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        title="Open full screen"
        aria-label={`Open ${title} full screen`}
        data-testid="button-expand"
      >
        <Maximize2 className="w-3.5 h-3.5" /> Expand
      </button>
      {open && (
        <Lightbox title={title} pannable={pannable} onClose={() => setOpen(false)}>
          {renderFull()}
        </Lightbox>
      )}
    </Wrapper>
  );
}
