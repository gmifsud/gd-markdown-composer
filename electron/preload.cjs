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
});
