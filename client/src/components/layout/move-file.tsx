import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { MoveFileContext, type MoveFileValue } from "@/components/layout/move-file-context";
import { useRevealInExplorer } from "@/components/layout/explorer-reveal";
import { isExplorerSearching } from "@/components/layout/explorer-search";
import { useRootFolderOf } from "@/components/layout/path-actions";
import { useToast } from "@/hooks/use-toast";
import {
  FsConflictError, FsNotFoundError, baseName, dirName, fsApi, fsKeys, pathKey, samePath, useFsStatus,
} from "@/lib/fs-api";
import { flushAllPendingSaves } from "@/lib/pending-saves";
import { moveUnlocked } from "@/lib/unlocked-files";
import { fileUri, folderColour, parseUri, useWorkspace, useWorkspaceActions } from "@/lib/workspace";

/**
 * Moves a file to another folder of the explorer, from "Move to…" (a folder
 * picker) or by dragging it onto a folder. The move itself is one request;
 * afterwards only the two folders involved are refreshed.
 */
export function MoveFileProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: status } = useFsStatus();
  const { state, activeUri } = useWorkspace();
  const { retarget } = useWorkspaceActions();
  const reveal = useRevealInExplorer();
  const [choosing, setChoosing] = useState<string | null>(null);
  const moving = useRef(false);
  const caseInsensitive = status?.caseInsensitive ?? true;

  // The moves below run across awaits, so they read the workspace as it is by then.
  const live = useRef({ state, activeUri });
  live.current = { state, activeUri };

  const refreshFolders = (...dirs: string[]) => {
    void queryClient.invalidateQueries({
      queryKey: ["fs-list"],
      // Cached listings use the folder as the explorer wrote it, so compare loosely.
      predicate: q => typeof q.queryKey[1] === "string"
        && dirs.some(dir => samePath(q.queryKey[1] as string, dir, caseInsensitive)),
    });
    void queryClient.invalidateQueries({ queryKey: ["fs-search"] });
  };

  // Rows and the explorer keep one context value for good; it calls the latest version of this.
  const latest = useRef<MoveFileValue["moveFile"]>(async () => false);
  latest.current = async (from, toDirectory) => {
    if (moving.current) return false;
    moving.current = true;
    const name = baseName(from);
    const { state: workspace, activeUri: active } = live.current;
    const tabs = workspace.openTabs.filter(uri => {
      const ref = parseUri(uri);
      return ref?.kind === "file" && samePath(ref.path, from, caseInsensitive);
    });
    try {
      // Only the open tab can have unsaved edits. They are written first so they move with the file.
      if (active && tabs.includes(active) && !(await flushAllPendingSaves())) {
        toast({ description: `"${name}" has changes that couldn't be saved, so it wasn't moved.`, variant: "destructive" });
        return false;
      }
      const moved = await fsApi.move({ from, toDirectory });
      const toUri = fileUri(moved.path);
      moveUnlocked(from, moved.path);
      for (const uri of tabs) {
        const ref = parseUri(uri);
        if (ref?.kind === "file") moveUnlocked(ref.path, moved.path);
        retarget(uri, toUri);
      }
      refreshFolders(dirName(from), toDirectory);
      toast({ description: `Moved "${name}" to "${baseName(toDirectory)}"` });
      // Show where it went, unless a search is showing or the explorer isn't on screen.
      const { sidebar } = live.current.state;
      if (sidebar.visible && sidebar.panel === "explorer" && !isExplorerSearching()) {
        reveal(toUri, { quiet: true, keepPanel: true });
      }
      return true;
    } catch (err) {
      // A failure often means the listings are out of date (file or folder gone), so refresh them.
      refreshFolders(dirName(from), toDirectory);
      toast({ description: failureMessage(err, name), variant: "destructive" });
      return false;
    } finally {
      moving.current = false;
    }
  };

  const value = useMemo<MoveFileValue>(() => ({
    chooseFolderFor: setChoosing,
    moveFile: (from, toDirectory) => latest.current(from, toDirectory),
  }), []);

  return (
    <MoveFileContext.Provider value={value}>
      {children}
      <MoveFileDialog path={choosing} onClose={() => setChoosing(null)} onMove={value.moveFile} />
    </MoveFileContext.Provider>
  );
}

