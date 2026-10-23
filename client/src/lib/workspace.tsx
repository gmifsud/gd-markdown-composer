import {
  createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode,
} from "react";
import { useLocation, useRoute, useSearch } from "wouter";
import { isInside } from "@/lib/fs-api";

/**
 * Workspace state: open folders, open tabs, pins, explorer expansion and
 * sidebar layout. Saved to localStorage. The active tab is not stored here:
 * it comes from the URL (/d/:id for database documents, /f?path=… for files)
 * so back/forward and deep links keep working.
 */

// ── Tab URIs ─────────────────────────────────────────────────────────────────

export type TabRef = { kind: "db"; id: number } | { kind: "file"; path: string };

export const dbUri = (id: number) => `db:${id}`;
export const fileUri = (path: string) => `file:${path}`;

export function parseUri(uri: string): TabRef | null {
  if (uri.startsWith("db:")) {
    const id = Number(uri.slice(3));
    return Number.isInteger(id) ? { kind: "db", id } : null;
  }
  if (uri.startsWith("file:")) return { kind: "file", path: uri.slice(5) };
  return null;
}

export function hrefFor(uri: string): string {
  const ref = parseUri(uri);
  if (!ref) return "/";
  return ref.kind === "db" ? `/d/${ref.id}` : `/f?path=${encodeURIComponent(ref.path)}`;
}

/** The tab shown in the editor, derived from the URL. */
export function useActiveUri(): string | null {
  const [isDoc, docParams] = useRoute("/d/:id");
  const [isFile] = useRoute("/f");
  const search = useSearch();
  if (isDoc && docParams?.id && /^\d+$/.test(docParams.id)) return dbUri(Number(docParams.id));
  if (isFile) {
    const path = new URLSearchParams(search).get("path");
    return path ? fileUri(path) : null;
  }
  return null;
}

// ── State ────────────────────────────────────────────────────────────────────

export type SidebarPanel = "explorer" | "documents" | "outline";
/** Editor layout: source only, source and preview side by side, or preview only. */
export type EditorMode = "edit" | "split" | "preview";
/** Explorer order inside each folder (folders always come before files). */
export type ExplorerSort = "name" | "modified";

/**
 * A named section of the explorer. A folder belongs to at most one group;
 * workspace roots in a group move out of the ungrouped list, and folders
 * inside a root show up as extra entries.
 */
export interface FolderGroup {
  id: string;
  name: string;
  folders: string[];
  /** Hide tabs of files inside this group's folders from the tab bar. */
  hidden: boolean;
  collapsed: boolean;
}

export interface WorkspaceState {
  folders: string[];
  groups: FolderGroup[];
  openTabs: string[];
  pinned: string[];
  expanded: string[];
  sidebar: { visible: boolean; width: number; panel: SidebarPanel };
  editorMode: EditorMode;
  /** Layout for .drawio files, remembered separately (they usually want the diagram only). */
  diagramMode: EditorMode;
  /** autoReveal: the explorer follows the active tab (unfolds to and highlights its file). */
  explorer: { sort: ExplorerSort; showDates: boolean; autoReveal: boolean };
  /** Front matter shown expanded (in the preview) and visible in the source. */
  frontMatterOpen: boolean;
  /** Tighter line spacing and margins in the preview and source. */
  compact: boolean;
  /** Let rendered markdown use the whole pane instead of a readable ~80-character column. */
  previewFullWidth: boolean;
}

export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 640;
export const SIDEBAR_DEFAULT_WIDTH = 260;

const STORAGE_KEY = "mdc.workspace.v1";

const initialState: WorkspaceState = {
  folders: [],
  groups: [],
  openTabs: [],
  pinned: [],
  expanded: [],
  sidebar: { visible: true, width: SIDEBAR_DEFAULT_WIDTH, panel: "explorer" },
  editorMode: "split",
  diagramMode: "preview",
  explorer: { sort: "name", showDates: true, autoReveal: false },
  previewFullWidth: false,
  frontMatterOpen: false,
  compact: false,
};

function loadState(): WorkspaceState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<WorkspaceState>;
      return {
        ...initialState,
        ...parsed,
        sidebar: { ...initialState.sidebar, ...parsed.sidebar },
        explorer: { ...initialState.explorer, ...parsed.explorer },
      };
    }
    // First run after the open-tabs change: keep previously pinned documents open.
    const pinnedIds: number[] = JSON.parse(localStorage.getItem("pinnedTabIds") ?? "[]");
    const pinned = pinnedIds.map(dbUri);
    return { ...initialState, pinned, openTabs: pinned };
  } catch {
    return initialState;
  }
}

