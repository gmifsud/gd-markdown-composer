import { useState } from "react";
import { useLocation } from "wouter";
import { FileText, FileJson, Code2, ChevronDown, ChevronRight, Plus, Trash2, Loader2 } from "lucide-react";
import { useDocuments, useCreateDocument, useDeleteDocument } from "@/hooks/use-documents";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface ExplorerPanelProps {
  activeId: number | null;
}

export function ExplorerPanel({ activeId }: ExplorerPanelProps) {
  const { data: documents, isLoading } = useDocuments();
  const createMutation = useCreateDocument();
  const deleteMutation = useDeleteDocument();
  const [_, setLocation] = useLocation();
  const { toast } = useToast();

  const [sectionsOpen, setSectionsOpen] = useState({ md: true, json: true, yaml: true });
  const [hoveredSection, setHoveredSection] = useState<string | null>(null);

  const handleCreate = (fileType: "md" | "json" | "yaml") => {
    createMutation.mutate({ fileType }, {
      onSuccess: (newDoc) => setLocation(`/d/${newDoc.id}`)
    });
  };

  const handleDelete = (id: number, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Delete "${title}"?`)) {
      deleteMutation.mutate(id, {
        onSuccess: () => {
          if (activeId === id) setLocation("/");
          toast({ description: "Document deleted." });
        }
      });
    }
  };

  const toggleSection = (key: string) => {
    setSectionsOpen(prev => ({ ...prev, [key as keyof typeof prev]: !prev[key as keyof typeof prev] }));
  };

  const mdDocs = documents?.filter(d => d.fileType === "md") ?? [];
  const jsonDocs = documents?.filter(d => d.fileType === "json") ?? [];
  const yamlDocs = documents?.filter(d => d.fileType === "yaml") ?? [];

  const sections = [
    {
      key: "md",
      label: "Markdown",
      docs: mdDocs,
      icon: <FileText className="w-3.5 h-3.5 text-gray-400" />,
      color: "text-gray-300",
      createIcon: <FileText className="w-3 h-3" />,
    },
    {
      key: "json",
      label: "JSON",
      docs: jsonDocs,
      icon: <FileJson className="w-3.5 h-3.5 text-blue-400" />,
      color: "text-blue-300",
      createIcon: <FileJson className="w-3 h-3" />,
    },
    {
      key: "yaml",
      label: "YAML",
      docs: yamlDocs,
      icon: <Code2 className="w-3.5 h-3.5 text-purple-400" />,
      color: "text-purple-300",
      createIcon: <Code2 className="w-3 h-3" />,
    },
  ];

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] text-[#cccccc] select-none overflow-hidden">
      {/* Explorer Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <span className="text-[11px] font-semibold tracking-widest uppercase text-[#bbbbbb]">
          Explorer
        </span>
      </div>

      {/* Documents Tree */}
      <div className="flex-1 overflow-y-auto text-[13px]">
        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-3 text-[#858585]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Loading...</span>
          </div>
        ) : (
          sections.map(section => (
            <div key={section.key}>
              {/* Section Header */}
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
                  <span className="ml-1 text-[10px] text-[#858585]">
                    ({section.docs.length})
                  </span>
                </div>
                {/* New file button shown on hover */}
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

              {/* Section Files */}
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
                            isActive
                              ? "bg-[#37373d] text-white"
                              : "hover:bg-[#2a2d2e] text-[#cccccc]"
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

      {/* Status Bar */}
      <div className="shrink-0 px-4 py-2 border-t border-[#3c3c3c] text-[11px] text-[#858585]">
        {documents?.length ?? 0} document{(documents?.length ?? 0) !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
