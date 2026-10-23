import { useState, type DragEvent, type ReactNode } from "react";
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, EyeOff, FolderInput, FolderOutput, Layers, Pencil, Plus, Trash2,
} from "lucide-react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub,
  ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useFolderDialogs } from "@/components/layout/folder-dialogs";
import { useWorkspace, useWorkspaceActions, type FolderGroup } from "@/lib/workspace";

// ── Drag and drop of folders onto groups ─────────────────────────────────────

/** Private drag type, so files or text dragged in from outside are ignored. */
const FOLDER_DRAG_TYPE = "application/x-mdc-folder";

/** Props that make an explorer row draggable onto a group. */
export function folderDragProps(path: string) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(FOLDER_DRAG_TYPE, path);
      e.dataTransfer.effectAllowed = "move";
      e.stopPropagation();
    },
  };
}

/** Drop target that moves a dragged folder into `groupId` (null: out of every group). */
export function useFolderDrop(groupId: string | null) {
  const { setFolderGroup } = useWorkspaceActions();
  const [over, setOver] = useState(false);
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(FOLDER_DRAG_TYPE);
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      },
      onDragLeave: (e: DragEvent) => {
        // Ignore leaving into a child of the drop target.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        setOver(false);
        const path = e.dataTransfer.getData(FOLDER_DRAG_TYPE);
        if (!path) return;
        e.preventDefault();
        e.stopPropagation();
        setFolderGroup(path, groupId);
      },
    },
  };
}

// ── Context menu items for a folder row ──────────────────────────────────────

/** "Move to Group" submenu, plus "Remove from Group" when the folder is in one. */
export function GroupMenuItems({ path }: { path: string }) {
  const { state } = useWorkspace();
  const { setFolderGroup } = useWorkspaceActions();
  const { newGroup } = useFolderDialogs();
  const current = state.groups.find(g => g.folders.includes(path));

  return (
    <>
      <ContextMenuSub>
        <ContextMenuSubTrigger data-testid="menu-move-to-group">
          <FolderInput className="w-3.5 h-3.5 mr-2" /> Move to Group
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-52">
          {state.groups.map(g => (
            <ContextMenuItem
              key={g.id}
              disabled={g.id === current?.id}
              onSelect={() => setFolderGroup(path, g.id)}
              data-testid={`menu-group-${g.id}`}
            >
              <Layers className="w-3.5 h-3.5 mr-2" />
              <span className="truncate">{g.name}</span>
            </ContextMenuItem>
          ))}
          {state.groups.length > 0 && <ContextMenuSeparator />}
          <ContextMenuItem onSelect={() => newGroup(path)} data-testid="menu-new-group-with-folder">
            <Plus className="w-3.5 h-3.5 mr-2" /> New Group…
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {current && (
        <ContextMenuItem onSelect={() => setFolderGroup(path, null)} data-testid="menu-remove-from-group">
          <FolderOutput className="w-3.5 h-3.5 mr-2" /> Remove from “{current.name}”
        </ContextMenuItem>
      )}
    </>
  );
}

// ── Group section ────────────────────────────────────────────────────────────

const headerButton = "flex items-center justify-center w-5 h-5 rounded hover:bg-[#3c3c3c]";

/** A collapsible explorer section holding a group's folders; folders can be dropped on it. */
export function GroupSection({ group, index, total, forceOpen, children }: {
  group: FolderGroup;
  index: number;
  total: number;
  /** Search is active: show the contents even if the group is collapsed. */
  forceOpen: boolean;
  children: ReactNode;
}) {
  const { setGroupCollapsed, setGroupHidden, deleteGroup, moveGroup } = useWorkspaceActions();
  const { renameGroup } = useFolderDialogs();
  const { over, handlers } = useFolderDrop(group.id);
  const open = forceOpen || !group.collapsed;
  const toggleHidden = () => setGroupHidden(group.id, !group.hidden);

  return (
    <div
      className={`border-b border-[#2d2d2d] ${over ? "bg-[#094771]/40 ring-1 ring-inset ring-[#007fd4]" : ""}`}
      {...handlers}
      data-testid={`group-${group.id}`}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="treeitem"
            aria-expanded={open}
            tabIndex={0}
            className="group flex items-center gap-1 pl-1 pr-1 h-[24px] cursor-pointer bg-[#252526] hover:bg-[#2a2d2e] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#007fd4]"
            onClick={() => setGroupCollapsed(group.id, !group.collapsed)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setGroupCollapsed(group.id, !group.collapsed); }
            }}
            title={group.name}
          >
            <span className="text-[#858585] shrink-0">
              {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </span>
            <Layers className={`w-3.5 h-3.5 shrink-0 ${group.hidden ? "text-[#6b6b6b]" : "text-[#4fc1ff]"}`} />
            <span className={`flex-1 min-w-0 truncate font-semibold text-[11px] uppercase tracking-wider ml-1 ${
              group.hidden ? "text-[#858585] italic" : "text-[#e5e5e5]"
            }`}>
              {group.name}
            </span>
            <span className="text-[10px] tabular-nums text-[#858585] mr-0.5">{group.folders.length}</span>
            <span className="hidden group-hover:flex items-center gap-0.5 text-[#cccccc]">
              <button
                className={headerButton}
                onClick={(e) => { e.stopPropagation(); renameGroup(group.id); }}
                title="Rename group"
              >
                <Pencil className="w-3 h-3" />
              </button>
            </span>
            {/* Always visible so the group's tab visibility can be read at a glance. */}
            <button
              className={`${headerButton} ${group.hidden ? "text-[#858585]" : "text-[#cccccc]"}`}
              onClick={(e) => { e.stopPropagation(); toggleHidden(); }}
              title={group.hidden ? "Tabs hidden from the tab bar. Click to show them." : "Hide this group's tabs from the tab bar"}
              aria-pressed={!group.hidden}
              aria-label={group.hidden ? `Show ${group.name} tabs` : `Hide ${group.name} tabs`}
              data-testid={`button-group-visibility-${group.id}`}
            >
              {group.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          <ContextMenuItem onSelect={toggleHidden}>
            {group.hidden
              ? <><Eye className="w-3.5 h-3.5 mr-2" /> Show Tabs in Tab Bar</>
              : <><EyeOff className="w-3.5 h-3.5 mr-2" /> Hide Tabs from Tab Bar</>}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => renameGroup(group.id)}>
            <Pencil className="w-3.5 h-3.5 mr-2" /> Rename…
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={index === 0} onSelect={() => moveGroup(group.id, -1)}>
            <ArrowUp className="w-3.5 h-3.5 mr-2" /> Move Up
          </ContextMenuItem>
          <ContextMenuItem disabled={index === total - 1} onSelect={() => moveGroup(group.id, 1)}>
            <ArrowDown className="w-3.5 h-3.5 mr-2" /> Move Down
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-red-600 focus:text-red-600" onSelect={() => deleteGroup(group.id)}>
            <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete Group (keeps folders)
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {open && (
        group.folders.length === 0 ? (
          <p className="px-6 py-2 text-[11.5px] text-[#858585] italic">
            Drag folders here, or right-click a folder › Move to Group.
          </p>
        ) : <div className="pl-2">{children}</div>
      )}
    </div>
  );
}
