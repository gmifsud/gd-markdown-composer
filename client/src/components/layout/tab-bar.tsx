import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Code2, File, FileJson, FileText, Pin, PinOff, Trash2, X, XSquare } from "lucide-react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { PathMenuItems, useRootFolderOf, useTabsInFolder } from "@/components/layout/path-actions";
import { useDeleteDocument, useDocuments } from "@/hooks/use-documents";
import { baseName } from "@/lib/fs-api";
import {
  folderColour, orderedTabs, parseUri, useWorkspace, useWorkspaceActions,
} from "@/lib/workspace";
import { editableTypeOf } from "@shared/fs";

interface TabInfo {
  uri: string;
  label: string;
  /** Extra text to tell apart tabs with the same name (the parent folder). */
  detail?: string;
  tooltip: string;
  type: "md" | "json" | "yaml" | "text";
  path?: string;
  dbId?: number;
  rootFolder?: { folder: string; index: number } | null;
}

function TabIcon({ type }: { type: TabInfo["type"] }) {
  const cls = "w-3 h-3 shrink-0";
  if (type === "json") return <FileJson className={`${cls} text-blue-500`} />;
  if (type === "yaml") return <Code2 className={`${cls} text-purple-500`} />;
  if (type === "md") return <FileText className={`${cls} text-gray-400`} />;
  return <File className={`${cls} text-gray-400`} />;
}

function parentName(path: string) {
  const parent = path.replace(/[\\/][^\\/]+$/, "");
  return baseName(parent);
}

