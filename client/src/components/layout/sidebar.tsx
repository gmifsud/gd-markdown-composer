import { useDocuments, useCreateDocument, useDeleteDocument } from "@/hooks/use-documents";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { FileText, Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

interface SidebarProps {
  activeId: number | null;
  onNavigate?: () => void;
}

export function Sidebar({ activeId, onNavigate }: SidebarProps) {
  const { data: documents, isLoading } = useDocuments();
  const createMutation = useCreateDocument();
  const deleteMutation = useDeleteDocument();
  const [_, setLocation] = useLocation();
  const { toast } = useToast();

  const handleCreate = () => {
    createMutation.mutate({}, {
      onSuccess: (newDoc) => {
        setLocation(`/d/${newDoc.id}`);
        onNavigate?.();
      }
    });
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate(id, {
      onSuccess: () => {
        if (activeId === id) {
          setLocation("/");
        }
        toast({ description: "Document deleted successfully." });
      }
    });
  };

  const navigateTo = (id: number) => {
    setLocation(`/d/${id}`);
    onNavigate?.();
  };

  return (
    <div className="w-full h-full bg-[#f8f9fa] flex flex-col border-r border-gray-200">
      {/* Sidebar Header */}
      <div className="h-16 px-4 border-b border-gray-200 flex items-center justify-between shrink-0 bg-[#f8f9fa]">
        <h1 className="font-semibold text-[14px] flex items-center gap-2 text-gray-800 tracking-tight">
          <div className="w-6 h-6 bg-primary text-primary-foreground rounded-md flex items-center justify-center shadow-sm">
            <FileText className="w-3.5 h-3.5" />
          </div>
          Notes
        </h1>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={handleCreate} 
          disabled={createMutation.isPending}
          className="h-8 w-8 text-gray-500 hover:text-gray-900 transition-colors"
        >
          {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        </Button>
      </div>

      {/* Document List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {isLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
          </div>
        ) : documents?.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-gray-400 mt-10">
            <div className="w-12 h-12 rounded-xl bg-white shadow-sm border border-gray-100 flex items-center justify-center mb-3">
              <FileText className="w-5 h-5 text-gray-300" />
            </div>
            <p className="text-[13px] font-medium text-gray-500 mb-1">No documents</p>
            <p className="text-[11px] text-gray-400">Click + to create a note</p>
          </div>
        ) : (
          documents?.map((doc) => {
            const isSelected = activeId === doc.id;
            return (
              <div 
                key={doc.id}
                onClick={() => navigateTo(doc.id)}
                className={`p-3 rounded-xl flex flex-col gap-1.5 cursor-pointer group transition-all duration-200 border ${
                  isSelected 
                    ? 'bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)] border-gray-200/60 ring-1 ring-black/5' 
                    : 'hover:bg-black/[0.02] border-transparent text-gray-600'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`font-semibold text-[13px] leading-snug truncate ${isSelected ? 'text-gray-900' : ''}`}>
                    {doc.title || "Untitled Document"}
                  </span>
                  
                  {/* Delete Button - Using stopPropagation to prevent navigation */}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className={`h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 -mt-0.5 -mr-1 ${isSelected ? 'text-gray-400 hover:text-destructive hover:bg-red-50' : 'text-gray-400 hover:text-destructive'}`}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Document</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete "{doc.title || "Untitled"}"? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            handleDelete(doc.id); 
                          }}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                <span className={`text-[11px] font-medium ${isSelected ? 'text-gray-500' : 'text-gray-400'}`}>
                  {doc.updatedAt ? format(new Date(doc.updatedAt), 'MMM d, h:mm a') : 'Just now'}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
