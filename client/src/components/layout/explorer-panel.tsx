import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  FileText, FileJson, Code2, ChevronDown, ChevronRight,
  Plus, Trash2, Loader2, FolderOpen, Folder, FolderX, Download
} from "lucide-react";
import { useDocuments, useCreateDocument, useDeleteDocument } from "@/hooks/use-documents";
import { useToast } from "@/hooks/use-toast";

// ── Types ────────────────────────────────────────────────
interface LocalEntry {
  name: string;
  kind: "file" | "directory";
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  children?: LocalEntry[];
  expanded?: boolean;
}

interface ExplorerPanelProps {
  activeId: number | null;
}

// ── Helpers ──────────────────────────────────────────────
function extOf(name: string) {
  if (name.endsWith(".md")) return "md";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".yaml") || name.endsWith(".yml")) return "yaml";
  return null;
}

function fileIcon(name: string, cls = "w-3.5 h-3.5 shrink-0") {
  const ext = extOf(name);
  if (ext === "json") return <FileJson className={`${cls} text-blue-400`} />;
  if (ext === "yaml") return <Code2 className={`${cls} text-purple-400`} />;
  if (ext === "md") return <FileText className={`${cls} text-gray-400`} />;
  return <FileText className={`${cls} text-[#858585]`} />;
}