function failureMessage(err: unknown, name: string) {
  if (err instanceof FsConflictError) return err.message;
  if (err instanceof FsNotFoundError) return `Couldn't move "${name}": it or the folder no longer exists.`;
  return `Couldn't move "${name}": ${(err as Error).message}`;
}

// ── Folder picker ────────────────────────────────────────────────────────────

function MoveFileDialog({ path, onClose, onMove }: {
  path: string | null;
  onClose(): void;
  onMove(from: string, toDirectory: string): Promise<boolean>;
}) {
  // Keep showing the file while the dialog fades out.
  const shown = useRef(path);
  if (path) shown.current = path;

  return (
    <Dialog open={!!path} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        {shown.current && <FolderPicker path={shown.current} onClose={onClose} onMove={onMove} />}
      </DialogContent>
    </Dialog>
  );
}

/** What the tree rows share: which folders are open, the chosen one, and where the file is now. */
interface Picker {
  isOpen(dir: string): boolean;
  toggle(dir: string): void;
  isSelected(dir: string): boolean;
  select(dir: string): void;
  /** The folder the file is in: listed, but it can't be the destination. */
  isCurrent(dir: string): boolean;
}

function FolderPicker({ path, onClose, onMove }: {
  path: string;
  onClose(): void;
  onMove(from: string, toDirectory: string): Promise<boolean>;
}) {
  const { state } = useWorkspace();
  const { data: status } = useFsStatus();
  const rootFolderOf = useRootFolderOf();
  const caseInsensitive = status?.caseInsensitive ?? true;
  const key = (dir: string) => pathKey(dir, caseInsensitive);
  const currentDir = dirName(path);

  // Start with the file's own folder showing, not the whole workspace.
  const [open, setOpen] = useState<Set<string>>(() => {
    const keys = new Set<string>();
    const root = rootFolderOf(path);
    if (!root) return keys;
    const sep = path.includes("\\") ? "\\" : "/";
    let dir = root.folder.replace(/[\\/]+$/, "");
    keys.add(key(root.folder));
    for (const part of path.slice(root.folder.length).split(/[\\/]+/).filter(Boolean).slice(0, -1)) {
      dir = `${dir}${sep}${part}`;
      keys.add(key(dir));
    }
    return keys;
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const picker: Picker = {
    isOpen: dir => open.has(key(dir)),
    toggle: dir => setOpen(prev => {
      const next = new Set(prev);
      if (!next.delete(key(dir))) next.add(key(dir));
      return next;
    }),
    isSelected: dir => selected !== null && key(selected) === key(dir),
    select: dir => { if (!samePath(dir, currentDir, caseInsensitive)) setSelected(dir); },
    isCurrent: dir => samePath(dir, currentDir, caseInsensitive),
  };

  const move = async () => {
    if (!selected) return;
    setBusy(true);
    const moved = await onMove(path, selected);
    if (moved) onClose();
    else setBusy(false);
  };

  // Arrow keys walk the rows; right/left open and close a folder; Enter or Space chooses it.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const row = e.target instanceof Element ? e.target.closest<HTMLElement>('[role="treeitem"]') : null;
    const dir = row?.dataset.dir;
    if (!row || !dir) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'));
      rows[rows.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
    } else if (e.key === "ArrowRight" && !picker.isOpen(dir)) {
      picker.toggle(dir);
    } else if (e.key === "ArrowLeft" && picker.isOpen(dir)) {
      picker.toggle(dir);
    } else if (e.key === "Enter" || e.key === " ") {
      picker.select(dir);
    } else {
      return;
    }
    e.preventDefault();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="break-all">Move “{baseName(path)}”</DialogTitle>
        <DialogDescription className="break-all">
          Choose the folder to move it to. Click a folder to select it; use the arrow to open it.
        </DialogDescription>
      </DialogHeader>

      <div
        role="tree"
        aria-label="Folders"
        className="h-72 overflow-y-auto border rounded-md text-sm py-1"
        onKeyDown={onKeyDown}
        data-testid="move-folder-tree"
      >
        {state.folders.length === 0 ? (
          <p className="p-3 text-gray-500 italic">Open a folder in the explorer first.</p>
        ) : (
          state.folders.map((folder, index) => (
            <FolderNode key={folder} dir={folder} label={baseName(folder)} depth={0} colour={folderColour(index)} picker={picker} />
          ))
        )}
      </div>

      <p className="text-xs text-gray-500 break-all min-h-4" data-testid="move-destination">
        {selected ? <>Move to <span className="font-mono">{selected}</span></> : "No folder chosen yet."}
      </p>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => void move()} disabled={busy || !selected} data-testid="button-move-here">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Move here"}
        </Button>
      </DialogFooter>
    </>
  );
}

