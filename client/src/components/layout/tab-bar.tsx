import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  Code2, Eye, EyeOff, File, FileJson, FileSpreadsheet, FileText, FileType, Globe, Image as ImageIcon, Layers, LocateFixed,
  Pin, PinOff, Shapes, Trash2, Workflow, X, XSquare,
} from "lucide-react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PathMenuItems, useGroupOf, useRootFolderOf, useTabsInFolder } from "@/components/layout/path-actions";
import { MoveMenuItem } from "@/components/layout/move-file-context";
import { useRevealInExplorer } from "@/components/layout/explorer-reveal";
import { useDeleteDocument, useDocuments } from "@/hooks/use-documents";
import { baseName } from "@/lib/fs-api";
import {
  folderColour, orderedTabs, parseUri, useWorkspace, useWorkspaceActions, type FolderGroup,
} from "@/lib/workspace";
import { fileKindOf, type FileKind } from "@shared/fs";

interface TabInfo {
  uri: string;
  label: string;
  /** Extra text to tell apart tabs with the same name (the parent folder). */
  detail?: string;
  tooltip: string;
  type: FileKind;
  path?: string;
  dbId?: number;
  rootFolder?: { folder: string; index: number } | null;
  /** Explorer group the file belongs to; a hidden group hides the tab. */
  group?: FolderGroup | null;
}