type Action =
  | { type: "open"; uri: string; after: string | null }
  | { type: "close"; uris: string[] }
  | { type: "retarget"; from: string; to: string }
  | { type: "togglePin"; uri: string }
  | { type: "addFolders"; paths: string[] }
  | { type: "removeFolder"; path: string }
  | { type: "setExpanded"; path: string; expanded: boolean }
  | { type: "expandMany"; paths: string[] }
  | { type: "sidebar"; patch: Partial<WorkspaceState["sidebar"]> }
  | { type: "pruneDb"; existingIds: number[] }
  | { type: "editorMode"; mode: EditorMode }
  | { type: "previewFullWidth"; value: boolean }
  | { type: "diagramMode"; mode: EditorMode }
  | { type: "explorer"; patch: Partial<WorkspaceState["explorer"]> }
  | { type: "frontMatterOpen"; value: boolean }
  | { type: "compact"; value: boolean }
  | { type: "createGroup"; id: string; name: string; folder?: string }
  | { type: "updateGroup"; id: string; patch: Partial<Pick<FolderGroup, "name" | "hidden" | "collapsed">> }
  | { type: "deleteGroup"; id: string }
  | { type: "moveGroup"; id: string; delta: -1 | 1 }
  | { type: "setFolderGroup"; path: string; groupId: string | null };

const clampWidth = (w: number) => Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w)));

/** Removes `path` from every group, then adds it to `groupId` (null: ungrouped). */
function assignFolder(groups: FolderGroup[], path: string, groupId: string | null): FolderGroup[] {
  // Already there: keep its position.
  if (groupId && groups.find(g => g.id === groupId)?.folders.includes(path)) return groups;
  return groups.map(g => {
    const folders = g.folders.filter(f => f !== path);
    if (g.id === groupId) folders.push(path);
    return folders.length === g.folders.length && g.id !== groupId ? g : { ...g, folders };
  });
}

function reducer(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case "open": {
      if (state.openTabs.includes(action.uri)) return state;
      // New tabs open to the right of the active one, as in VS Code.
      const openTabs = [...state.openTabs];
      const at = action.after ? openTabs.indexOf(action.after) : -1;
      openTabs.splice(at >= 0 ? at + 1 : openTabs.length, 0, action.uri);
      return { ...state, openTabs };
    }
    case "close": {
      const closing = new Set(action.uris);
      return {
        ...state,
        openTabs: state.openTabs.filter(u => !closing.has(u)),
        pinned: state.pinned.filter(u => !closing.has(u)),
      };
    }
    case "retarget": {
      // A moved file keeps its tab position and pin; if the target is already open, the tabs merge.
      const swap = (list: string[]) => {
        if (!list.includes(action.from)) return list;
        const mapped = list.map(u => (u === action.from ? action.to : u));
        return mapped.filter((u, i) => mapped.indexOf(u) === i);
      };
      const openTabs = swap(state.openTabs);
      const pinned = swap(state.pinned);
      return openTabs === state.openTabs && pinned === state.pinned ? state : { ...state, openTabs, pinned };
    }
    case "togglePin": {
      const pinned = state.pinned.includes(action.uri)
        ? state.pinned.filter(u => u !== action.uri)
        : [...state.pinned, action.uri];
      const openTabs = state.openTabs.includes(action.uri) ? state.openTabs : [...state.openTabs, action.uri];
      return { ...state, pinned, openTabs };
    }
    case "addFolders": {
      const added = action.paths.filter(p => !state.folders.includes(p));
      if (added.length === 0) return state;
      return { ...state, folders: [...state.folders, ...added], expanded: [...state.expanded, ...added] };
    }
    case "removeFolder":
      return {
        ...state,
        folders: state.folders.filter(f => f !== action.path),
        groups: assignFolder(state.groups, action.path, null),
      };
    case "createGroup": {
      const group: FolderGroup = { id: action.id, name: action.name, folders: [], hidden: false, collapsed: false };
      const groups = [...state.groups, group];
      return { ...state, groups: action.folder ? assignFolder(groups, action.folder, action.id) : groups };
    }
    case "updateGroup":
      return { ...state, groups: state.groups.map(g => (g.id === action.id ? { ...g, ...action.patch } : g)) };
    case "deleteGroup":
      return { ...state, groups: state.groups.filter(g => g.id !== action.id) };
    case "moveGroup": {
      const from = state.groups.findIndex(g => g.id === action.id);
      const to = from + action.delta;
      if (from < 0 || to < 0 || to >= state.groups.length) return state;
      const groups = [...state.groups];
      [groups[from], groups[to]] = [groups[to], groups[from]];
      return { ...state, groups };
    }
    case "setFolderGroup":
      return { ...state, groups: assignFolder(state.groups, action.path, action.groupId) };
    case "expandMany": {
      const missing = action.paths.filter(p => !state.expanded.includes(p));
      return missing.length ? { ...state, expanded: [...state.expanded, ...missing] } : state;
    }
    case "setExpanded": {
      const has = state.expanded.includes(action.path);
      if (has === action.expanded) return state;
      return {
        ...state,
        expanded: action.expanded ? [...state.expanded, action.path] : state.expanded.filter(p => p !== action.path),
      };
    }
    case "sidebar": {
      const sidebar = { ...state.sidebar, ...action.patch };
      sidebar.width = clampWidth(sidebar.width);
      return { ...state, sidebar };
    }
    case "frontMatterOpen":
      return { ...state, frontMatterOpen: action.value };
    case "compact":
      return { ...state, compact: action.value };
    case "explorer":
      return { ...state, explorer: { ...state.explorer, ...action.patch } };
    case "diagramMode":
      return { ...state, diagramMode: action.mode };
    case "previewFullWidth":
      return { ...state, previewFullWidth: action.value };
    case "editorMode":
      return state.editorMode === action.mode ? state : { ...state, editorMode: action.mode };
    case "pruneDb": {
      const existing = new Set(action.existingIds.map(dbUri));
      const keep = (u: string) => !u.startsWith("db:") || existing.has(u);
      if (state.openTabs.every(keep) && state.pinned.every(keep)) return state;
      return { ...state, openTabs: state.openTabs.filter(keep), pinned: state.pinned.filter(keep) };
    }
  }
}

