import { forwardRef, useEffect, useLayoutEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from "react";
import { ArrowDown, ArrowUp, CaseSensitive, X } from "lucide-react";

export type Range = [start: number, end: number];

/** Every occurrence of `query` in `text` (case-insensitive unless `matchCase`). */
export function findMatches(text: string, query: string, matchCase: boolean): Range[] {
  if (!query) return [];
  const haystack = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? query : query.toLowerCase();
  const out: Range[] = [];
  for (let at = haystack.indexOf(needle); at >= 0 && out.length < 10_000; at = haystack.indexOf(needle, at + needle.length)) {
    out.push([at, at + needle.length]);
  }
  return out;
}

// ── Find bar ─────────────────────────────────────────────────────────────────

interface FindBarProps {
  query: string;
  matchCase: boolean;
  /** 0-based current match, or -1 when there is none. */
  current: number;
  total: number;
  focusRequest: number;
  onQuery(query: string): void;
  onMatchCase(value: boolean): void;
  onNext(): void;
  onPrevious(): void;
  onClose(): void;
}

/** Floating find box (Ctrl+F): Enter/F3 next, Shift+Enter/Shift+F3 previous, Esc closes. */
export function FindBar({
  query, matchCase, current, total, focusRequest, onQuery, onMatchCase, onNext, onPrevious, onClose,
}: FindBarProps) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusRequest]);

  const button = "flex items-center justify-center w-6 h-6 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40";

  return (
    <div
      className="absolute top-2 right-5 z-30 flex items-center gap-1 rounded-md border border-gray-200 bg-white pl-2 pr-1 py-1 shadow-lg"
      role="search"
      data-testid="find-bar"
    >
      <input
        ref={input}
        value={query}
        onChange={e => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "F3") { e.preventDefault(); if (e.shiftKey) onPrevious(); else onNext(); }
          if (e.key === "Escape") { e.preventDefault(); onClose(); }
        }}
        placeholder="Find in document"
        className="w-56 h-6 text-[13px] bg-transparent focus:outline-none"
        aria-label="Find in document"
        data-testid="find-input"
      />
      <span
        className={`min-w-[64px] text-right text-[11px] tabular-nums ${query && total === 0 ? "text-red-500" : "text-gray-400"}`}
        data-testid="find-count"
      >
        {query ? (total ? `${current + 1} of ${total}` : "No results") : ""}
      </span>
      <button
        className={`${button} ${matchCase ? "bg-gray-900 text-white hover:bg-gray-800 hover:text-white" : ""}`}
        onClick={() => onMatchCase(!matchCase)}
        aria-pressed={matchCase}
        title="Match case"
        data-testid="find-match-case"
      >
        <CaseSensitive className="w-4 h-4" />
      </button>
      <button className={button} onClick={onPrevious} disabled={!total} title="Previous match (Shift+F3)" data-testid="find-previous">
        <ArrowUp className="w-3.5 h-3.5" />
      </button>
      <button className={button} onClick={onNext} disabled={!total} title="Next match (F3)" data-testid="find-next">
        <ArrowDown className="w-3.5 h-3.5" />
      </button>
      <button className={button} onClick={onClose} title="Close (Esc)" data-testid="find-close">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Source textarea with match highlights ────────────────────────────────────

interface SourceTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  /** Matches to highlight, and which one is current. */
  highlights?: { ranges: Range[]; current: number };
  /** No soft wrapping (plain text files). */
  noWrap?: boolean;
}

/**
 * A textarea with find highlights drawn on a layer behind it. The layer copies
 * the textarea's font, padding and wrapping and follows its scrolling, so the
 * marks line up with the text.
 */
export const SourceTextarea = forwardRef<HTMLTextAreaElement, SourceTextareaProps>(function SourceTextarea(
  { value, highlights, noWrap = false, className = "", onScroll, ...rest }, ref,
) {
  const layer = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const show = !!highlights && highlights.ranges.length > 0;

  const syncScroll = () => {
    if (layer.current && area.current) {
      layer.current.scrollTop = area.current.scrollTop;
      layer.current.scrollLeft = area.current.scrollLeft;
    }
  };
  useLayoutEffect(syncScroll);

  let marked: ReactNode[] = [];
  if (show) {
    let from = 0;
    highlights.ranges.forEach(([start, end], i) => {
      if (start > from) marked.push(value.slice(from, start));
      marked.push(
        <mark key={start} className={i === highlights.current ? "bg-orange-300/80 text-transparent rounded-sm" : "bg-yellow-200/80 text-transparent rounded-sm"}>
          {value.slice(start, end)}
        </mark>,
      );
      from = end;
    });
    // A trailing line break needs a character after it to take up a line.
    marked.push(value.slice(from) + "\n ");
  }

  const wrapClass = noWrap ? "whitespace-pre" : "whitespace-pre-wrap break-words";
  // Both layers always reserve the vertical scrollbar so their text wraps at the same width.
  const overflowClass = noWrap ? "overflow-scroll" : "overflow-y-scroll overflow-x-hidden";

  return (
    <div className="relative flex-1 min-h-0 flex">
      {show && (
        <div
          ref={layer}
          aria-hidden
          className={`${className} ${wrapClass} ${overflowClass} mirror-scroll absolute inset-0 text-transparent pointer-events-none select-none`}
          data-testid="find-highlight-layer"
        >
          {marked}
        </div>
      )}
      <textarea
        ref={(el) => {
          area.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        value={value}
        wrap={noWrap ? "off" : undefined}
        className={`${className} ${overflowClass} relative flex-1`}
        onScroll={(e) => { syncScroll(); onScroll?.(e); }}
        {...rest}
      />
    </div>
  );
});

// ── Preview highlights (CSS Custom Highlight API) ────────────────────────────

const ALL = "mdc-find";
const CURRENT = "mdc-find-current";

type HighlightRegistry = Map<string, unknown>;
const registry = (): HighlightRegistry | null =>
  (typeof CSS !== "undefined" && "highlights" in CSS) ? (CSS as unknown as { highlights: HighlightRegistry }).highlights : null;
const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: globalThis.Range[]) => unknown }).Highlight;

/** Text ranges in the preview matching `query`, skipping the front matter card. */
export function previewRanges(container: HTMLElement, query: string, matchCase: boolean): globalThis.Range[] {
  if (!query) return [];
  const needle = matchCase ? query : query.toLowerCase();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("[data-front-matter], [data-find-skip]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const ranges: globalThis.Range[] = [];
  for (let node = walker.nextNode(); node && ranges.length < 10_000; node = walker.nextNode()) {
    const text = matchCase ? node.nodeValue ?? "" : (node.nodeValue ?? "").toLowerCase();
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
    }
  }
  return ranges;
}

/** Paints all matches and the current one in the preview. */
export function paintPreview(ranges: globalThis.Range[], current: number) {
  const reg = registry();
  if (!reg || !HighlightCtor) return;
  reg.set(ALL, new HighlightCtor(...ranges.filter((_, i) => i !== current)));
  reg.set(CURRENT, new HighlightCtor(...(ranges[current] ? [ranges[current]] : [])));
}

export function clearPreviewPaint() {
  const reg = registry();
  reg?.delete(ALL);
  reg?.delete(CURRENT);
}
