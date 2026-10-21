import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown, FileSearch, Folder, Search, X } from "lucide-react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { PathMenuItems } from "@/components/layout/path-actions";
import { MoveMenuItem } from "@/components/layout/move-file-context";
import { requestReveal } from "@/lib/active-editor";
import { relativePath } from "@/lib/fs-api";
import { fileUri, useWorkspace, useWorkspaceActions } from "@/lib/workspace";
import type { FsSearchResult } from "@shared/fs";

// ── Search state (kept outside the panel so it survives switching panels) ────

interface SearchState {
  query: string;
  /** Also match text inside files. */
  contents: boolean;
  /** Bumped to ask the search box to take focus (Ctrl+Shift+F). */
  focusRequest: number;
}

let searchState: SearchState = { query: "", contents: false, focusRequest: 0 };
const listeners = new Set<() => void>();

function setSearchState(patch: Partial<SearchState>) {
  searchState = { ...searchState, ...patch };
  listeners.forEach(l => l());
}

export function useExplorerSearch() {
  const state = useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => searchState,
  );
  return {
    ...state,
    setQuery: (query: string) => setSearchState({ query }),
    setContents: (contents: boolean) => setSearchState({ contents }),
    clear: () => setSearchState({ query: "" }),
  };
}

/** Opens the explorer and focuses its search box with "Contents" turned on. */
export function focusExplorerSearch(contents: boolean) {
  setSearchState({ contents, focusRequest: searchState.focusRequest + 1 });
}

/** Whether a search is filtering the explorer. Read directly, so callers needn't re-render on every keystroke. */
export function isExplorerSearching() {
  return searchState.query.trim() !== "";
}

// ── Search box ───────────────────────────────────────────────────────────────

export function ExplorerSearchBox({ summary }: { summary?: ReactNode }) {
  const { query, contents, focusRequest, setQuery, setContents, clear } = useExplorerSearch();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusRequest > 0) {
      input.current?.focus();
      input.current?.select();
    }
  }, [focusRequest]);

  return (
    <div className="px-2 py-2 border-b border-[#2d2d2d] space-y-1.5">
      <div className="flex items-center gap-1 h-7 rounded bg-[#3c3c3c] border border-transparent focus-within:border-[#007fd4] pl-2 pr-1">
        <Search className="w-3.5 h-3.5 shrink-0 text-[#858585]" />
        <input
          ref={input}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); clear(); } }}
          placeholder={contents ? "Search names and contents" : "Filter by name"}
          className="flex-1 min-w-0 bg-transparent text-[12px] text-[#cccccc] placeholder:text-[#858585] focus:outline-none"
          aria-label="Search in folders"
          data-testid="explorer-search-input"
        />
        {query && (
          <button
            className="flex items-center justify-center w-5 h-5 rounded text-[#858585] hover:text-[#cccccc] hover:bg-[#4a4a4a]"
            onClick={clear}
            title="Clear (Esc)"
            data-testid="explorer-search-clear"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          className={`flex items-center justify-center w-6 h-5 rounded ${
            contents ? "bg-[#007fd4] text-white" : "text-[#858585] hover:text-[#cccccc] hover:bg-[#4a4a4a]"
          }`}
          onClick={() => setContents(!contents)}
          aria-pressed={contents}
          title={contents ? "Searching file contents too (Ctrl+Shift+F)" : "Also search inside files (Ctrl+Shift+F)"}
          data-testid="explorer-search-contents"
        >
          <FileSearch className="w-3.5 h-3.5" />
        </button>
      </div>
      {summary && <div className="text-[11px] text-[#858585] px-0.5">{summary}</div>}
    </div>
  );
}

// ── Filtered tree ────────────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  result?: FsSearchResult;
  children: TreeNode[];
}

/** Builds the folder tree that leads to each result under `root`. */
function buildTree(root: string, results: FsSearchResult[]): TreeNode[] {
  const top: TreeNode = { name: "", path: root, kind: "directory", children: [] };
  const sep = root.includes("\\") ? "\\" : "/";
  for (const result of results) {
    const parts = relativePath(result.path, root).split(/[\\/]/).filter(Boolean);
    let node = top;
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      let child = node.children.find(c => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: `${node.path.replace(/[\\/]+$/, "")}${sep}${part}`,
          kind: isLast ? result.kind : "directory",
          children: [],
        };
        node.children.push(child);
      }
      if (isLast) child.result = result;
      node = child;
    });
  }
  const sortTree = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.kind !== b.kind
      ? (a.kind === "directory" ? -1 : 1)
      : a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
    nodes.forEach(n => sortTree(n.children));
  };
  sortTree(top.children);
  return top.children;
}