// ── Provider and hooks ───────────────────────────────────────────────────────

interface WorkspaceContextValue {
  state: WorkspaceState;
  activeUri: string | null;
  dispatch: (action: Action) => void;
}

export type WorkspaceActions = ReturnType<typeof createActions>;

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
// Actions live in their own context with a stable value, so components that
// only act on the workspace don't re-render on every workspace change.
const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);

const newGroupId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * `current` is read when an action runs (event time), never during render,
 * so the actions object can stay the same for the provider's lifetime.
 */
function createActions(
  dispatch: (action: Action) => void,
  current: {
    readonly state: WorkspaceState;
    activeUri: string | null;
    navigate(to: string, options?: { replace?: boolean }): void;
  },
) {
  return {
    open(uri: string) {
      dispatch({ type: "open", uri, after: current.activeUri });
      current.navigate(hrefFor(uri));
      // The URL now shows `uri`; record that before the next render does, so
      // several opens in a row each land after the previous one, in order.
      current.activeUri = uri;
    },
    /** Closes tabs; if the active one closes, moves to its nearest open neighbour. */
    close(uris: string[]) {
      if (uris.length === 0) return;
      const closing = new Set(uris);
      const { activeUri, state } = current;
      if (activeUri && closing.has(activeUri)) {
        const tabs = orderedTabs(state);
        const index = tabs.indexOf(activeUri);
        const remaining = (list: string[]) => list.find(u => !closing.has(u));
        const next = remaining(tabs.slice(index + 1)) ?? remaining(tabs.slice(0, index).reverse());
        current.navigate(next ? hrefFor(next) : "/");
      }
      dispatch({ type: "close", uris });
    },
    /** A file moved on disk: its tab (and pin) follow it, and the editor reopens it at the new path. */
    retarget(from: string, to: string) {
      dispatch({ type: "retarget", from, to });
      // Moves finish asynchronously; `current` holds the tab that is active now, not when the move began.
      if (current.activeUri === from) {
        current.navigate(hrefFor(to), { replace: true });
        current.activeUri = to;
      }
    },
    togglePin: (uri: string) => dispatch({ type: "togglePin", uri }),
    addFolders: (paths: string[]) => dispatch({ type: "addFolders", paths }),
    removeFolder: (path: string) => dispatch({ type: "removeFolder", path }),
    setExpanded: (path: string, expanded: boolean) => dispatch({ type: "setExpanded", path, expanded }),
    expandMany: (paths: string[]) => dispatch({ type: "expandMany", paths }),
    setSidebar: (patch: Partial<WorkspaceState["sidebar"]>) => dispatch({ type: "sidebar", patch }),
    pruneDb: (existingIds: number[]) => dispatch({ type: "pruneDb", existingIds }),
    setEditorMode: (mode: EditorMode) => dispatch({ type: "editorMode", mode }),
    setPreviewFullWidth: (value: boolean) => dispatch({ type: "previewFullWidth", value }),
    setDiagramMode: (mode: EditorMode) => dispatch({ type: "diagramMode", mode }),
    setExplorer: (patch: Partial<WorkspaceState["explorer"]>) => dispatch({ type: "explorer", patch }),
    setFrontMatterOpen: (value: boolean) => dispatch({ type: "frontMatterOpen", value }),
    setCompact: (value: boolean) => dispatch({ type: "compact", value }),
    /** Creates a group (optionally moving `folder` into it); returns its id. */
    createGroup(name: string, folder?: string) {
      const id = newGroupId();
      dispatch({ type: "createGroup", id, name, folder });
      return id;
    },
    renameGroup: (id: string, name: string) => dispatch({ type: "updateGroup", id, patch: { name } }),
    setGroupHidden: (id: string, hidden: boolean) => dispatch({ type: "updateGroup", id, patch: { hidden } }),
    setGroupCollapsed: (id: string, collapsed: boolean) => dispatch({ type: "updateGroup", id, patch: { collapsed } }),
    /** Deletes the group; its folders stay in the workspace, ungrouped. */
    deleteGroup: (id: string) => dispatch({ type: "deleteGroup", id }),
    moveGroup: (id: string, delta: -1 | 1) => dispatch({ type: "moveGroup", id, delta }),
    /** Moves a folder into a group, or out of every group with null. */
    setFolderGroup: (path: string, groupId: string | null) => dispatch({ type: "setFolderGroup", path, groupId }),
  };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const activeUri = useActiveUri();
  const [, setLocation] = useLocation();

  const current = useRef({ state, activeUri, navigate: setLocation });
  current.current.state = state;
  current.current.activeUri = activeUri;
  current.current.navigate = setLocation;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage unavailable: the workspace still works for this session.
    }
  }, [state]);

  // Whatever the URL shows is an open tab (links, back/forward, explorer clicks).
  useEffect(() => {
    if (activeUri) dispatch({ type: "open", uri: activeUri, after: null });
  }, [activeUri]);

  const actions = useMemo(() => createActions(dispatch, current.current), []);
  const value = useMemo(() => ({ state, activeUri, dispatch }), [state, activeUri]);
  return (
    <WorkspaceActionsContext.Provider value={actions}>
      <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
    </WorkspaceActionsContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}

