import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp, CaseSensitive, ChevronDown, ChevronRight, X } from "lucide-react";

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
  /** Whether the replace row is open (only shown when `canReplace`). */
  replaceOpen: boolean;
  replacement: string;
  /** False for read-only sources and the preview-only layout. */
  canReplace: boolean;
  onReplacement(value: string): void;
  onToggleReplace(): void;
  onReplace(): void;
  onReplaceAll(): void;
}

/**
 * Floating find box (Ctrl+F, or Ctrl+H with replace): Enter/F3 next,
 * Shift+Enter/Shift+F3 previous, Esc closes. In the replace box, Enter
 * replaces the current match and Ctrl+Alt+Enter replaces all.
 */
export function FindBar({
  query, matchCase, current, total, focusRequest, onQuery, onMatchCase, onNext, onPrevious, onClose,
  replaceOpen, replacement, canReplace, onReplacement, onToggleReplace, onReplace, onReplaceAll,
}: FindBarProps) {
  const input = useRef<HTMLInputElement>(null);
  const showReplace = canReplace && replaceOpen;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusRequest]);

  const button = "flex items-center justify-center w-6 h-6 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40";

  return (
    <div
      className={`absolute top-2 right-5 z-30 flex flex-col gap-1 rounded-md border border-gray-200 bg-white ${canReplace ? "pl-1" : "pl-2"} pr-1 py-1 shadow-lg`}
      role="search"
      data-testid="find-bar"
    >
      <div className="flex items-center gap-1">
      {canReplace && (
        <button
          className={button}
          onClick={onToggleReplace}
          aria-expanded={showReplace}
          title={showReplace ? "Hide replace" : "Replace (Ctrl+H)"}
          data-testid="find-replace-toggle"
        >
          {showReplace ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
      )}
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
      {showReplace && (
        <div className="flex items-center gap-1 pl-7">
          <input
            value={replacement}
            onChange={e => onReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.altKey) { e.preventDefault(); onReplaceAll(); }
              else if (e.key === "Enter") { e.preventDefault(); onReplace(); }
              if (e.key === "Escape") { e.preventDefault(); onClose(); }
            }}
            placeholder="Replace"
            className="w-56 h-6 text-[13px] bg-transparent focus:outline-none"
            aria-label="Replace with"
            data-testid="find-replace-input"
          />
          <button
            className="h-6 px-2 rounded text-[11px] font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40"
            onClick={onReplace}
            disabled={!total}
            title="Replace (Enter)"
            data-testid="find-replace-one"
          >
            Replace
          </button>
          <button
            className="h-6 px-2 rounded text-[11px] font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40"
            onClick={onReplaceAll}
            disabled={!total}
            title="Replace all (Ctrl+Alt+Enter)"
            data-testid="find-replace-all"
          >
            Replace all
          </button>
        </div>
      )}
    </div>
  );
}

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
