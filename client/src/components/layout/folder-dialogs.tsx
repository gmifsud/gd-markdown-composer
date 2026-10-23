import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Folder, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { desktop, fsApi, fsKeys, useFsStatus, baseName, FsConflictError } from "@/lib/fs-api";
import { fileUri, useWorkspace, useWorkspaceActions } from "@/lib/workspace";
import { markUnlocked } from "@/lib/unlocked-files";

interface FolderDialogsValue {
  /** Native picker in the desktop app; a folder browser dialog otherwise. */
  openFolder(): void;
  /** Asks for a file name and creates the file in `directory`. */
  newFileIn(directory: string): void;
  /** Asks for a name and creates an explorer group, moving `folder` into it if given. */
  newGroup(folder?: string): void;
  /** Asks for a new name for the group. */
  renameGroup(id: string): void;
}

type GroupNameRequest = { mode: "create"; folder?: string } | { mode: "rename"; id: string };

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
  const [groupRequest, setGroupRequest] = useState<GroupNameRequest | null>(null);

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

  // Stable value: every explorer row reads this context.
  const value = useMemo<FolderDialogsValue>(() => ({
    openFolder,
    newFileIn: setNewFileDir,
    newGroup: (folder?: string) => setGroupRequest({ mode: "create", folder }),
    renameGroup: (id: string) => setGroupRequest({ mode: "rename", id }),
  }), [openFolder]);

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
      <GroupNameDialog request={groupRequest} onClose={() => setGroupRequest(null)} />
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

// ── Explorer group name ──────────────────────────────────────────────────────

function GroupNameDialog({ request, onClose }: { request: GroupNameRequest | null; onClose(): void }) {
  const { state } = useWorkspace();
  const { createGroup, renameGroup, setSidebar } = useWorkspaceActions();
  const [name, setName] = useState("");
  const existing = request?.mode === "rename" ? state.groups.find(g => g.id === request.id) : undefined;

  useEffect(() => {
    if (request) setName(existing?.name ?? "");
    // Reset only when a new request opens the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const submit = () => {
    const trimmed = name.trim();
    if (!request || !trimmed) return;
    if (request.mode === "rename") renameGroup(request.id, trimmed);
    else {
      createGroup(trimmed, request.folder);
      setSidebar({ visible: true, panel: "explorer" });
    }
    onClose();
  };

  return (
    <Dialog open={!!request} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{request?.mode === "rename" ? "Rename Group" : "New Group"}</DialogTitle>
          <DialogDescription className="break-all">
            {request?.mode === "create" && request.folder
              ? `Moves ${baseName(request.folder)} into the new group.`
              : "Groups organise folders in the explorer. Each group can hide its tabs from the tab bar."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Group name"
            maxLength={80}
            data-testid="input-group-name"
          />
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!name.trim()} data-testid="button-save-group">
            {request?.mode === "rename" ? "Rename" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── New file on disk ─────────────────────────────────────────────────────────

// Used when the typed name has no extension. Typing a name with an extension
// ("notes.txt", "build.ps1") always wins; "No extension" keeps the name as typed.
const NEW_FILE_TYPES = [
  { ext: ".md", label: "Markdown (.md)" },
  { ext: ".json", label: "JSON (.json)" },
  { ext: ".yaml", label: "YAML (.yaml)" },
  { ext: ".drawio", label: "Draw.io (.drawio)" },
  { ext: ".mermaid", label: "Mermaid (.mermaid)" },
  { ext: ".txt", label: "Text (.txt)" },
  { ext: "", label: "No extension" },
] as const;

const EMPTY_DRAWIO =
  '<mxfile><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>\n';

const STARTER_CONTENT: Record<string, string> = {
  ".json": "{}\n",
  ".drawio": EMPTY_DRAWIO,
  ".mermaid": "flowchart TD\n    A[Start] --> B[End]\n",
  ".mmd": "flowchart TD\n    A[Start] --> B[End]\n",
};

const hasExtension = (name: string) => /[^.]\.[^.\\/]+$/.test(name);

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
    const fileName = hasExtension(name.trim()) ? name.trim() : name.trim() + ext;
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
      // A file you just created opens ready to edit, whatever its type.
      markUnlocked(created.path);
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
            placeholder="name or name.ext"
            data-testid="input-new-file-name"
          />
          <select
            value={ext}
            onChange={e => setExt(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            aria-label="File type"
            data-testid="select-new-file-type"
          >
            {NEW_FILE_TYPES.map(t => <option key={t.ext || "none"} value={t.ext}>{t.label}</option>)}
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
