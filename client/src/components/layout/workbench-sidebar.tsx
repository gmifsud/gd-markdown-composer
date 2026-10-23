import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Files, Library, ListTree } from "lucide-react";
import { FolderExplorer } from "@/components/layout/folder-explorer";
import { DocumentsPanel } from "@/components/layout/documents-panel";
import { OutlinePanel } from "@/components/layout/outline-panel";
import { focusExplorerSearch } from "@/components/layout/explorer-search";
import {
  SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH,
  useWorkspace, useWorkspaceActions, type SidebarPanel,
} from "@/lib/workspace";

const PANELS: { id: SidebarPanel; label: string; icon: JSX.Element }[] = [
  { id: "explorer", label: "Explorer (folders)", icon: <Files className="w-5 h-5" /> },
  { id: "documents", label: "Documents by type", icon: <Library className="w-5 h-5" /> },
  { id: "outline", label: "Outline (headings of the open Markdown file)", icon: <ListTree className="w-5 h-5" /> },
];

/** Left activity bar: picks the sidebar panel; clicking the active one hides the sidebar. */
export function ActivityBar() {
  const { state } = useWorkspace();
  const { setSidebar } = useWorkspaceActions();
  const { visible, panel } = state.sidebar;

  // Ctrl/Cmd+Shift+F: search file contents in the open folders.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSidebar({ visible: true, panel: "explorer" });
        // Wait for the explorer to mount before focusing its search box.
        setTimeout(() => focusExplorerSearch(true), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSidebar]);

  return (
    <div className="flex flex-col items-center py-1 gap-1 w-11 shrink-0 bg-[#333333] border-r border-[#252526]">
      {PANELS.map(p => {
        const active = visible && panel === p.id;
        return (
          <button
            key={p.id}
            className={`relative flex items-center justify-center w-11 h-10 transition-colors ${
              active ? "text-white" : "text-[#858585] hover:text-white"
            }`}
            onClick={() => setSidebar(active ? { visible: false } : { visible: true, panel: p.id })}
            title={p.label}
            aria-pressed={active}
            data-testid={`activity-${p.id}`}
          >
            {active && <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-white" />}
            {p.icon}
          </button>
        );
      })}
    </div>
  );
}

/** Sidebar with a drag handle on its right edge; width is saved with the workspace. */
export function WorkbenchSidebar() {
  const { state } = useWorkspace();
  const { setSidebar } = useWorkspaceActions();
  const { visible, width, panel } = state.sidebar;
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);
  // While dragging, the width lives here and is saved to the workspace once on
  // release: saving on every pointer move re-rendered the whole explorer tree
  // and rewrote localStorage dozens of times a second.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  // Same element between renders, so a drag re-renders only this frame, not the panel.
  const content = useMemo(
    () => (panel === "explorer" ? <FolderExplorer /> : panel === "documents" ? <DocumentsPanel /> : <OutlinePanel />),
    [panel],
  );

  if (!visible) return null;

  const shownWidth = dragWidth ?? width;
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width, width };
    document.body.style.cursor = "col-resize";
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH,
      drag.current.startWidth + e.clientX - drag.current.startX)));
    drag.current.width = next;
    setDragWidth(next);
  };
  const endDrag = () => {
    if (drag.current && drag.current.width !== width) setSidebar({ width: drag.current.width });
    drag.current = null;
    setDragWidth(null);
    document.body.style.cursor = "";
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 50 : 10;
    if (e.key === "ArrowLeft") { e.preventDefault(); setSidebar({ width: width - step }); }
    if (e.key === "ArrowRight") { e.preventDefault(); setSidebar({ width: width + step }); }
  };

  return (
    <div className="relative h-full shrink-0 border-r border-[#252526]" style={{ width: shownWidth }} data-testid="sidebar">
      {content}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={shownWidth}
        tabIndex={0}
        className="absolute top-0 -right-[3px] z-20 h-full w-[6px] cursor-col-resize hover:bg-[#007fd4]/60 focus-visible:bg-[#007fd4] focus:outline-none transition-colors"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setSidebar({ width: SIDEBAR_DEFAULT_WIDTH })}
        onKeyDown={onKeyDown}
        title="Drag to resize · double-click to reset"
        data-testid="sidebar-resize-handle"
      />
    </div>
  );
}
