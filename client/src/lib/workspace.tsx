import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode,
} from "react";
import { useLocation, useRoute, useSearch } from "wouter";

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

export type SidebarPanel = "explorer" | "documents";
/** Editor layout: source only, source and preview side by side, or preview only. */
export type EditorMode = "edit" | "split" | "preview";

export interface WorkspaceState {
  folders: string[];
  openTabs: string[];
  pinned: string[];
  expanded: string[];
  sidebar: { visible: boolean; width: number; panel: SidebarPanel };
  editorMode: EditorMode;
}

export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 640;
export const SIDEBAR_DEFAULT_WIDTH = 260;

const STORAGE_KEY = "mdc.workspace.v1";

const initialState: WorkspaceState = {
  folders: [],
  openTabs: [],
  pinned: [],
  expanded: [],
  sidebar: { visible: true, width: SIDEBAR_DEFAULT_WIDTH, panel: "explorer" },
  editorMode: "split",
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
  | { type: "togglePin"; uri: string }
  | { type: "addFolders"; paths: string[] }
  | { type: "removeFolder"; path: string }
  | { type: "setExpanded"; path: string; expanded: boolean }
  | { type: "sidebar"; patch: Partial<WorkspaceState["sidebar"]> }
  | { type: "pruneDb"; existingIds: number[] }
  | { type: "editorMode"; mode: EditorMode };

const clampWidth = (w: number) => Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w)));

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
      return { ...state, folders: state.folders.filter(f => f !== action.path) };
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

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const activeUri = useActiveUri();

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

  const value = useMemo(() => ({ state, activeUri, dispatch }), [state, activeUri]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}

/** Tabs in display order: pinned first, then the rest. */
export function orderedTabs(state: WorkspaceState) {
  const pinned = state.openTabs.filter(u => state.pinned.includes(u));
  const rest = state.openTabs.filter(u => !state.pinned.includes(u));
  return [...pinned, ...rest];
}

export function useWorkspaceActions() {
  const { state, activeUri, dispatch } = useWorkspace();
  const [, setLocation] = useLocation();

  const open = useCallback((uri: string) => {
    dispatch({ type: "open", uri, after: activeUri });
    setLocation(hrefFor(uri));
  }, [activeUri, dispatch, setLocation]);

  /** Closes tabs; if the active one closes, moves to its nearest open neighbour. */
  const close = useCallback((uris: string[]) => {
    if (uris.length === 0) return;
    const closing = new Set(uris);
    if (activeUri && closing.has(activeUri)) {
      const tabs = orderedTabs(state);
      const index = tabs.indexOf(activeUri);
      const remaining = (list: string[]) => list.find(u => !closing.has(u));
      const next = remaining(tabs.slice(index + 1)) ?? remaining(tabs.slice(0, index).reverse());
      setLocation(next ? hrefFor(next) : "/");
    }
    dispatch({ type: "close", uris });
  }, [activeUri, dispatch, setLocation, state]);

  return {
    open,
    close,
    togglePin: (uri: string) => dispatch({ type: "togglePin", uri }),
    addFolders: (paths: string[]) => dispatch({ type: "addFolders", paths }),
    removeFolder: (path: string) => dispatch({ type: "removeFolder", path }),
    setExpanded: (path: string, expanded: boolean) => dispatch({ type: "setExpanded", path, expanded }),
    setSidebar: (patch: Partial<WorkspaceState["sidebar"]>) => dispatch({ type: "sidebar", patch }),
    pruneDb: (existingIds: number[]) => dispatch({ type: "pruneDb", existingIds }),
    setEditorMode: (mode: EditorMode) => dispatch({ type: "editorMode", mode }),
  };
}

// ── Folder colours (tab hints and explorer roots) ────────────────────────────

const FOLDER_COLOURS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

export function folderColour(index: number) {
  return FOLDER_COLOURS[index % FOLDER_COLOURS.length];
}
