import { useCallback, useSyncExternalStore } from "react";
import { focusExplorerSearch, useExplorerSearch } from "@/components/layout/explorer-search";
import { useRootFolderOf } from "@/components/layout/path-actions";
import { useToast } from "@/hooks/use-toast";
import { parseUri, useWorkspace, useWorkspaceActions } from "@/lib/workspace";

// The explorer row for this path scrolls into view and flashes once it renders
// (its folder may still be loading), then clears it.
let revealTarget: string | null = null;
const listeners = new Set<() => void>();

export function setRevealTarget(path: string | null) {
  revealTarget = path;
  listeners.forEach(l => l());
}

export function useRevealTarget() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => revealTarget,
  );
}

/**
 * Shows a tab's file in the sidebar: for files, opens the Explorer, unfolds
 * every folder from the workspace folder down to it, scrolls to it and
 * highlights it; for database documents, opens the Documents panel.
 */
export function useRevealInExplorer() {
  const rootFolderOf = useRootFolderOf();
  const { state } = useWorkspace();
  const { expandMany, setSidebar, setGroupCollapsed } = useWorkspaceActions();
  const { query, clear } = useExplorerSearch();
  const { toast } = useToast();

  return useCallback((uri: string, options: { quiet?: boolean; keepPanel?: boolean } = {}) => {
    const ref = parseUri(uri);
    if (!ref) return;
    if (ref.kind === "db") {
      if (!options.keepPanel) setSidebar({ visible: true, panel: "documents" });
      return;
    }
    const root = rootFolderOf(ref.path);
    if (!root) {
      if (!options.quiet) toast({ description: "This file isn't inside a folder open in the explorer." });
      return;
    }
    const sep = ref.path.includes("\\") ? "\\" : "/";
    const folders = ref.path.slice(root.folder.length).split(/[\\/]+/).filter(Boolean).slice(0, -1);
    let current = root.folder.replace(/[\\/]+$/, "");
    expandMany([root.folder, ...folders.map(part => (current = `${current}${sep}${part}`))]);
    // A workspace folder inside a collapsed explorer group isn't rendered; open the group.
    const group = state.groups.find(g => g.folders.includes(root.folder));
    if (group?.collapsed) setGroupCollapsed(group.id, false);
    // A search filter would hide the file.
    if (query) clear();
    if (!options.keepPanel) setSidebar({ visible: true, panel: "explorer" });
    setRevealTarget(ref.path);
  }, [rootFolderOf, state.groups, expandMany, setSidebar, setGroupCollapsed, query, clear, toast]);
}

// Re-exported for callers that open the explorer with its search focused.
export { focusExplorerSearch };
