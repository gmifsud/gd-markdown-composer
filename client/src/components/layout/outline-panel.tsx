import { useDeferredValue, useMemo, useState } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { requestReveal, useActiveEditor } from "@/lib/active-editor";
import { parseOutline, type OutlineHeading } from "@/lib/outline";

const LEVEL_STYLE: Record<OutlineHeading["level"], string> = {
  1: "font-semibold text-[#e5e5e5]",
  2: "text-[#d4d4d4]",
  3: "text-[#c4c4c4]",
  4: "text-[#a8a8a8]",
  5: "text-[#9a9a9a]",
  6: "text-[#8a8a8a]",
};

/** Headings (H1–H6) of the Markdown document in the editor; click one to jump to it. */
export function OutlinePanel() {
  const active = useActiveEditor();
  // Parsing waits for typing to settle instead of running on every keystroke.
  const content = useDeferredValue(active?.content ?? "");
  const isMarkdown = active?.fileType === "md";
  const headings = useMemo(() => (isMarkdown ? parseOutline(content) : []), [content, isMarkdown]);
  const [maxLevel, setMaxLevel] = useState<number>(6);
  const shown = headings.filter(h => h.level <= maxLevel);
  const minLevel = headings.reduce((m, h) => Math.min(m, h.level), 6);

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] text-[#cccccc] select-none overflow-hidden">
      <div className="flex items-center justify-between px-3 h-9 shrink-0 border-b border-[#2d2d2d]">
        <span className="text-[11px] font-semibold tracking-widest uppercase text-[#bbbbbb]">Outline</span>
        {isMarkdown && headings.length > 0 && (
          <button
            className="flex items-center justify-center w-6 h-6 rounded text-[#858585] hover:text-[#cccccc] hover:bg-[#2a2d2e]"
            onClick={() => setMaxLevel(maxLevel === 6 ? Math.min(6, minLevel + 1) : 6)}
            title={maxLevel === 6 ? "Show top-level headings only" : "Show all headings"}
            data-testid="button-outline-collapse"
          >
            {maxLevel === 6 ? <ChevronsDownUp className="w-3.5 h-3.5" /> : <ChevronsUpDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {active && isMarkdown && (
        <div className="px-3 py-1.5 text-[11px] text-[#858585] truncate border-b border-[#2d2d2d]" title={active.title}>
          {active.title || "Untitled"}
        </div>
      )}

      <nav className="flex-1 overflow-y-auto py-1 scroll-dark" aria-label="Document outline" data-testid="outline-panel">
        {!active ? (
          <p className="px-4 py-3 text-[12px] text-[#858585]">Open a Markdown file to see its outline.</p>
        ) : !isMarkdown ? (
          <p className="px-4 py-3 text-[12px] text-[#858585]">The outline is available for Markdown files.</p>
        ) : headings.length === 0 ? (
          <p className="px-4 py-3 text-[12px] text-[#858585]">No headings yet. Start a line with # to add one.</p>
        ) : (
          shown.map(h => (
            <button
              key={`${h.line}-${h.text}`}
              className={`w-full flex items-center gap-2 pr-3 h-[24px] text-left text-[13px] hover:bg-[#2a2d2e] focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#007fd4] ${LEVEL_STYLE[h.level]}`}
              style={{ paddingLeft: `${12 + (h.level - minLevel) * 14}px` }}
              onClick={() => requestReveal(active.uri, { line: h.line, heading: { text: h.text, occurrence: h.occurrence } })}
              title={`${"#".repeat(h.level)} ${h.text} — line ${h.line + 1}`}
              data-testid="outline-item"
            >
              <span className="shrink-0 w-5 text-[9px] font-mono text-[#6b6b6b]">H{h.level}</span>
              <span className="truncate">{h.text}</span>
            </button>
          ))
        )}
      </nav>
    </div>
  );
}
