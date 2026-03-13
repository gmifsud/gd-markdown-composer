import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { Menu, FileText, Plus, Loader2 } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { HorizontalTabs } from "@/components/layout/horizontal-tabs";
import { Editor } from "@/components/editor/editor";
import { useDocument, useCreateDocument } from "@/hooks/use-documents";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

function EditorLoader({ id }: { id: number }) {
  const { data: doc, isLoading } = useDocument(id);
  
  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-gray-300" />
        <p className="text-sm text-gray-400 font-medium">Loading document...</p>
      </div>
    );
  }
  
  if (!doc) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-gray-50/50">
        <div className="w-16 h-16 bg-white shadow-sm rounded-2xl flex items-center justify-center border border-gray-100 mb-4 text-gray-400">
          <FileText className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-semibold mb-1 text-gray-900 tracking-tight">Document Not Found</h2>
        <p className="text-gray-500 text-sm">The document you're looking for doesn't exist or was deleted.</p>
      </div>
    );
  }
  
  return <Editor document={doc} />;
}

function EmptyState() {
  const createMutation = useCreateDocument();
  const [_, setLocation] = useLocation();

  const handleCreate = () => {
    createMutation.mutate({}, {
      onSuccess: (newDoc) => setLocation(`/d/${newDoc.id}`)
    });
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-gray-50/30">
      <div className="w-20 h-20 bg-white shadow-sm shadow-black/5 rounded-[1.5rem] flex items-center justify-center border border-gray-100 mb-6 text-gray-300">
        <FileText className="w-8 h-8" strokeWidth={1.5} />
      </div>
      <h2 className="text-2xl font-bold mb-2 text-gray-900 tracking-tight">No Document Selected</h2>
      <p className="text-gray-500 text-[15px] mb-8 max-w-[300px] text-center leading-relaxed">
        Choose a document from the sidebar to start writing, or create a new one.
      </p>
      <Button 
        onClick={handleCreate} 
        disabled={createMutation.isPending} 
        className="rounded-full px-8 h-12 shadow-md hover:shadow-lg transition-all text-[14px] font-semibold"
      >
        {createMutation.isPending ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</>
        ) : (
          <><Plus className="w-4 h-4 mr-2" /> Create New Document</>
        )}
      </Button>
    </div>
  );
}

export default function Home() {
  const [match, params] = useRoute("/d/:id");
  const activeId = match && params?.id ? parseInt(params.id) : null;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#eef0f2] flex-col">
      {/* Horizontal Tabs - Desktop only */}
      <div className="hidden md:block w-full h-auto shrink-0">
        <HorizontalTabs activeId={activeId} />
      </div>

      <main className="flex-1 flex flex-col min-w-0 h-full relative z-10 bg-[#eef0f2]">
        {/* Mobile Header with menu trigger */}
        <div className="md:hidden flex items-center h-14 border-b border-gray-200 px-4 bg-[#f8f9fa] shrink-0 gap-3">
          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="-ml-2 text-gray-600">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72 border-r-0">
              <Sidebar activeId={activeId} onNavigate={() => setIsMobileMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="font-semibold text-sm tracking-tight text-gray-800">
            {activeId ? "Editor" : "Markdown App"}
          </span>
        </div>

        {/* Main Content Area */}
        {activeId ? (
          <EditorLoader id={activeId} />
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  );
}
