import { useState, useEffect, useRef } from "react";
import { FileText, Loader2, FileJson, Code2, X, Pin, PinOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDocuments, useCreateDocument, useDeleteDocument } from "@/hooks/use-documents";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

interface HorizontalTabsProps {
  activeId: number | null;
}

interface ContextMenu {
  x: number;
  y: number;
  docId: number;
  docTitle: string;
}

export function HorizontalTabs({ activeId }: HorizontalTabsProps) {
  const { data: documents, isLoading } = useDocuments();
  const createMutation = useCreateDocument();
  const deleteMutation = useDeleteDocument();
  const [_, setLocation] = useLocation();
  const { toast } = useToast();

  const [pinnedIds, setPinnedIds] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem("pinnedTabIds");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setContextMenu(null); };
    window.document.addEventListener("click", handleClick);
    window.document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.document.removeEventListener("click", handleClick);
      window.document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const togglePin = (id: number) => {
    setPinnedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem("pinnedTabIds", JSON.stringify([...next]));
      return next;
    });
    setContextMenu(null);
  };

  const handleRightClick = (e: React.MouseEvent, docId: number, docTitle: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, docId, docTitle });
  };

  const handleCreate = (fileType: "md" | "json" | "yaml" = "md") => {
    createMutation.mutate({ fileType }, {
      onSuccess: (newDoc) => setLocation(`/d/${newDoc.id}`)
    });
  };

  const handleDelete = (id: number, title: string) => {
    setContextMenu(null);
    if (window.confirm(`Are you sure you want to delete "${title}"? This action cannot be undone.`)) {
      deleteMutation.mutate(id, {
        onSuccess: () => {
          if (activeId === id) setLocation("/");
          toast({ description: "Document deleted successfully." });
        }
      });
    }
  };

  const getIcon = (fileType: string, cls = "w-3.5 h-3.5 shrink-0") => {
    if (fileType === "json") return <FileJson className={`${cls} text-blue-500`} />;
    if (fileType === "yaml") return <Code2 className={`${cls} text-purple-500`} />;
    return <FileText className={`${cls} text-gray-400`} />;
  };

  if (isLoading) {
    return (
      <div className="h-12 border-b border-gray-200 bg-white flex items-center px-4 gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        <span className="text-sm text-gray-400">Loading...</span>
      </div>
    );
  }

  const pinned = documents?.filter(d => pinnedIds.has(d.id)) ?? [];
  const unpinned = documents?.filter(d => !pinnedIds.has(d.id)) ?? [];

  return (
    <>
      <div className="bg-white border-b border-gray-200 shrink-0">

        {/* Row 1: Pinned tabs — only shown when tabs are pinned */}
        {pinned.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 px-3 pt-2 pb-1.5 border-b border-gray-100">
            <span className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase mr-1 shrink-0">
              Pinned
            </span>
            {pinned.map(doc => {
              const isSelected = activeId === doc.id;
              return (
                <button
                  key={`pinned-${doc.id}`}
                  onClick={() => setLocation(`/d/${doc.id}`)}
                  onContextMenu={(e) => handleRightClick(e, doc.id, doc.title || "Untitled")}
                  title={doc.title || "Untitled"}
                  className={`group relative flex items-center gap-1.5 px-2.5 h-8 rounded-md text-sm transition-all border ${
                    isSelected
                      ? "bg-amber-50 border-amber-200 text-amber-900 font-medium"
                      : "border-transparent text-gray-600 hover:bg-gray-50 hover:border-gray-200"
                  }`}
                  data-testid={`tab-pinned-${doc.id}`}
                >
                  <Pin className="w-2.5 h-2.5 shrink-0 text-amber-400 fill-amber-400" />
                  {getIcon(doc.fileType)}
                  <span className="truncate max-w-[140px]">{doc.title || "Untitled"}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Row 2: New file buttons + regular tabs */}
        <div className="flex flex-wrap items-center gap-1 px-3 py-1.5">
          {/* Create buttons */}
          <div className="flex items-center gap-0.5 border-r border-gray-200 pr-2 mr-1 shrink-0">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleCreate("md")}
              disabled={createMutation.isPending} title="New Markdown" data-testid="button-new-md">
              <FileText className="w-3.5 h-3.5 text-gray-400" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleCreate("json")}
              disabled={createMutation.isPending} title="New JSON" data-testid="button-new-json">
              <FileJson className="w-3.5 h-3.5 text-blue-500" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleCreate("yaml")}
              disabled={createMutation.isPending} title="New YAML" data-testid="button-new-yaml">
              <Code2 className="w-3.5 h-3.5 text-purple-500" />
            </Button>
          </div>

          {/* Regular tabs */}
          {unpinned.map(doc => {
            const isSelected = activeId === doc.id;
            return (
              <button
                key={doc.id}
                onClick={() => setLocation(`/d/${doc.id}`)}
                onContextMenu={(e) => handleRightClick(e, doc.id, doc.title || "Untitled")}
                className={`group flex items-center gap-1.5 px-2.5 h-8 rounded-md whitespace-nowrap text-sm transition-all border ${
                  isSelected
                    ? "bg-gray-100 border-gray-300 text-gray-900 font-medium"
                    : "border-transparent text-gray-600 hover:bg-gray-50 hover:border-gray-200"
                }`}
                data-testid={`tab-${doc.id}`}
              >
                {getIcon(doc.fileType)}
                <span className="truncate max-w-[140px]">{doc.title || "Untitled"}</span>
                <span
                  role="button"
                  className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 flex items-center justify-center rounded hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); handleDelete(doc.id, doc.title || "Untitled"); }}
                  data-testid={`button-close-${doc.id}`}
                >
                  <X className="w-3 h-3" />
                </span>
              </button>
            );
          })}

          {documents?.length === 0 && (
            <span className="text-sm text-gray-400 pl-1">No documents yet</span>
          )}
        </div>
      </div>

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px] text-sm"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 text-gray-700 transition-colors"
            onClick={() => togglePin(contextMenu.docId)}
          >
            {pinnedIds.has(contextMenu.docId) ? (
              <><PinOff className="w-3.5 h-3.5 text-gray-500" /> Unpin tab</>
            ) : (
              <><Pin className="w-3.5 h-3.5 text-gray-500" /> Pin tab</>
            )}
          </button>
          <div className="h-px bg-gray-100 my-1" />
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-red-50 text-red-600 transition-colors"
            onClick={() => handleDelete(contextMenu.docId, contextMenu.docTitle)}
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      )}
    </>
  );
}
