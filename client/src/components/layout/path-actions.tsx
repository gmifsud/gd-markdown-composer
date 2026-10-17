import { useCallback } from "react";
import { Copy, FolderSearch, XSquare } from "lucide-react";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { useToast } from "@/hooks/use-toast";
import { copyText, desktop, isInside, relativePath, useFsStatus } from "@/lib/fs-api";
import { parseUri, useWorkspace, useWorkspaceActions } from "@/lib/workspace";

/** Path comparisons follow the server OS (case-insensitive on Windows/macOS). */
export function useIsInside() {
  const { data: status } = useFsStatus();
  const caseInsensitive = status?.caseInsensitive ?? true;
  return useCallback((child: string, parent: string) => isInside(child, parent, caseInsensitive), [caseInsensitive]);
}

/** Open file tabs inside `folder`. */
export function useTabsInFolder() {
  const { state } = useWorkspace();
  const inside = useIsInside();
  return useCallback((folder: string) => state.openTabs.filter(uri => {
    const ref = parseUri(uri);
    return ref?.kind === "file" && inside(ref.path, folder);
  }), [state.openTabs, inside]);
}

/** The workspace folder a path belongs to (the innermost one if folders are nested). */
export function useRootFolderOf() {
  const { state } = useWorkspace();
  const inside = useIsInside();
  return useCallback((path: string): { folder: string; index: number } | null => {
    let best: { folder: string; index: number } | null = null;
    state.folders.forEach((folder, index) => {
      if (inside(path, folder) && (!best || folder.length > best.folder.length)) best = { folder, index };
    });
    return best;
  }, [state.folders, inside]);
}

export function useCopyPath() {
  const { toast } = useToast();
  return useCallback(async (text: string) => {
    try {
      await copyText(text);
      toast({ description: `Copied ${text}` });
    } catch {
      toast({ description: "Couldn't copy to the clipboard", variant: "destructive" });
    }
  }, [toast]);
}

/** Context menu items shared by explorer rows and tabs. */
export function PathMenuItems({ path, root, isDirectory }: { path: string; root?: string; isDirectory?: boolean }) {
  const copyPath = useCopyPath();
  const tabsInFolder = useTabsInFolder();
  const { close } = useWorkspaceActions();
  const openTabs = isDirectory ? tabsInFolder(path) : [];

  return (
    <>
      <ContextMenuItem onSelect={() => void copyPath(path)} data-testid="menu-copy-path">
        <Copy className="w-3.5 h-3.5 mr-2" /> Copy Path
      </ContextMenuItem>
      {root && root !== path && (
        <ContextMenuItem onSelect={() => void copyPath(relativePath(path, root))} data-testid="menu-copy-relative-path">
          <Copy className="w-3.5 h-3.5 mr-2 opacity-0" /> Copy Relative Path
        </ContextMenuItem>
      )}
      {desktop && (
        <ContextMenuItem onSelect={() => void desktop?.revealPath(path)}>
          <FolderSearch className="w-3.5 h-3.5 mr-2" /> Reveal in File Explorer
        </ContextMenuItem>
      )}
      {isDirectory && (
        <ContextMenuItem disabled={openTabs.length === 0} onSelect={() => close(openTabs)} data-testid="menu-close-tabs-in-folder">
          <XSquare className="w-3.5 h-3.5 mr-2" /> Close Tabs in Folder{openTabs.length ? ` (${openTabs.length})` : ""}
        </ContextMenuItem>
      )}
    </>
  );
}