function FolderNode({ dir, label, depth, colour, picker }: {
  dir: string;
  label: string;
  depth: number;
  /** Set for workspace folders, which show the colour used for them elsewhere. */
  colour?: string;
  picker: Picker;
}) {
  const open = picker.isOpen(dir);
  const current = picker.isCurrent(dir);
  const selected = picker.isSelected(dir);
  const row = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (current) row.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <>
      <div
        ref={row}
        role="treeitem"
        aria-expanded={open}
        aria-selected={selected}
        aria-disabled={current || undefined}
        data-dir={dir}
        tabIndex={0}
        title={dir}
        className={`flex items-center gap-1.5 pr-3 py-1 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-500 ${
          selected ? "bg-blue-100" : current ? "text-gray-500 cursor-default" : "hover:bg-gray-100"
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => picker.select(dir)}
        onDoubleClick={() => picker.toggle(dir)}
        data-testid={`move-folder-${label}`}
      >
        <button
          type="button"
          tabIndex={-1}
          className="flex items-center justify-center w-4 h-4 shrink-0 rounded text-gray-600 hover:bg-gray-200"
          aria-label={open ? `Close ${label}` : `Open ${label}`}
          onClick={(e) => { e.stopPropagation(); picker.toggle(dir); }}
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        {colour
          ? <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colour }} aria-hidden />
          : open
            ? <FolderOpen className="w-4 h-4 shrink-0 text-yellow-500" />
            : <Folder className="w-4 h-4 shrink-0 text-yellow-500" />}
        <span className="flex-1 truncate">{label}</span>
        {current && <span className="shrink-0 text-xs text-gray-500">current folder</span>}
      </div>
      {open && <FolderChildren dir={dir} depth={depth + 1} picker={picker} />}
    </>
  );
}

/** The subfolders of `dir`. Only folders that are open are read, and only their folders (not files). */
function FolderChildren({ dir, depth, picker }: { dir: string; depth: number; picker: Picker }) {
  const { data, isLoading, error } = useQuery({
    queryKey: fsKeys.folders(dir),
    queryFn: () => fsApi.list(dir, { foldersOnly: true }),
    staleTime: 15_000,
  });
  const pad = { paddingLeft: `${8 + depth * 16 + 20}px` };

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 py-1 text-xs text-gray-500" style={pad}>
        <Loader2 className="w-3 h-3 animate-spin" /> Loading…
      </div>
    );
  }
  if (error) {
    return <div className="py-1 pr-3 text-xs text-red-600 truncate" style={pad} title={(error as Error).message}>{(error as Error).message}</div>;
  }
  if (!data?.entries.length) {
    return <div className="py-1 text-xs text-gray-400 italic" style={pad}>No subfolders</div>;
  }
  return (
    <>
      {data.entries.map(entry => (
        <FolderNode key={entry.path} dir={entry.path} label={entry.name} depth={depth} picker={picker} />
      ))}
    </>
  );
}
