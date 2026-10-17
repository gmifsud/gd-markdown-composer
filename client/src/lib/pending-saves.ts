/**
 * Registry of editors with unsaved changes, so edits can be flushed when the
 * user presses Ctrl/Cmd+S, hides or reloads the page, or closes the desktop
 * window (electron/main.cjs calls window.__flushPendingSaves before closing).
 */

export interface PendingSaveSource {
  isDirty(): boolean;
  /** Saves now (queued behind any save in progress). Resolves `false` on failure. */
  flush(): Promise<boolean>;
  /**
   * Synchronously starts a keepalive request that survives page unload.
   * Returns `false` when the edits are too large for one.
   */
  flushOnUnload(): boolean;
}

const sources = new Set<PendingSaveSource>();

export function registerPendingSave(source: PendingSaveSource): () => void {
  sources.add(source);
  return () => {
    sources.delete(source);
  };
}

export function hasPendingSaves(): boolean {
  for (const source of Array.from(sources)) {
    if (source.isDirty()) return true;
  }
  return false;
}

/** Flushes every dirty editor. Resolves `true` when all of them saved. */
export async function flushAllPendingSaves(): Promise<boolean> {
  const results = await Promise.all(
    Array.from(sources).map(source => (source.isDirty() ? source.flush() : Promise.resolve(true))),
  );
  return results.every(Boolean);
}

/** Starts keepalive saves for every dirty editor. Returns `false` if any edits could not be sent. */
function flushAllOnUnload(): boolean {
  let allSent = true;
  for (const source of Array.from(sources)) {
    if (!source.flushOnUnload()) allSent = false;
  }
  return allSent;
}

declare global {
  interface Window {
    __flushPendingSaves?: () => Promise<void>;
  }
}

const isElectron = typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");

let installed = false;

/** Installs the page-level hooks once: Ctrl/Cmd+S, visibility/unload flushes and the Electron close hook. */
export function installPendingSaveHooks() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.__flushPendingSaves = async () => {
    await flushAllPendingSaves();
  };

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
      // Never show the browser's "Save page as" dialog.
      e.preventDefault();
      void flushAllPendingSaves();
    }
  });

  // Hiding the page (switching browser tab, minimising, closing the tab) is
  // the last reliable moment to start a request. Edits too large for a
  // keepalive request get a normal save, which completes if the page stays.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && !flushAllOnUnload()) {
      void flushAllPendingSaves();
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (!hasPendingSaves() || flushAllOnUnload()) return;
    // Some edits are too large for a keepalive request: start a normal save
    // (it finishes if the user stays) and ask before leaving.
    void flushAllPendingSaves();
    // In Electron, preventing unload cancels it silently with no prompt, and
    // window close is already flushed by the main process, so skip it there.
    if (!isElectron) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}
