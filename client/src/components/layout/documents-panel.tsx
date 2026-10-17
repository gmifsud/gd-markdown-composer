import { useState } from "react";
import { useLocation } from "wouter";
import { FileText, FileJson, Code2, ChevronDown, ChevronRight, Plus, Trash2, Loader2 } from "lucide-react";
import { useDocuments, useCreateDocument, useDeleteDocument } from "@/hooks/use-documents";
import { dbUri, useWorkspace, useWorkspaceActions } from "@/lib/workspace";

type DocType = "md" | "json" | "yaml";

const SECTIONS: { key: DocType; label: string; ext: string; icon: JSX.Element }[] = [
  { key: "md", label: "Markdown", ext: ".md", icon: <FileText className="w-3.5 h-3.5 shrink-0 text-gray-400" /> },
  { key: "json", label: "JSON", ext: ".json", icon: <FileJson className="w-3.5 h-3.5 shrink-0 text-blue-400" /> },
  { key: "yaml", label: "YAML", ext: ".yaml", icon: <Code2 className="w-3.5 h-3.5 shrink-0 text-purple-400" /> },
];

/** Documents stored in the app's database, grouped by type. */
export function DocumentsPanel() {
  const { data: documents, isLoading } = useDocuments();
  const createMutation = useCreateDocument();
  const deleteMutation = useDeleteDocument();
  const { activeUri } = useWorkspace();
  const { open, close } = useWorkspaceActions();
  const [, setLocation] = useLocation();
  const [sectionsOpen, setSectionsOpen] = useState<Record<DocType, boolean>>({ md: true, json: true, yaml: true });

  const handleCreate = (fileType: DocType) => {
    createMutation.mutate({ fileType }, { onSuccess: (d) => open(dbUri(d.id)) });
  };

  const handleDelete = (id: number, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Delete "${title}"? You can undo this from the notification that follows.`)) {
      deleteMutation.mutate(id, {
        onSuccess: () => {
          if (activeUri === dbUri(id)) setLocation("/");
          close([dbUri(id)]);
        }
      });
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] text-[#cccccc] select-none overflow-hidden">
      <div className="flex items-center justify-between px-3 h-9 shrink-0 border-b border-[#2d2d2d]">
        <span className="text-[11px] font-semibold tracking-widest uppercase text-[#bbbbbb]">Documents</span>
      </div>

      <div className="flex-1 overflow-y-auto text-[13px]" data-testid="documents-panel">
        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-3 text-[#858585]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Loading...</span>
          </div>
        ) : (
          SECTIONS.map(section => {
            const docs = documents?.filter(d => d.fileType === section.key) ?? [];
            const isOpen = sectionsOpen[section.key];
            return (
              <div key={section.key}>
                <div
                  className="group flex items-center justify-between px-2 py-1 cursor-pointer hover:bg-[#2a2d2e]"
                  onClick={() => setSectionsOpen(prev => ({ ...prev, [section.key]: !prev[section.key] }))}
                >
                  <div className="flex items-center gap-1">
                    <span className="w-4 flex items-center justify-center text-[#858585]">
                      {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </span>
                    <span className="font-semibold text-[11px] tracking-widest uppercase text-[#bbbbbb]">{section.label}</span>
                    <span className="ml-1 text-[10px] text-[#858585]">({docs.length})</span>
                  </div>
                  <button
                    className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-5 h-5 rounded hover:bg-[#3c3c3c] text-[#cccccc] mr-1"
                    onClick={(e) => { e.stopPropagation(); handleCreate(section.key); }}
                    title={`New ${section.label} document`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {isOpen && (
                  docs.length === 0 ? (
                    <div className="pl-9 py-1 text-[12px] text-[#858585] italic">No {section.label.toLowerCase()} documents</div>
                  ) : (
                    docs.map(doc => {
                      const isActive = activeUri === dbUri(doc.id);
                      return (
                        <div
                          key={doc.id}
                          className={`group flex items-center gap-2 pl-7 pr-2 py-[3px] cursor-pointer transition-colors ${
                            isActive ? "bg-[#37373d] text-white" : "hover:bg-[#2a2d2e] text-[#cccccc]"
                          }`}
                          onClick={() => open(dbUri(doc.id))}
                          data-testid={`explorer-doc-${doc.id}`}
                        >
                          {section.icon}
                          <span className="flex-1 truncate text-[13px]">
                            {doc.title || "Untitled"}
                            <span className="text-[#858585] ml-1 text-[11px]">{section.ext}</span>
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
                  )
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="shrink-0 px-3 py-1.5 border-t border-[#3c3c3c] text-[11px] text-[#858585]">
        {documents?.length ?? 0} document{(documents?.length ?? 0) !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