/** Wraps case-insensitive matches of `query` in <mark>. */
export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={at} className="bg-[#f59e0b]/35 text-inherit rounded-sm">{text.slice(at, at + needle.length)}</mark>);
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

const INDENT = 12;

export function FilteredTree({ root, results, query, fileIcon }: {
  root: string;
  results: FsSearchResult[];
  query: string;
  fileIcon(name: string): ReactNode;
}) {
  const nodes = useMemo(() => buildTree(root, results), [root, results]);
  if (nodes.length === 0) {
    return <div className="h-[22px] pl-7 text-[12px] text-[#858585] italic">No matches</div>;
  }
  return (
    <div role="group" data-testid="filtered-tree">
      {nodes.map(n => <FilteredNode key={n.path} node={n} root={root} depth={1} query={query} fileIcon={fileIcon} />)}
    </div>
  );
}

function FilteredNode({ node, root, depth, query, fileIcon }: {
  node: TreeNode;
  root: string;
  depth: number;
  query: string;
  fileIcon(name: string): ReactNode;
}) {
  const { activeUri } = useWorkspace();
  const { open } = useWorkspaceActions();
  const isDir = node.kind === "directory";
  const uri = fileUri(node.path);
  const isActive = !isDir && activeUri === uri;
  const result = node.result;

  const openAt = (line?: number) => {
    open(uri);
    if (line !== undefined) requestReveal(uri, { line, query });
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="treeitem"
            aria-expanded={isDir ? true : undefined}
            tabIndex={0}
            className={`flex items-center gap-1.5 pr-2 h-[22px] focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#007fd4] ${
              isDir ? "text-[#cccccc]" : "cursor-pointer"
            } ${isActive ? "bg-[#37373d] text-white" : "hover:bg-[#2a2d2e] text-[#cccccc]"}`}
            style={{ paddingLeft: `${8 + depth * INDENT}px` }}
            onClick={() => !isDir && openAt(result?.lines[0]?.line)}
            onKeyDown={(e) => { if (!isDir && e.key === "Enter") openAt(result?.lines[0]?.line); }}
            title={node.path}
            data-testid={`search-entry-${node.name}`}
          >
            {isDir ? (
              <>
                <ChevronDown className="w-3 h-3 shrink-0 text-[#858585]" />
                <Folder className="w-3.5 h-3.5 shrink-0 text-yellow-400" />
              </>
            ) : (
              <>
                <span className="w-3 shrink-0" />
                {fileIcon(node.name)}
              </>
            )}
            <span className={`flex-1 truncate ${result ? "" : "text-[#9a9a9a]"}`}>
              {result?.nameMatch ? <Highlight text={node.name} query={query} /> : node.name}
            </span>
            {result && result.contentMatches > 0 && (
              <span
                className="shrink-0 min-w-[18px] h-4 px-1 rounded-full bg-[#4a4a4a] text-[10px] text-[#e5e5e5] flex items-center justify-center tabular-nums"
                title={`${result.contentMatches} match${result.contentMatches === 1 ? "" : "es"} in this file`}
                data-testid="search-match-count"
              >
                {result.contentMatches}
              </span>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          {!isDir && (
            <>
              <ContextMenuItem onSelect={() => openAt(result?.lines[0]?.line)}>Open</ContextMenuItem>
              <MoveMenuItem path={node.path} />
              <ContextMenuSeparator />
            </>
          )}
          <PathMenuItems path={node.path} root={root} isDirectory={isDir} />
        </ContextMenuContent>
      </ContextMenu>

      {result?.lines.map(l => (
        <button
          key={l.line}
          className="w-full flex items-baseline gap-2 pr-2 h-[20px] text-left text-[12px] text-[#a8a8a8] hover:bg-[#2a2d2e] hover:text-[#e5e5e5]"
          style={{ paddingLeft: `${8 + (depth + 1) * INDENT + 6}px` }}
          onClick={() => openAt(l.line)}
          title={`Line ${l.line + 1}: ${l.text}`}
          data-testid="search-line"
        >
          <span className="shrink-0 w-7 text-right text-[10px] tabular-nums text-[#6b6b6b]">{l.line + 1}</span>
          <span className="truncate"><Highlight text={l.text} query={query} /></span>
        </button>
      ))}

      {node.children.map(child => (
        <FilteredNode key={child.path} node={child} root={root} depth={depth + 1} query={query} fileIcon={fileIcon} />
      ))}
    </>
  );
}
