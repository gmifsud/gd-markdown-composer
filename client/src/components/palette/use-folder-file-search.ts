import { useEffect, useState } from "react";
import { fsApi } from "@/lib/fs-api";

export const FOLDER_RESULT_LIMIT = 50;
const DEBOUNCE_MS = 150;
const MIN_QUERY = 2;

export interface FolderSearch {
  /** The (trimmed) query these files answer. */
  query: string;
  files: string[];
  loading: boolean;
  /** More matches exist than are shown. */
  truncated: boolean;
}

const EMPTY: FolderSearch = { query: "", files: [], loading: false, truncated: false };

/**
 * Files to list for `query`. Folder rows bypass cmdk's filter (the server
 * already filtered them), so files found for an earlier query must not be
 * shown, or Enter could open a file that doesn't match what was typed.
 */
export function currentFolderFiles(result: FolderSearch, query: string): string[] {
  return result.query === query.trim() ? result.files : NO_FILES;
}
// One shared empty list, so callers' memoised item lists don't rebuild every render.
const NO_FILES: string[] = [];

/**
 * File names in the open folders matching `query` (server-side, names only).
 * Waits for typing to pause, cancels the previous request, and ignores
 * answers to requests that were superseded.
 */
export function useFolderFileSearch(query: string, roots: string[], enabled: boolean): FolderSearch {
  const [result, setResult] = useState<FolderSearch>(EMPTY);
  const rootsKey = roots.join("\n");

  useEffect(() => {
    const text = query.trim();
    if (!enabled || text.length < MIN_QUERY || roots.length === 0) {
      setResult(EMPTY);
      return;
    }
    setResult(r => ({ ...r, loading: true }));
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fsApi.search({ roots, query: text, contents: false }, controller.signal).then(
        (res) => {
          if (controller.signal.aborted) return;
          const files = res.results.filter(r => r.kind === "file").map(r => r.path);
          setResult({
            query: text,
            files: files.slice(0, FOLDER_RESULT_LIMIT),
            loading: false,
            truncated: res.truncated || files.length > FOLDER_RESULT_LIMIT,
          });
        },
        () => {
          if (!controller.signal.aborted) setResult(EMPTY);
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `rootsKey` stands in for `roots`, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, rootsKey, enabled]);

  return result;
}
