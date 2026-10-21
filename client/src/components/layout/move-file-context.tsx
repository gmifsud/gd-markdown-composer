import { createContext, useContext } from "react";
import { FolderInput } from "lucide-react";
import { ContextMenuItem } from "@/components/ui/context-menu";

/**
 * Moving a file between the explorer's folders. This module holds only the
 * context and the menu item so explorer rows and tabs can use them without
 * importing the provider (which depends on the explorer itself).
 */
export interface MoveFileValue {
  /** Opens the folder picker for `path`; the file moves once a folder is chosen. */
  chooseFolderFor(path: string): void;
  /** Moves a file into `directory`. Resolves `true` if it moved. */
  moveFile(from: string, directory: string): Promise<boolean>;
}

export const MoveFileContext = createContext<MoveFileValue | null>(null);

export function useMoveFile() {
  const ctx = useContext(MoveFileContext);
  if (!ctx) throw new Error("useMoveFile must be used inside MoveFileProvider");
  return ctx;
}

/** "Move to…" for the context menu of a file (explorer rows, search results, tabs). */
export function MoveMenuItem({ path }: { path: string }) {
  const { chooseFolderFor } = useMoveFile();
  return (
    <ContextMenuItem onSelect={() => chooseFolderFor(path)} data-testid="menu-move-file">
      <FolderInput className="w-3.5 h-3.5 mr-2" /> Move to…
    </ContextMenuItem>
  );
}
