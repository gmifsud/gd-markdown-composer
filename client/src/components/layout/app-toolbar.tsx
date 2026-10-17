import { ChevronDown, Code2, FileJson, FilePlus, FileText, FolderOpen, PanelLeft, Save } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFolderDialogs } from "@/components/layout/folder-dialogs";
import { useCreateDocument } from "@/hooks/use-documents";
import { useFsStatus, baseName } from "@/lib/fs-api";
import { flushAllPendingSaves } from "@/lib/pending-saves";
import { dbUri, folderColour, useWorkspace, useWorkspaceActions } from "@/lib/workspace";

const NEW_TYPES = [
  { type: "md", label: "Markdown", ext: ".md", icon: <FileText className="w-3.5 h-3.5 text-gray-500" /> },
  { type: "json", label: "JSON", ext: ".json", icon: <FileJson className="w-3.5 h-3.5 text-blue-500" /> },
  { type: "yaml", label: "YAML", ext: ".yaml", icon: <Code2 className="w-3.5 h-3.5 text-purple-500" /> },
] as const;

const toolbarButton =
  "flex items-center gap-1.5 h-7 px-2 rounded text-[12px] text-gray-700 hover:bg-gray-200/70 disabled:opacity-40 disabled:pointer-events-none";

/** The "M↓" mark from electron/icons/icon.svg, for the toolbar. */
function AppLogo() {
  return (
    <svg viewBox="0 0 208 128" className="h-3.5 w-auto" aria-hidden>
      <rect x="5" y="5" width="198" height="118" rx="12" fill="none" stroke="currentColor" strokeWidth="12" />
      <path fill="currentColor" d="M30 98V30h20l20 25 20-25h20v68H90V59L70 84 50 59v39zm125 0l-30-33h20V30h20v35h20z" />
    </svg>
  );
}

/** App toolbar across the top of the desktop layout. */
export function AppToolbar() {
  const { state } = useWorkspace();
  const { open, setSidebar } = useWorkspaceActions();
  const { openFolder, newFileIn } = useFolderDialogs();
  const { data: fsStatus } = useFsStatus();
  const createMutation = useCreateDocument();

  const createDocument = (fileType: "md" | "json" | "yaml") =>
    createMutation.mutate({ fileType }, { onSuccess: (d) => open(dbUri(d.id)) });

  return (
    <div className="h-9 shrink-0 flex items-center gap-1 px-2 bg-[#f3f3f3] border-b border-gray-200" role="toolbar" aria-label="Main toolbar">
      <span className="flex items-center gap-1.5 px-1.5 mr-1 text-[#1d4ed8]" title="GD Markdown Composer">
        <AppLogo />
        <span className="text-[12px] font-semibold text-gray-700 hidden lg:inline">GD Markdown Composer</span>
      </span>
      <button
        className={toolbarButton}
        onClick={() => setSidebar({ visible: !state.sidebar.visible })}
        title={state.sidebar.visible ? "Hide sidebar" : "Show sidebar"}
        data-testid="button-toggle-sidebar"
      >
        <PanelLeft className="w-4 h-4" />
      </button>

      <div className="w-px h-4 bg-gray-300 mx-1" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={toolbarButton} disabled={createMutation.isPending} data-testid="button-new-file">
            <FilePlus className="w-4 h-4" /> New <ChevronDown className="w-3 h-3 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-[11px] text-gray-500 font-medium">New document</DropdownMenuLabel>
          {NEW_TYPES.map(t => (
            <DropdownMenuItem key={t.type} onSelect={() => createDocument(t.type)} data-testid={`menu-new-${t.type}`}>
              {t.icon}
              <span className="ml-2 flex-1">{t.label}</span>
              <span className="text-[11px] text-gray-400 font-mono">{t.ext}</span>
            </DropdownMenuItem>
          ))}
          {fsStatus?.enabled && state.folders.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderOpen className="w-3.5 h-3.5 mr-2 text-yellow-500" /> New file in folder
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  {state.folders.map((folder, index) => (
                    <DropdownMenuItem key={folder} onSelect={() => newFileIn(folder)} title={folder}>
                      <span className="w-2 h-2 rounded-full shrink-0 mr-2" style={{ background: folderColour(index) }} />
                      <span className="truncate">{baseName(folder)}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {fsStatus?.enabled && (
        <button className={toolbarButton} onClick={openFolder} data-testid="toolbar-open-folder">
          <FolderOpen className="w-4 h-4" /> Open Folder
        </button>
      )}

      <button className={toolbarButton} onClick={() => void flushAllPendingSaves()} title="Save all (Ctrl+S)" data-testid="toolbar-save">
        <Save className="w-4 h-4" /> Save
      </button>
    </div>
  );
}
