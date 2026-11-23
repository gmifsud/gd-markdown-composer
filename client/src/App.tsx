import { useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import { installPendingSaveHooks } from "@/lib/pending-saves";
import { WorkspaceProvider, fileUri, useWorkspaceActions } from "@/lib/workspace";
import { desktop } from "@/lib/fs-api";
import { FolderDialogsProvider } from "@/components/layout/folder-dialogs";
import { MoveFileProvider } from "@/components/layout/move-file";

installPendingSaveHooks();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/d/:id" component={Home} />
      <Route path="/f" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

/**
 * Desktop app: opens the files the OS hands over (a double-clicked .md file,
 * "Open with", or a second launch). The main process queues the paths; they
 * are taken on mount and whenever it says more arrived.
 */
function DesktopFileOpener() {
  const { open } = useWorkspaceActions();
  useEffect(() => {
    const takePendingFiles = desktop?.takePendingFiles;
    const onFilesPending = desktop?.onFilesPending;
    if (!takePendingFiles || !onFilesPending) return;
    // Tabs open in the given order; the last file ends up active.
    const take = () => void takePendingFiles().then(paths => paths.forEach(path => open(fileUri(path))));
    const unsubscribe = onFilesPending(take);
    take();
    return unsubscribe;
  }, [open]);
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <WorkspaceProvider>
          <FolderDialogsProvider>
            <DesktopFileOpener />
            <MoveFileProvider>
              <Router />
            </MoveFileProvider>
          </FolderDialogsProvider>
        </WorkspaceProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
