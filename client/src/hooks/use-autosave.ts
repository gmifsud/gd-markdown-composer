import { useCallback, useEffect, useReducer, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  saveDocument, cacheSavedDocument, encodedSize,
  DocumentNotFoundError, KEEPALIVE_BODY_LIMIT,
} from "@/hooks/use-documents";
import { registerPendingSave } from "@/lib/pending-saves";
import { useToast } from "@/hooks/use-toast";

interface Snapshot {
  content: string;
  title: string;
}

const sameSnapshot = (a: Snapshot, b: Snapshot) => a.content === b.content && a.title === b.title;

export type SaveStatus = "saved" | "dirty" | "saving";

/**
 * Auto-saves a document's title and content after `delay` ms without edits,
 * and flushes immediately on unmount (switching documents), Ctrl/Cmd+S, page
 * hide/unload and desktop window close. Saves for one document run one at a
 * time, in order, so an older save never lands after a newer one.
 *
 * Mount one instance per document (key the component by document id).
 */
export function useAutosave(id: number, current: Snapshot, initial: Snapshot, delay = 1000) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const latest = useRef(current);
  latest.current = current;
  // Last snapshot the server confirmed, and the one currently being sent.
  const saved = useRef(initial);
  const inFlight = useRef<Snapshot | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const gone = useRef(false);

  const isDirty = useCallback(
    () => !gone.current && !sameSnapshot(latest.current, inFlight.current ?? saved.current),
    [],
  );

  const send = useCallback((snapshot: Snapshot, keepalive: boolean): Promise<boolean> => {
    inFlight.current = snapshot;
    rerender();
    return saveDocument(id, snapshot, { keepalive })
      .then(doc => {
        saved.current = snapshot;
        cacheSavedDocument(queryClient, doc);
        return true;
      })
      .catch(err => {
        if (err instanceof DocumentNotFoundError) {
          // Deleted elsewhere (or just now from the tab bar): nothing left to save to.
          gone.current = true;
          return true;
        }
        toast({ title: "Error", description: "Failed to save document", variant: "destructive" });
        return false;
      })
      .finally(() => {
        if (inFlight.current === snapshot) inFlight.current = null;
        rerender();
      });
  }, [id, queryClient, toast]);

  /** Queued save of the latest edits. */
  const flush = useCallback((): Promise<boolean> => {
    const run = queue.current.then(() => (isDirty() ? send({ ...latest.current }, false) : true));
    queue.current = run.catch(() => undefined);
    return run;
  }, [isDirty, send]);

  /**
   * Starts a keepalive save synchronously, for page hide/unload. Returns false
   * when the edits are too large for a keepalive request.
   */
  const flushOnUnload = useCallback((): boolean => {
    if (!isDirty()) return true;
    const snapshot = { ...latest.current };
    if (encodedSize(JSON.stringify(snapshot)) > KEEPALIVE_BODY_LIMIT) return false;
    void send(snapshot, true);
    return true;
  }, [isDirty, send]);

  // Debounced auto-save.
  useEffect(() => {
    if (!isDirty()) return;
    const timer = setTimeout(() => void flush(), delay);
    return () => clearTimeout(timer);
  }, [current.content, current.title, delay, flush, isDirty]);

  // Page-level flushes (Ctrl+S, unload, window close) and flush on unmount.
  useEffect(() => {
    const unregister = registerPendingSave({ isDirty, flush, flushOnUnload });
    return () => {
      unregister();
      void flush();
    };
  }, [isDirty, flush, flushOnUnload]);

  const status: SaveStatus = inFlight.current ? "saving" : isDirty() ? "dirty" : "saved";
  return { status, flush };
}
