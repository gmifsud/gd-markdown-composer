'use strict';

// Exposes a small, fixed API to the page. The page never gets ipcRenderer
// itself, only these calls.
const { contextBridge, ipcRenderer } = require('electron');

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
});