/** Workspace actions; the returned object never changes, so using it doesn't cause re-renders. */
export function useWorkspaceActions() {
  const ctx = useContext(WorkspaceActionsContext);
  if (!ctx) throw new Error("useWorkspaceActions must be used inside WorkspaceProvider");
  return ctx;
}

/** Tabs in display order: pinned first, then the rest. */
export function orderedTabs(state: WorkspaceState) {
  const pinned = state.openTabs.filter(u => state.pinned.includes(u));
  const rest = state.openTabs.filter(u => !state.pinned.includes(u));
  return [...pinned, ...rest];
}

// ── Groups ───────────────────────────────────────────────────────────────────

/**
 * The group a path belongs to: the group holding the innermost folder that
 * contains it (longest-prefix match, so a nested folder's group wins over
 * its parent's).
 */
export function groupOf(groups: FolderGroup[], path: string, caseInsensitive: boolean): FolderGroup | null {
  let best: { group: FolderGroup; length: number } | null = null;
  for (const group of groups) {
    for (const folder of group.folders) {
      if (isInside(path, folder, caseInsensitive) && (!best || folder.length > best.length)) {
        best = { group, length: folder.length };
      }
    }
  }
  return best?.group ?? null;
}

// ── Folder colours (tab hints and explorer roots) ────────────────────────────

const FOLDER_COLOURS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

export function folderColour(index: number) {
  return FOLDER_COLOURS[index % FOLDER_COLOURS.length];
}
