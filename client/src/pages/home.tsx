import { useState } from "react";
import { Menu, FileText, Plus, Loader2 } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { TabBar } from "@/components/layout/tab-bar";
import { AppToolbar } from "@/components/layout/app-toolbar";
import { ActivityBar, WorkbenchSidebar } from "@/components/layout/workbench-sidebar";
import { DocumentEditor, FileEditor } from "@/components/editor/editor-loaders";
import { useCreateDocument } from "@/hooks/use-documents";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { dbUri, parseUri, useWorkspace, useWorkspaceActions } from "@/lib/workspace";

/**
 * The editor for the active tab. Keyed by tab so each document gets fresh
 * editor state, and switching tabs unmounts the previous editor, which
 * flushes its unsaved edits.
 */
function ActiveEditor({ uri }: { uri: string }) {
  const ref = parseUri(uri);
  if (!ref) return <EmptyState />;
  return ref.kind === "db"
    ? <DocumentEditor key={uri} id={ref.id} />
    : <FileEditor key={uri} uri={uri} path={ref.path} />;
}

function EmptyState() {
  const createMutation = useCreateDocument();
  const { open } = useWorkspaceActions();

  const handleCreate = () => {
    createMutation.mutate({}, {
      onSuccess: (newDoc) => open(dbUri(newDoc.id))
    });
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-gray-50/30">
      <div className="w-20 h-20 bg-white shadow-sm shadow-black/5 rounded-[1.5rem] flex items-center justify-center border border-gray-100 mb-6 text-gray-300">
        <FileText className="w-8 h-8" strokeWidth={1.5} />
      </div>
      <h2 className="text-2xl font-bold mb-2 text-gray-900 tracking-tight">No Document Selected</h2>
      <p className="text-gray-500 text-[15px] mb-8 max-w-[320px] text-center leading-relaxed">
        Open a file from the explorer, pick a document, or create a new one.
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
  const { activeUri } = useWorkspace();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const isMobile = useIsMobile();
  const activeRef = activeUri ? parseUri(activeUri) : null;

  const content = activeUri ? <ActiveEditor key={activeUri} uri={activeUri} /> : <EmptyState />;

  // Only one layout is mounted, so there is only ever one editor (and one auto-save).
  if (!isMobile) {
    return (
      <div className="flex flex-col h-screen w-full overflow-hidden bg-[#eef0f2]">
        <AppToolbar />
        <div className="flex flex-1 min-h-0">
          <ActivityBar />
          <WorkbenchSidebar />
          <main className="flex-1 flex flex-col min-w-0 h-full">
            <TabBar />
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{content}</div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-[#eef0f2]">
      <div className="flex items-center h-14 border-b border-gray-200 px-4 bg-[#f8f9fa] shrink-0 gap-3">
        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="-ml-2 text-gray-600">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72 border-r-0">
            <Sidebar
              activeId={activeRef?.kind === "db" ? activeRef.id : null}
              onNavigate={() => setIsMobileMenuOpen(false)}
            />
          </SheetContent>
        </Sheet>
        <span className="font-semibold text-sm tracking-tight text-gray-800">
          {activeUri ? "Editor" : "GD Markdown Composer"}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{content}</div>
    </div>
  );
}