async function readDir(dirHandle: FileSystemDirectoryHandle): Promise<LocalEntry[]> {
  const entries: LocalEntry[] = [];
  for await (const [, handle] of (dirHandle as any).entries()) {
    entries.push({ name: handle.name, kind: handle.kind, handle, children: undefined, expanded: false });
  }
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ── Sub-component: local file tree entry ─────────────────
function LocalFileEntry({
  entry,
  depth,
  onToggle,
  onImport,
}: {
  entry: LocalEntry;
  depth: number;
  onToggle: (entry: LocalEntry) => void;
  onImport: (entry: LocalEntry) => void;
}) {
  const isDir = entry.kind === "directory";
  const isSupported = isDir || extOf(entry.name) !== null;

  return (
    <>
      <div
        className={`group flex items-center gap-1.5 pr-2 py-[3px] cursor-pointer transition-colors
          ${isSupported ? "hover:bg-[#2a2d2e] text-[#cccccc]" : "text-[#555] cursor-default"}`}
        style={{ paddingLeft: `${12 + depth * 12}px` }}
        onClick={() => isSupported && (isDir ? onToggle(entry) : onImport(entry))}
        title={isDir ? entry.name : `Import "${entry.name}"`}
      >
        {isDir ? (
          <>
            <span className="text-[#858585] shrink-0">
              {entry.expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </span>
            {entry.expanded
              ? <FolderOpen className="w-3.5 h-3.5 shrink-0 text-yellow-400" />
              : <Folder className="w-3.5 h-3.5 shrink-0 text-yellow-400" />}
          </>
        ) : (
          <span className="w-3 h-3 shrink-0" />
        )}
        {!isDir && fileIcon(entry.name)}
        <span className="flex-1 truncate text-[13px]">{entry.name}</span>
        {!isDir && isSupported && (
          <span
            className="opacity-0 group-hover:opacity-100 shrink-0 text-[#858585] hover:text-[#cccccc]"
            title="Import into editor"
          >
            <Download className="w-3 h-3" />
          </span>
        )}
      </div>
      {isDir && entry.expanded && entry.children && (
        entry.children.map(child => (
          <LocalFileEntry
            key={child.name}
            entry={child}
            depth={depth + 1}
            onToggle={onToggle}
            onImport={onImport}
          />
        ))
      )}
    </>
  );
}

// ── Main component ────────────────────────────────────────
export function ExplorerPanel({ activeId }: ExplorerPanelProps) {
  const { data: documents, isLoading } = useDocuments();
  const createMutation = useCreateDocument();
  const deleteMutation = useDeleteDocument();
  const [_, setLocation] = useLocation();
  const { toast } = useToast();

  const [sectionsOpen, setSectionsOpen] = useState({ md: true, json: true, yaml: true });
  const [hoveredSection, setHoveredSection] = useState<string | null>(null);

  // Local folder state
  const [folderName, setFolderName] = useState<string | null>(null);
  const [folderEntries, setFolderEntries] = useState<LocalEntry[]>([]);
  const [folderOpen, setFolderOpen] = useState(true);
  const [importing, setImporting] = useState(false);

  // ── DB actions ───────────────────────────────────────────
  const handleCreate = (fileType: "md" | "json" | "yaml") => {
    createMutation.mutate({ fileType }, { onSuccess: (d) => setLocation(`/d/${d.id}`) });
  };

  const handleDelete = (id: number, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Delete "${title}"? You can undo this from the notification that follows.`)) {
      deleteMutation.mutate(id, {
        onSuccess: () => {
          if (activeId === id) setLocation("/");
        }
      });
    }
  };

  const toggleSection = (key: string) =>
    setSectionsOpen(prev => ({ ...prev, [key as keyof typeof prev]: !prev[key as keyof typeof prev] }));

  // ── Open folder ──────────────────────────────────────────
  const openFolder = async () => {
    if (!("showDirectoryPicker" in window)) {
      toast({ description: "Folder picker not supported in this browser. Use Chrome or Edge.", variant: "destructive" });
      return;
    }
    try {
      const dirHandle = await (window as any).showDirectoryPicker({ mode: "read" });
      const entries = await readDir(dirHandle);
      setFolderName(dirHandle.name);
      setFolderEntries(entries);
      setFolderOpen(true);
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        toast({ description: "Could not open folder.", variant: "destructive" });
      }
    }
  };

  const closeFolder = () => {
    setFolderName(null);
    setFolderEntries([]);
  };

  // ── Toggle directory expand (with lazy child load) ───────
  const toggleDir = useCallback(async (target: LocalEntry) => {
    const toggle = async (entries: LocalEntry[]): Promise<LocalEntry[]> => {
      return Promise.all(entries.map(async e => {
        if (e !== target) {
          return { ...e, children: e.children ? await toggle(e.children) : e.children };
        }
        if (!e.expanded && !e.children) {
          const children = await readDir(e.handle as FileSystemDirectoryHandle);
          return { ...e, expanded: true, children };
        }
        return { ...e, expanded: !e.expanded };
      }));
    };
    setFolderEntries(await toggle(folderEntries));
  }, [folderEntries]);

  // ── Import a local file as a new DB document ─────────────
  const importFile = useCallback(async (entry: LocalEntry) => {
    const ext = extOf(entry.name);
    if (!ext) return;
    setImporting(true);
    try {
      const file = await (entry.handle as FileSystemFileHandle).getFile();
      const text = await file.text();
      const title = entry.name.replace(/\.(md|json|yaml|yml)$/, "");
      createMutation.mutate(
        { title, content: text, fileType: ext },
        {
          onSuccess: (doc) => {
            setLocation(`/d/${doc.id}`);
            toast({ description: `Imported "${entry.name}" as a new document.` });
          },
          onSettled: () => setImporting(false),
        }
      );
    } catch {
      setImporting(false);
      toast({ description: "Failed to read file.", variant: "destructive" });
    }
  }, [createMutation, setLocation, toast]);

  // ── Sections config ──────────────────────────────────────
  const mdDocs   = documents?.filter(d => d.fileType === "md")   ?? [];
  const jsonDocs = documents?.filter(d => d.fileType === "json") ?? [];
  const yamlDocs = documents?.filter(d => d.fileType === "yaml") ?? [];

  const sections = [
    { key: "md",   label: "Markdown", docs: mdDocs,   icon: <FileText className="w-3.5 h-3.5 text-gray-400" /> },
    { key: "json", label: "JSON",     docs: jsonDocs, icon: <FileJson className="w-3.5 h-3.5 text-blue-400" /> },
    { key: "yaml", label: "YAML",     docs: yamlDocs, icon: <Code2    className="w-3.5 h-3.5 text-purple-400" /> },
  ];

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] text-[#cccccc] select-none overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-2.5 shrink-0 border-b border-[#2d2d2d]">
        <span className="text-[11px] font-semibold tracking-widest uppercase text-[#bbbbbb]">
          Explorer
        </span>
        <button
          className="flex items-center gap-1 text-[11px] text-[#858585] hover:text-[#cccccc] transition-colors px-1.5 py-0.5 rounded hover:bg-[#2a2d2e]"
          onClick={openFolder}
          title="Open a local folder"
          data-testid="button-open-folder"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span>Open Folder</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto text-[13px]">

        {/* ── Local Folder Section ── */}
        {folderName && (
          <div className="border-b border-[#2d2d2d] pb-1">
            {/* Folder header row */}
            <div
              className="flex items-center justify-between px-2 py-1 cursor-pointer hover:bg-[#2a2d2e] group"
              onClick={() => setFolderOpen(v => !v)}
            >
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[#858585] shrink-0">
                  {folderOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </span>
                <FolderOpen className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                <span className="font-semibold text-[11px] uppercase tracking-widest text-[#bbbbbb] truncate ml-1">
                  {folderName}
                </span>
              </div>
              <button
                className="opacity-0 group-hover:opacity-100 shrink-0 text-[#858585] hover:text-red-400 ml-1 transition-opacity"
                onClick={(e) => { e.stopPropagation(); closeFolder(); }}
                title="Close folder"
              >
                <FolderX className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Folder tree */}
            {folderOpen && (
              folderEntries.length === 0 ? (
                <div className="pl-8 py-1 text-[12px] text-[#858585] italic">Empty folder</div>
              ) : (
                folderEntries.map(entry => (
                  <LocalFileEntry
                    key={entry.name}
                    entry={entry}
                    depth={1}
                    onToggle={toggleDir}
                    onImport={importFile}
                  />
                ))
              )
            )}

            {importing && (
              <div className="flex items-center gap-2 px-4 py-1 text-[#858585] text-[12px]">
                <Loader2 className="w-3 h-3 animate-spin" /> Importing…
              </div>
            )}
          </div>
        )}

        {/* ── DB Documents ── */}
        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-3 text-[#858585]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Loading...</span>
          </div>
        ) : (
          sections.map(section => (
            <div key={section.key}>
              <div
                className="flex items-center justify-between px-2 py-1 cursor-pointer hover:bg-[#2a2d2e] group"
                onClick={() => toggleSection(section.key)}
                onMouseEnter={() => setHoveredSection(section.key)}
                onMouseLeave={() => setHoveredSection(null)}
              >
                <div className="flex items-center gap-1">
                  <span className="w-4 flex items-center justify-center text-[#858585]">
                    {sectionsOpen[section.key as keyof typeof sectionsOpen]
                      ? <ChevronDown className="w-3.5 h-3.5" />
                      : <ChevronRight className="w-3.5 h-3.5" />}
                  </span>
                  <span className="font-semibold text-[11px] tracking-widest uppercase text-[#bbbbbb]">
                    {section.label}
                  </span>
                  <span className="ml-1 text-[10px] text-[#858585]">({section.docs.length})</span>
                </div>
                {hoveredSection === section.key && (
                  <button
                    className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#3c3c3c] text-[#cccccc] mr-1"
                    onClick={(e) => { e.stopPropagation(); handleCreate(section.key as "md" | "json" | "yaml"); }}
                    title={`New ${section.label} file`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {sectionsOpen[section.key as keyof typeof sectionsOpen] && (
                <div>
                  {section.docs.length === 0 ? (
                    <div className="pl-9 py-1 text-[12px] text-[#858585] italic">
                      No {section.label.toLowerCase()} files
                    </div>
                  ) : (
                    section.docs.map(doc => {
                      const isActive = activeId === doc.id;
                      return (
                        <div
                          key={doc.id}
                          className={`group flex items-center gap-2 pl-7 pr-2 py-[3px] cursor-pointer transition-colors ${
                            isActive ? "bg-[#37373d] text-white" : "hover:bg-[#2a2d2e] text-[#cccccc]"
                          }`}
                          onClick={() => setLocation(`/d/${doc.id}`)}
                          data-testid={`explorer-doc-${doc.id}`}
                        >
                          {section.icon}
                          <span className="flex-1 truncate text-[13px]">
                            {doc.title || "Untitled"}
                            <span className="text-[#858585] ml-1 text-[11px]">
                              {doc.fileType === "md" ? ".md" : doc.fileType === "json" ? ".json" : ".yaml"}
                            </span>
                          </span>
                          <button
                            className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-4 h-4 rounded hover:text-red-400 transition-opacity shrink-0"
                            onClick={(e) => handleDelete(doc.id, doc.title || "Untitled", e)}
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── Status bar ── */}
      <div className="shrink-0 px-3 py-1.5 border-t border-[#3c3c3c] text-[11px] text-[#858585] flex items-center justify-between">
        <span>{documents?.length ?? 0} document{(documents?.length ?? 0) !== 1 ? "s" : ""}</span>
        {folderName && <span className="truncate ml-2 text-yellow-600" title={folderName}>📁 {folderName}</span>}
      </div>
    </div>
  );
}
