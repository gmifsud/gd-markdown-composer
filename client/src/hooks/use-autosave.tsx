import { useCallback, useEffect, useReducer, useRef } from "react";
import { encodedSize, DocumentNotFoundError, KEEPALIVE_BODY_LIMIT } from "@/hooks/use-documents";
import { FsConflictError, FsNotFoundError } from "@/lib/fs-api";
import { registerPendingSave } from "@/lib/pending-saves";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

export interface Snapshot {
  content: string;
  title: string;
}

export interface SaveOptions {
  keepalive: boolean;
  /** Write even if the target changed since it was loaded (after the user chose Overwrite). */
  force: boolean;
}

/** Persists a snapshot. Throw FsConflictError on a conflicting external change. */
export type Saver = (snapshot: Snapshot, options: SaveOptions) => Promise<void>;

const sameSnapshot = (a: Snapshot, b: Snapshot) => a.content === b.content && a.title === b.title;

export type SaveStatus = "saved" | "dirty" | "saving" | "conflict";

interface AutosaveOptions {
  delay?: number;
  /** Read-only documents never save. */
  enabled?: boolean;
}

/**
 * Auto-saves a document after `delay` ms without edits, and flushes
 * immediately on unmount (switching documents), Ctrl/Cmd+S, page hide/unload
 * and desktop window close. Saves run one at a time, in order, so an older
 * save never lands after a newer one. If the target changed elsewhere,
 * auto-save pauses and a toast offers to overwrite.
 *
 * Mount one instance per document (key the component by the document).
 */
export function useAutosave(current: Snapshot, initial: Snapshot, save: Saver, options: AutosaveOptions = {}) {
  const { delay = 1000, enabled = true } = options;
  const { toast } = useToast();
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const latest = useRef(current);
  latest.current = current;
  const saveRef = useRef(save);
  saveRef.current = save;
  // Last snapshot confirmed saved, and the one currently being sent.
  const saved = useRef(initial);
  const inFlight = useRef<Snapshot | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const gone = useRef(false);
  const conflict = useRef(false);

  const isDirty = useCallback(
    () => enabled && !gone.current && !sameSnapshot(latest.current, inFlight.current ?? saved.current),
    [enabled],
  );

  // `flush` is defined below; the conflict toast needs to call it.
  const flushRef = useRef<(force?: boolean) => Promise<boolean>>(async () => true);

  const send = useCallback((snapshot: Snapshot, keepalive: boolean, force: boolean): Promise<boolean> => {
    inFlight.current = snapshot;
    rerender();
    return saveRef.current(snapshot, { keepalive, force })
      .then(() => {
        saved.current = snapshot;
        conflict.current = false;
        return true;
      })
      .catch(err => {
        if (err instanceof DocumentNotFoundError || err instanceof FsNotFoundError) {
          // Deleted elsewhere (or just now): nothing left to save to.
          gone.current = true;
          toast({ description: "This document no longer exists, so edits aren't being saved.", variant: "destructive" });
          return true;
        }
        if (err instanceof FsConflictError) {
          conflict.current = true;
          toast({
            title: "File changed on disk",
            description: "It was modified outside the editor. Your edits are not saved yet.",
            variant: "destructive",
            action: (
              <ToastAction altText="Overwrite the file with your edits" onClick={() => void flushRef.current(true)}>
                Overwrite
              </ToastAction>
            ),
          });
          return false;
        }
        toast({ title: "Error", description: "Failed to save", variant: "destructive" });
        return false;
      })
      .finally(() => {
        if (inFlight.current === snapshot) inFlight.current = null;
        rerender();
      });
  }, [toast]);

  /** Queued save of the latest edits. */
  const flush = useCallback((force = false): Promise<boolean> => {
    const run = queue.current.then(() => (isDirty() ? send({ ...latest.current }, false, force) : true));
    queue.current = run.catch(() => undefined);
    return run;
  }, [isDirty, send]);
  flushRef.current = flush;

  /**
   * Starts a keepalive save synchronously, for page hide/unload. Returns false
   * when the edits are too large for a keepalive request.
   */
  const flushOnUnload = useCallback((): boolean => {
    if (!isDirty() || conflict.current) return true;
    const snapshot = { ...latest.current };
    if (encodedSize(JSON.stringify(snapshot)) > KEEPALIVE_BODY_LIMIT) return false;
    void send(snapshot, true, false);
    return true;
  }, [isDirty, send]);

  // Debounced auto-save (paused while there is an unresolved conflict).
  useEffect(() => {
    if (!isDirty() || conflict.current) return;
    const timer = setTimeout(() => void flush(), delay);
    return () => clearTimeout(timer);
  }, [current.content, current.title, delay, flush, isDirty]);

  // Page-level flushes (Ctrl+S, unload, window close) and flush on unmount.
  useEffect(() => {
    if (!enabled) return;
    const unregister = registerPendingSave({ isDirty, flush: () => flush(), flushOnUnload });
    return () => {
      unregister();
      if (!conflict.current) void flush();
    };
  }, [enabled, isDirty, flush, flushOnUnload]);

  const status: SaveStatus = inFlight.current
    ? "saving"
    : conflict.current && isDirty() ? "conflict" : isDirty() ? "dirty" : "saved";
  return { status, flush };
}
