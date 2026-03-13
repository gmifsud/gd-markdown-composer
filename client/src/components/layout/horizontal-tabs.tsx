import { FileText, Plus, Trash2, Loader2, FileJson, Code2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDocuments, useCreateDocument, useDeleteDocument } from "@/hooks/use-documents";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

interface HorizontalTabsProps {
  activeId: number | null;
}

export function HorizontalTabs({ activeId }: HorizontalTabsProps) {
  const { data: documents, isLoading } = useDocuments();
  const createMutation = useCreateDocument();
  const deleteMutation = useDeleteDocument();
  const [_, setLocation] = useLocation();
  const { toast } = useToast();

  if (isLoading) {
    return (
      <div className="h-16 border-b border-gray-200 bg-white flex items-center px-4 gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        <span className="text-sm text-gray-400">Loading documents...</span>
      </div>
    );
  }

  const handleCreate = (fileType: "md" | "json" | "yaml" = "md") => {
    createMutation.mutate({ fileType }, {
      onSuccess: (newDoc) => {
        setLocation(`/d/${newDoc.id}`);
      }
    });
  };

  const handleDelete = (id: number, title: string) => {
    if (window.confirm(`Are you sure you want to delete "${title}"? This action cannot be undone.`)) {
      deleteMutation.mutate(id, {
        onSuccess: () => {
          if (activeId === id) {
            setLocation("/");
          }
          toast({ description: "Document deleted successfully." });
        }
      });
    }
  };

  return (
    <div className="border-b border-gray-200 bg-white overflow-x-auto shrink-0">
      <div className="flex items-center h-16 px-4 gap-1 min-w-min">
        {/* Create buttons */}
        <div className="flex items-center gap-1 border-r border-gray-200 pr-3 mr-3">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => handleCreate("md")}
            disabled={createMutation.isPending}
            title="New Markdown"
            data-testid="button-new-md"
          >
            <FileText className="w-4 h-4 text-gray-400" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => handleCreate("json")}
            disabled={createMutation.isPending}
            title="New JSON"
            data-testid="button-new-json"
          >
            <FileJson className="w-4 h-4 text-blue-500" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => handleCreate("yaml")}
            disabled={createMutation.isPending}
            title="New YAML"
            data-testid="button-new-yaml"
          >
            <Code2 className="w-4 h-4 text-purple-500" />
          </Button>
        </div>

        {/* Document tabs */}
        {documents && documents.length > 0 ? (
          documents.map((doc) => {
            const isSelected = activeId === doc.id;
            const isJson = doc.fileType === "json";
            const isYaml = doc.fileType === "yaml";

            return (
              <button
                key={doc.id}
                onClick={() => setLocation(`/d/${doc.id}`)}
                className={`group flex items-center gap-2 px-3 h-10 rounded-md whitespace-nowrap text-sm transition-all shrink-0 ${
                  isSelected
                    ? "bg-gray-100 border border-gray-200 text-gray-900 font-medium"
                    : "text-gray-600 hover:bg-gray-50 border border-transparent"
                }`}
                data-testid={`tab-${doc.id}`}
              >
                {isJson ? (
                  <FileJson className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                ) : isYaml ? (
                  <Code2 className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                )}
                <span className="truncate max-w-[120px]">{doc.title || "Untitled"}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 -mr-1.5 hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(doc.id, doc.title || "Untitled");
                  }}
                  disabled={deleteMutation.isPending}
                  data-testid={`button-close-${doc.id}`}
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <X className="w-3 h-3" />
                  )}
                </Button>
              </button>
            );
          })
        ) : (
          <span className="text-sm text-gray-400">No documents yet</span>
        )}
      </div>
    </div>
  );
}
