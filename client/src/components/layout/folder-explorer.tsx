import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown, ChevronRight, File, FileJson, FileText, Code2, Folder, FolderOpen, FolderPlus,
  Loader2, RefreshCw, X, FilePlus, FolderMinus,
} from "lucide-react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useFolderDialogs } from "@/components/layout/folder-dialogs";
import { PathMenuItems, useTabsInFolder } from "@/components/layout/path-actions";
import { baseName, fsApi, fsKeys, useFsStatus } from "@/lib/fs-api";
import { fileUri, folderColour, useWorkspace, useWorkspaceActions } from "@/lib/workspace";
import { editableTypeOf, type FsEntry } from "@shared/fs";

const INDENT = 12;

function fileIcon(name: string) {
  const type = editableTypeOf(name);
  if (type === "json") return <FileJson className="w-3.5 h-3.5 shrink-0 text-blue-400" />;
  if (type === "yaml") return <Code2 className="w-3.5 h-3.5 shrink-0 text-purple-400" />;
  if (type === "md") return <FileText className="w-3.5 h-3.5 shrink-0 text-gray-300" />;
  return <File className="w-3.5 h-3.5 shrink-0 text-[#858585]" />;
}

/** Explorer for folders on disk; several folders can be open at once. */
export function FolderExplorer() {
  const { data: status, isLoading: statusLoading } = useFsStatus();
  const { state } = useWorkspace();
  const { openFolder } = useFolderDialogs();
  const queryClient = useQueryClient();

  const refreshAll = () => queryClient.invalidateQueries({ queryKey: ["fs-list"] });

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] text-[#cccccc] select-none overflow-hidden">
      <div className="flex items-center justify-between px-3 h-9 shrink-0 border-b border-[#2d2d2d]">
        <span className="text-[11px] font-semibold tracking-widest uppercase text-[#bbbbbb]">Explorer</span>
        {status?.enabled && (
          <div className="flex items-center gap-0.5">
            <button
              className="flex items-center justify-center w-6 h-6 rounded text-[#858585] hover:text-[#cccccc] hover:bg-[#2a2d2e]"
              onClick={refreshAll}
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              className="flex items-center justify-center w-6 h-6 rounded text-[#858585] hover:text-[#cccccc] hover:bg-[#2a2d2e]"
              onClick={openFolder}
              title="Add a folder"
              data-testid="button-open-folder"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden text-[13px] scroll-dark" role="tree" aria-label="Folders">
        {statusLoading ? null : !status?.enabled ? (
          <p className="px-4 py-3 text-[12px] text-[#858585]">
            Opening folders is available in the desktop app and when running locally.
          </p>
        ) : state.folders.length === 0 ? (
          <div className="px-4 py-4 text-[12px] text-[#858585] space-y-3">
            <p>No folder open.</p>
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#0e639c] hover:bg-[#1177bb] text-white text-[12px]"
              onClick={openFolder}
            >
              <FolderOpen className="w-3.5 h-3.5" /> Open Folder
            </button>
          </div>
        ) : (
          state.folders.map((folder, index) => <FolderRoot key={folder} folder={folder} index={index} />)
        )}
      </div>
    </div>
  );
}

function FolderRoot({ folder, index }: { folder: string; index: number }) {
  const { state } = useWorkspace();
  const { setExpanded, removeFolder, close } = useWorkspaceActions();
  const { newFileIn } = useFolderDialogs();
  const queryClient = useQueryClient();
  const tabsInFolder = useTabsInFolder();
  const expanded = state.expanded.includes(folder);
  const colour = folderColour(index);

  const remove = () => {
    close(tabsInFolder(folder));
    removeFolder(folder);
  };

  return (
    <div className="border-b border-[#2d2d2d]" data-testid={`folder-root-${index}`}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="treeitem"
            aria-expanded={expanded}
            tabIndex={0}
            className="group flex items-center gap-1 pl-1 pr-1 h-[22px] cursor-pointer hover:bg-[#2a2d2e] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#007fd4]"
            onClick={() => setExpanded(folder, !expanded)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(folder, !expanded); } }}
            title={folder}
          >
            <span className="text-[#858585] shrink-0">
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </span>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colour }} aria-hidden />
            <span className="flex-1 min-w-0 truncate font-semibold text-[11px] uppercase tracking-wider text-[#bbbbbb] ml-1">
              {baseName(folder)}
            </span>
            <span className="hidden group-hover:flex items-center gap-0.5">
              <button
                className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#3c3c3c] text-[#cccccc]"
                onClick={(e) => { e.stopPropagation(); newFileIn(folder); }}
                title="New file"
              >
                <FilePlus className="w-3.5 h-3.5" />
              </button>
              <button
                className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#3c3c3c] text-[#cccccc]"
                onClick={(e) => { e.stopPropagation(); remove(); }}
                title="Close folder"
                data-testid={`button-close-folder-${index}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          <ContextMenuItem onSelect={() => newFileIn(folder)}>
            <FilePlus className="w-3.5 h-3.5 mr-2" /> New File…
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void queryClient.invalidateQueries({ queryKey: ["fs-list"] })}>
            <RefreshCw className="w-3.5 h-3.5 mr-2" /> Refresh
          </ContextMenuItem>
          <ContextMenuSeparator />
          <PathMenuItems path={folder} isDirectory />
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={remove}>
            <FolderMinus className="w-3.5 h-3.5 mr-2" /> Remove Folder from Workspace
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {expanded && <DirectoryChildren dir={folder} root={folder} depth={1} />}
    </div>
  );
}

function DirectoryChildren({ dir, root, depth }: { dir: string; root: string; depth: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: fsKeys.list(dir),
    queryFn: () => fsApi.list(dir),
    staleTime: 30_000,
  });

  const pad = { paddingLeft: `${8 + depth * INDENT}px` };
  if (isLoading) {
    return <div className="flex items-center gap-1.5 h-[22px] text-[#858585] text-[12px]" style={pad}><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>;
  }
  if (error) {
    return <div className="h-[22px] text-red-400 text-[12px] truncate" style={pad} title={(error as Error).message}>{(error as Error).message}</div>;
  }
  if (!data?.entries.length) {
    return <div className="h-[22px] text-[#858585] text-[12px] italic" style={pad}>Empty folder</div>;
  }
  return (
    <div role="group">
      {data.entries.map(entry => <EntryRow key={entry.path} entry={entry} root={root} depth={depth} />)}
    </div>
  );
}

function EntryRow({ entry, root, depth }: { entry: FsEntry; root: string; depth: number }) {
  const { state, activeUri } = useWorkspace();
  const { open, setExpanded } = useWorkspaceActions();
  const { newFileIn } = useFolderDialogs();
  const isDir = entry.kind === "directory";
  const expanded = isDir && state.expanded.includes(entry.path);
  const isActive = !isDir && activeUri === fileUri(entry.path);

  const activate = () => (isDir ? setExpanded(entry.path, !expanded) : open(fileUri(entry.path)));

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="treeitem"
            aria-expanded={isDir ? expanded : undefined}
            aria-selected={isActive}
            tabIndex={0}
            className={`flex items-center gap-1.5 pr-2 h-[22px] cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#007fd4] ${
              isActive ? "bg-[#37373d] text-white" : "hover:bg-[#2a2d2e] text-[#cccccc]"
            }`}
            style={{ paddingLeft: `${8 + depth * INDENT}px` }}
            onClick={activate}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } }}
            title={entry.path}
            data-testid={`fs-entry-${entry.name}`}
          >
            {isDir ? (
              <>
                <span className="text-[#858585] shrink-0">
                  {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </span>
                {expanded
                  ? <FolderOpen className="w-3.5 h-3.5 shrink-0 text-yellow-400" />
                  : <Folder className="w-3.5 h-3.5 shrink-0 text-yellow-400" />}
              </>
            ) : (
              <>
                <span className="w-3 shrink-0" />
                {fileIcon(entry.name)}
              </>
            )}
            <span className="flex-1 truncate">{entry.name}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          {isDir ? (
            <ContextMenuItem onSelect={() => newFileIn(entry.path)}>
              <FilePlus className="w-3.5 h-3.5 mr-2" /> New File…
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onSelect={() => open(fileUri(entry.path))}>
              {fileIcon(entry.name)} <span className="ml-2">Open</span>
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <PathMenuItems path={entry.path} root={root} isDirectory={isDir} />
        </ContextMenuContent>
      </ContextMenu>

      {expanded && <DirectoryChildren dir={entry.path} root={root} depth={depth + 1} />}
    </>
  );
}
