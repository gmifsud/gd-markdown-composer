import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import { installPendingSaveHooks } from "@/lib/pending-saves";
import { WorkspaceProvider } from "@/lib/workspace";
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <WorkspaceProvider>
          <FolderDialogsProvider>
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
