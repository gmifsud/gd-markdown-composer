import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Files, Library } from "lucide-react";
import { FolderExplorer } from "@/components/layout/folder-explorer";
import { DocumentsPanel } from "@/components/layout/documents-panel";
import {
  SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH,
  useWorkspace, useWorkspaceActions, type SidebarPanel,
} from "@/lib/workspace";

const PANELS: { id: SidebarPanel; label: string; icon: JSX.Element }[] = [
  { id: "explorer", label: "Explorer (folders)", icon: <Files className="w-5 h-5" /> },
  { id: "documents", label: "Documents by type", icon: <Library className="w-5 h-5" /> },
];

/** Left activity bar: picks the sidebar panel; clicking the active one hides the sidebar. */
export function ActivityBar() {
  const { state } = useWorkspace();
  const { setSidebar } = useWorkspaceActions();
  const { visible, panel } = state.sidebar;

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
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  if (!visible) return null;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width };
    document.body.style.cursor = "col-resize";
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setSidebar({ width: drag.current.startWidth + e.clientX - drag.current.startX });
  };
  const endDrag = () => {
    drag.current = null;
    document.body.style.cursor = "";
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 50 : 10;
    if (e.key === "ArrowLeft") { e.preventDefault(); setSidebar({ width: width - step }); }
    if (e.key === "ArrowRight") { e.preventDefault(); setSidebar({ width: width + step }); }
  };

  return (
    <div className="relative h-full shrink-0 border-r border-[#252526]" style={{ width }} data-testid="sidebar">
      {panel === "explorer" ? <FolderExplorer /> : <DocumentsPanel />}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={width}
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