/** One slim row of open tabs; scrolls sideways when it overflows. */
export function TabBar() {
  const { state, activeUri } = useWorkspace();
  const { open, close, togglePin, pruneDb } = useWorkspaceActions();
  const { data: documents } = useDocuments();
  const deleteMutation = useDeleteDocument();
  const [, setLocation] = useLocation();
  const rootFolderOf = useRootFolderOf();
  const tabsInFolder = useTabsInFolder();
  const scroller = useRef<HTMLDivElement>(null);

  // Drop tabs of database documents that no longer exist.
  useEffect(() => {
    if (documents) pruneDb(documents.map(d => d.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents]);

  const tabs = useMemo<TabInfo[]>(() => {
    const list = orderedTabs(state).map((uri): TabInfo | null => {
      const ref = parseUri(uri);
      if (!ref) return null;
      if (ref.kind === "db") {
        const doc = documents?.find(d => d.id === ref.id);
        const title = doc?.title || "Untitled";
        return { uri, label: title, tooltip: `${title} (document)`, type: (doc?.fileType as TabInfo["type"]) ?? "md", dbId: ref.id };
      }
      return {
        uri,
        label: baseName(ref.path),
        tooltip: ref.path,
        type: editableTypeOf(ref.path) ?? "text",
        path: ref.path,
        rootFolder: rootFolderOf(ref.path),
      };
    }).filter((t): t is TabInfo => t !== null);

    const counts = new Map<string, number>();
    list.forEach(t => counts.set(t.label, (counts.get(t.label) ?? 0) + 1));
    list.forEach(t => {
      if (t.path && (counts.get(t.label) ?? 0) > 1) t.detail = parentName(t.path);
    });
    return list;
  }, [state, documents, rootFolderOf]);

  // Keep the active tab in view.
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeUri, tabs.length]);

  if (tabs.length === 0) {
    return <div className="h-8 shrink-0 bg-[#f3f3f3] border-b border-gray-200" />;
  }

  const deleteDocument = (tab: TabInfo) => {
    if (tab.dbId === undefined) return;
    if (window.confirm(`Delete "${tab.label}"? You can undo this from the notification that follows.`)) {
      deleteMutation.mutate(tab.dbId, {
        onSuccess: () => {
          if (activeUri === tab.uri) setLocation("/");
          close([tab.uri]);
        },
      });
    }
  };

  const renderTab = (tab: TabInfo, index: number) => {
    const active = tab.uri === activeUri;
    const pinned = state.pinned.includes(tab.uri);
    const colour = tab.rootFolder ? folderColour(tab.rootFolder.index) : null;
    const toTheRight = tabs.slice(index + 1).filter(t => !state.pinned.includes(t.uri)).map(t => t.uri);
    const others = tabs.filter(t => t.uri !== tab.uri && !state.pinned.includes(t.uri)).map(t => t.uri);
    const inFolder = tab.rootFolder ? tabsInFolder(tab.rootFolder.folder) : [];

    return (
      <ContextMenu key={tab.uri}>
        <ContextMenuTrigger asChild>
          <div
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            data-active={active}
            title={tab.tooltip}
            className={`group relative flex items-center gap-1.5 pl-2.5 pr-1 min-w-0 max-w-[200px] shrink-0 text-[12px] cursor-pointer border-r border-gray-200 select-none ${
              active ? "bg-white text-gray-900" : "text-gray-600 hover:bg-gray-100"
            }`}
            onClick={() => open(tab.uri)}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); close([tab.uri]); } }}
            onKeyDown={(e) => { if (e.key === "Delete") close([tab.uri]); }}
            data-testid={`tab-${tab.uri}`}
          >
            {active && <span className="absolute inset-x-0 top-0 h-[2px] bg-[#007fd4]" aria-hidden />}
            {colour && (
              <span
                className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r"
                style={{ background: colour }}
                title={tab.rootFolder?.folder}
                data-testid="tab-folder-hint"
                aria-hidden
              />
            )}
            <TabIcon type={tab.type} />
            <span className="truncate">{tab.label}</span>
            {tab.detail && <span className="truncate text-[10px] text-gray-400 shrink">{tab.detail}</span>}
            <button
              className={`ml-0.5 flex items-center justify-center w-4 h-4 rounded shrink-0 hover:bg-gray-300/70 ${
                active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
              onClick={(e) => { e.stopPropagation(); close([tab.uri]); }}
              title="Close (middle-click)"
              aria-label={`Close ${tab.label}`}
              data-testid={`button-close-${tab.uri}`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          <ContextMenuItem onSelect={() => close([tab.uri])} data-testid="menu-close-tab">
            <X className="w-3.5 h-3.5 mr-2" /> Close
          </ContextMenuItem>
          <ContextMenuItem disabled={others.length === 0} onSelect={() => close(others)}>
            <XSquare className="w-3.5 h-3.5 mr-2" /> Close Others
          </ContextMenuItem>
          <ContextMenuItem disabled={toTheRight.length === 0} onSelect={() => close(toTheRight)} data-testid="menu-close-right">
            <XSquare className="w-3.5 h-3.5 mr-2" /> Close Tabs to the Right
          </ContextMenuItem>
          {tab.rootFolder && (
            <ContextMenuItem onSelect={() => close(inFolder)} data-testid="menu-close-folder-tabs">
              <XSquare className="w-3.5 h-3.5 mr-2" style={{ color: colour ?? undefined }} />
              Close Tabs in “{baseName(tab.rootFolder.folder)}” ({inFolder.length})
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => close(tabs.filter(t => !state.pinned.includes(t.uri)).map(t => t.uri))}>
            <XSquare className="w-3.5 h-3.5 mr-2" /> Close All
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => togglePin(tab.uri)}>
            {pinned
              ? <><PinOff className="w-3.5 h-3.5 mr-2" /> Unpin</>
              : <><Pin className="w-3.5 h-3.5 mr-2" /> Pin</>}
          </ContextMenuItem>
          {tab.path && (
            <>
              <ContextMenuSeparator />
              <PathMenuItems path={tab.path} root={tab.rootFolder?.folder} />
            </>
          )}
          {tab.dbId !== undefined && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem className="text-red-600 focus:text-red-600" onSelect={() => deleteDocument(tab)}>
                <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete Document
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const pinnedTabs = tabs.filter(t => state.pinned.includes(t.uri));
  const otherTabs = tabs.filter(t => !state.pinned.includes(t.uri));

  return (
    <div ref={scroller} className="shrink-0 bg-[#f3f3f3] border-b border-gray-200" data-testid="tab-bar">
      {pinnedTabs.length > 0 && (
        <TabRow label="Pinned tabs" className="bg-[#e9eaec] border-b border-gray-200" testId="tab-row-pinned">
          <span className="flex items-center px-2 shrink-0 text-amber-500" title="Pinned tabs">
            <Pin className="w-3 h-3 fill-amber-500" />
          </span>
          {pinnedTabs.map(tab => renderTab(tab, tabs.indexOf(tab)))}
        </TabRow>
      )}
      <TabRow label="Open tabs" testId="tab-row-open">
        {otherTabs.length === 0
          ? <span className="flex items-center px-3 text-[12px] text-gray-400">No other open tabs</span>
          : otherTabs.map(tab => renderTab(tab, tabs.indexOf(tab)))}
      </TabRow>
    </div>
  );
}

/** One horizontally scrolling row of tabs. */
function TabRow({ label, className = "", testId, children }: {
  label: string;
  className?: string;
  testId: string;
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={row}
      role="tablist"
      aria-label={label}
      className={`h-8 flex items-stretch overflow-x-auto overflow-y-hidden scroll-thin ${className}`}
      onWheel={(e) => {
        // Let a normal mouse wheel scroll the row sideways.
        if (row.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) row.current.scrollLeft += e.deltaY;
      }}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
