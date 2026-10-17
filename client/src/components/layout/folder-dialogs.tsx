import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Folder, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { desktop, fsApi, fsKeys, useFsStatus, baseName, FsConflictError } from "@/lib/fs-api";
import { fileUri, useWorkspaceActions } from "@/lib/workspace";

interface FolderDialogsValue {
  /** Native picker in the desktop app; a folder browser dialog otherwise. */
  openFolder(): void;
  /** Asks for a file name and creates the file in `directory`. */
  newFileIn(directory: string): void;
}

const FolderDialogsContext = createContext<FolderDialogsValue | null>(null);

export function useFolderDialogs() {
  const ctx = useContext(FolderDialogsContext);
  if (!ctx) throw new Error("useFolderDialogs must be used inside FolderDialogsProvider");
  return ctx;
}

export function FolderDialogsProvider({ children }: { children: ReactNode }) {
  const { addFolders, setSidebar } = useWorkspaceActions();
  const [browserOpen, setBrowserOpen] = useState(false);
  const [newFileDir, setNewFileDir] = useState<string | null>(null);

  const openFolder = useCallback(() => {
    if (desktop) {
      void desktop.pickFolders().then(paths => {
        if (paths.length) {
          addFolders(paths);
          setSidebar({ visible: true, panel: "explorer" });
        }
      });
    } else {
      setBrowserOpen(true);
    }
  }, [addFolders, setSidebar]);

  const value = { openFolder, newFileIn: setNewFileDir };

  return (
    <FolderDialogsContext.Provider value={value}>
      {children}
      <FolderBrowserDialog
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        onChoose={(path) => {
          addFolders([path]);
          setSidebar({ visible: true, panel: "explorer" });
          setBrowserOpen(false);
        }}
      />
      <NewFileDialog directory={newFileDir} onClose={() => setNewFileDir(null)} />
    </FolderDialogsContext.Provider>
  );
}

// ── Folder browser (browser fallback for the native picker) ─────────────────

function FolderBrowserDialog({ open, onOpenChange, onChoose }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onChoose(path: string): void;
}) {
  const { data: status } = useFsStatus();
  const [current, setCurrent] = useState("");
  const [typed, setTyped] = useState("");
  // Click selects a subfolder, double-click enters it, Open opens the selection (or the current folder).
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (open && !current && status?.home) {
      setCurrent(status.home);
      setTyped(status.home);
    }
  }, [open, current, status?.home]);

  const { data, isLoading, error } = useQuery({
    queryKey: fsKeys.list(current),
    queryFn: () => fsApi.list(current),
    enabled: open && !!current,
  });

  const go = (path: string) => {
    setCurrent(path);
    setTyped(path);
    setSelected(null);
  };

  const target = selected ?? data?.path ?? null;

  const dirs = data?.entries.filter(e => e.kind === "directory") ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Open Folder</DialogTitle>
          <DialogDescription>
            Paste a full path or browse: click a folder to select it, double-click to go into it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); if (typed.trim()) go(typed.trim()); }}
        >
          <Input value={typed} onChange={e => setTyped(e.target.value)} className="font-mono text-xs" data-testid="input-folder-path" />
          <Button type="button" variant="secondary" size="icon" disabled={!data?.parent} onClick={() => data?.parent && go(data.parent)} title="Up one folder">
            <ArrowUp className="w-4 h-4" />
          </Button>
        </form>
        <div className="h-64 overflow-y-auto border rounded-md text-sm">
          {isLoading ? (
            <div className="flex items-center gap-2 p-3 text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : error ? (
            <div className="p-3 text-red-600">{(error as Error).message}</div>
          ) : dirs.length === 0 ? (
            <div className="p-3 text-gray-500 italic">No subfolders</div>
          ) : (
            dirs.map(d => (
              <button
                key={d.path}
                type="button"
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${
                  selected === d.path ? "bg-blue-100" : "hover:bg-gray-100"
                }`}
                onClick={() => setSelected(d.path)}
                onDoubleClick={() => go(d.path)}
                data-testid={`folder-option-${d.name}`}
              >
                <Folder className="w-4 h-4 text-yellow-500 shrink-0" />
                <span className="truncate">{d.name}</span>
              </button>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => target && onChoose(target)} disabled={!target} data-testid="button-open-this-folder">
            Open {target ? `"${baseName(target)}"` : "folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── New file on disk ─────────────────────────────────────────────────────────

const NEW_FILE_TYPES = [
  { ext: ".md", label: "Markdown" },
  { ext: ".json", label: "JSON" },
  { ext: ".yaml", label: "YAML" },
] as const;

const STARTER_CONTENT: Record<string, string> = { ".md": "", ".json": "{}\n", ".yaml": "" };

function NewFileDialog({ directory, onClose }: { directory: string | null; onClose(): void }) {
  const queryClient = useQueryClient();
  const { open, setExpanded } = useWorkspaceActions();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [ext, setExt] = useState<string>(".md");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (directory) {
      setName("");
      setBusy(false);
    }
  }, [directory]);

  const create = async () => {
    if (!directory || !name.trim()) return;
    const fileName = /\.[a-z]+$/i.test(name.trim()) ? name.trim() : name.trim() + ext;
    setBusy(true);
    try {
      const created = await fsApi.create({
        directory,
        name: fileName,
        content: STARTER_CONTENT[fileName.slice(fileName.lastIndexOf(".")).toLowerCase()] ?? "",
      });
      await queryClient.invalidateQueries({ queryKey: fsKeys.list(directory) });
      setExpanded(directory, true);
      onClose();
      open(fileUri(created.path));
    } catch (err) {
      setBusy(false);
      toast({
        description: err instanceof FsConflictError ? `"${fileName}" already exists.` : (err as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={!!directory} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New File</DialogTitle>
          <DialogDescription className="break-all">In {directory}</DialogDescription>
        </DialogHeader>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <Input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="file name"
            data-testid="input-new-file-name"
          />
          <select
            value={ext}
            onChange={e => setExt(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            aria-label="File type"
            data-testid="select-new-file-type"
          >
            {NEW_FILE_TYPES.map(t => <option key={t.ext} value={t.ext}>{t.label} ({t.ext})</option>)}
          </select>
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void create()} disabled={busy || !name.trim()} data-testid="button-create-file">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
