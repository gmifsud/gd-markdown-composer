'use strict';

// Exposes a small, fixed API to the page. The page never gets ipcRenderer
// itself, only these calls.
const { contextBridge, ipcRenderer } = require('electron');

function readArg(prefix) {
  if (typeof process === 'undefined' || !Array.isArray(process.argv)) return undefined;
  const found = process.argv.find((a) => typeof a === 'string' && a.startsWith(prefix));
  return found ? found.slice(prefix.length) || undefined : undefined;
}

contextBridge.exposeInMainWorld('mdcDesktop', {
  /** Opens the native folder picker. Resolves to the chosen absolute paths ([] if cancelled). */
  pickFolders: () => ipcRenderer.invoke('mdc:pick-folders'),
  /** Shows a file or folder in the system file manager. */
  revealPath: (targetPath) => ipcRenderer.invoke('mdc:reveal-path', targetPath),
  /** Opens a document in its default app (Word, Excel…). */
  openPath: (targetPath) => ipcRenderer.invoke('mdc:open-path', targetPath),
  /** Files the OS asked the app to open that the page hasn't taken yet (the queue is emptied). */
  takePendingFiles: () => ipcRenderer.invoke('mdc:take-pending-files'),
  /** Calls `callback` when more files are waiting; returns an unsubscribe function. */
  onFilesPending: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('mdc:files-pending', listener);
    return () => ipcRenderer.removeListener('mdc:files-pending', listener);
  },
  /** Runtime version strings for the About dialog. */
  versions: {
    app: readArg('--mdc-app-version='),
    buildNumber: readArg('--mdc-build-number='),
    electron: typeof process !== 'undefined' && process.versions ? process.versions.electron : undefined,
    chrome: typeof process !== 'undefined' && process.versions ? process.versions.chrome : undefined,
    node: typeof process !== 'undefined' && process.versions ? process.versions.node : undefined,
  },
});