function TabIcon({ type }: { type: TabInfo["type"] }) {
  const cls = "w-3 h-3 shrink-0";
  if (type === "json") return <FileJson className={`${cls} text-blue-500`} />;
  if (type === "yaml") return <Code2 className={`${cls} text-purple-500`} />;
  if (type === "md") return <FileText className={`${cls} text-gray-400`} />;
  if (type === "html") return <Globe className={`${cls} text-rose-500`} />;
  if (type === "drawio") return <Workflow className={`${cls} text-orange-500`} />;
  if (type === "image") return <ImageIcon className={`${cls} text-emerald-500`} />;
  if (type === "docx") return <FileType className={`${cls} text-blue-600`} />;
  if (type === "xlsx") return <FileSpreadsheet className={`${cls} text-green-600`} />;
  if (type === "mermaid") return <Shapes className={`${cls} text-pink-500`} />;
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
  const groupOf = useGroupOf();
  const tabsInFolder = useTabsInFolder();
  const scroller = useRef<HTMLDivElement>(null);
  const reveal = useRevealInExplorer();

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
        type: fileKindOf(ref.path),
        path: ref.path,
        rootFolder: rootFolderOf(ref.path),
        group: groupOf(ref.path),
      };
    }).filter((t): t is TabInfo => t !== null);

    const counts = new Map<string, number>();
    list.forEach(t => counts.set(t.label, (counts.get(t.label) ?? 0) + 1));
    list.forEach(t => {
      if (t.path && (counts.get(t.label) ?? 0) > 1) t.detail = parentName(t.path);
    });
    return list;
  }, [state, documents, rootFolderOf, groupOf]);

  // Tabs in hidden groups stay open but leave the tab bar. The active tab
  // always shows, so the editor never displays a document without a tab.
  const isHidden = (t: TabInfo) => !!t.group?.hidden && t.uri !== activeUri;
  const visibleTabs = tabs.filter(t => !isHidden(t));
  const hiddenTabs = tabs.filter(isHidden);

  // Keep the active tab in view when the wrapped tab area has to scroll.
  useEffect(() => {
    const area = scroller.current;
    const el = area?.querySelector<HTMLElement>('[data-active="true"]');
    if (!area || !el) return;
    if (el.offsetTop < area.scrollTop) area.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > area.scrollTop + area.clientHeight) {
      area.scrollTop = el.offsetTop + el.offsetHeight - area.clientHeight;
    }
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
    // Bulk closes act on the tabs you can see, never on hidden ones.
    const toTheRight = visibleTabs.slice(index + 1).filter(t => !state.pinned.includes(t.uri)).map(t => t.uri);
    const others = visibleTabs.filter(t => t.uri !== tab.uri && !state.pinned.includes(t.uri)).map(t => t.uri);
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
            className={`group relative flex items-center gap-1.5 h-8 pl-2.5 pr-1 min-w-0 max-w-[200px] shrink-0 text-[12px] cursor-pointer border-r border-b border-gray-200 select-none ${
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
            {tab.group?.hidden && (
              <span title={`In hidden group “${tab.group.name}”`} data-testid="tab-hidden-group">
                <EyeOff className="w-3 h-3 shrink-0 text-gray-400" />
              </span>
            )}
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
          <ContextMenuItem onSelect={() => close(visibleTabs.filter(t => !state.pinned.includes(t.uri)).map(t => t.uri))}>
            <XSquare className="w-3.5 h-3.5 mr-2" /> Close All
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => reveal(tab.uri)} data-testid="menu-reveal">
            <LocateFixed className="w-3.5 h-3.5 mr-2" /> {tab.path ? "Reveal in Explorer" : "Reveal in Documents"}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => togglePin(tab.uri)}>
            {pinned
              ? <><PinOff className="w-3.5 h-3.5 mr-2" /> Unpin</>
              : <><Pin className="w-3.5 h-3.5 mr-2" /> Pin</>}
          </ContextMenuItem>
          {tab.path && <MoveMenuItem path={tab.path} />}
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

  const pinnedTabs = visibleTabs.filter(t => state.pinned.includes(t.uri));
  const otherTabs = visibleTabs.filter(t => !state.pinned.includes(t.uri));

  return (
    // Capped height: with very many tabs the area scrolls instead of pushing the editor down.
    <div ref={scroller} className="relative shrink-0 bg-[#f3f3f3] max-h-[30vh] overflow-y-auto" data-testid="tab-bar">
      {pinnedTabs.length > 0 && (
        <TabRow label="Pinned tabs" className="bg-[#e9eaec]" testId="tab-row-pinned">
          <span className="flex items-center h-8 px-2 shrink-0 text-amber-500 border-b border-gray-200" title="Pinned tabs">
            <Pin className="w-3 h-3 fill-amber-500" />
          </span>
          {pinnedTabs.map(tab => renderTab(tab, visibleTabs.indexOf(tab)))}
        </TabRow>
      )}
      <TabRow label="Open tabs" testId="tab-row-open">
        {otherTabs.length === 0
          ? <span className="flex items-center h-8 px-3 text-[12px] text-gray-400">No other open tabs</span>
          : otherTabs.map(tab => renderTab(tab, visibleTabs.indexOf(tab)))}
        {hiddenTabs.length > 0 && <HiddenTabsMenu tabs={hiddenTabs} onOpen={open} />}
      </TabRow>
    </div>
  );
}

/** Chip at the end of the tab row: how many tabs hidden groups hold, and how to get them back. */
function HiddenTabsMenu({ tabs, onOpen }: { tabs: TabInfo[]; onOpen(uri: string): void }) {
  const { setGroupHidden } = useWorkspaceActions();
  const groups = Array.from(new Map(tabs.map(t => [t.group!.id, t.group!])).values());
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1 h-8 px-2.5 shrink-0 text-[11px] text-gray-500 hover:bg-gray-100 border-b border-gray-200"
          title="Tabs hidden by explorer groups"
          data-testid="button-hidden-tabs"
        >
          <EyeOff className="w-3 h-3" /> {tabs.length} hidden
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-h-[60vh] overflow-y-auto">
        <DropdownMenuLabel className="text-[11px] text-gray-500 font-medium">Hidden groups</DropdownMenuLabel>
        {groups.map(g => (
          <DropdownMenuItem key={g.id} onSelect={() => setGroupHidden(g.id, false)} data-testid={`menu-show-group-${g.id}`}>
            <Eye className="w-3.5 h-3.5 mr-2" />
            <span className="truncate">Show “{g.name}” tabs</span>
            <span className="ml-auto pl-2 text-[10px] text-gray-400">{tabs.filter(t => t.group?.id === g.id).length}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] text-gray-500 font-medium">Open a hidden tab</DropdownMenuLabel>
        {tabs.map(t => (
          <DropdownMenuItem key={t.uri} onSelect={() => onOpen(t.uri)} title={t.tooltip}>
            <TabIcon type={t.type} />
            <span className="ml-2 truncate">{t.label}</span>
            <span className="ml-auto pl-2 flex items-center gap-1 text-[10px] text-gray-400 shrink-0">
              <Layers className="w-2.5 h-2.5" />{t.group?.name}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A group of tabs that wraps onto extra lines. */
function TabRow({ label, className = "", testId, children }: {
  label: string;
  className?: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    // Tabs wrap onto as many lines as they need; each tab has a bottom border
    // so the lines read as separate rows.
    <div role="tablist" aria-label={label} className={`flex flex-wrap items-stretch ${className}`} data-testid={testId}>
      {children}
    </div>
  );
}
