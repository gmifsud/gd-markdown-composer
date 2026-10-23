'use strict';

const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

// In a packaged build app.isPackaged === true.
// In dev (node electron/main.cjs) it is false.
const isPacked = app.isPackaged;

// Note: the data folder (%APPDATA%/rest-express on Windows) is named after
// "name" in package.json, not the product name. Renaming the package would
// move the database, zoom level and open folders/tabs to a new, empty folder.

// Dev connects to the `bun run dev` server on PORT (default 5000).
// The packaged app prefers a fixed, uncommon port so the page origin (and
// with it localStorage: pinned/closed tabs) stays the same between launches,
// and lets the server fall back to a free port if that one is taken.
const DEV_PORT = Number(process.env.PORT || 5000);
const PACKED_PREFERRED_PORT = Number(process.env.PORT || 47615);

const SERVER_READY_RE = /MDC_SERVER_READY port=(\d+)/;
// Chromium zoom levels: each step is a factor of 1.2 (0 = 100%).
const ZOOM_STEP = 0.5;
const ZOOM_MIN = -4;
const ZOOM_MAX = 6;
const SERVER_START_TIMEOUT_MS = 20000;
const CLOSE_FLUSH_TIMEOUT_MS = 3000;

let mainWindow = null;
let serverProcess = null;
let serverPort = isPacked ? PACKED_PREFERRED_PORT : DEV_PORT;

// ── Files opened from the OS (double-click, "Open with", drag onto the icon) ─
// Paths wait here until the page takes them (pull model: the page drains the
// queue when it mounts and whenever it is told new paths arrived), so a path
// that arrives before the page is ready is never lost.
const pendingFiles = [];

/** Existing files named on a command line, resolved against `cwd`. */
function filesFromArgv(argv, cwd) {
  const files = [];
  // argv[0] is the executable. Chromium can insert switches anywhere, and in
  // dev the main script itself is an argument, so filter rather than slice.
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith('-')) continue;
    const full = path.resolve(cwd, arg);
    if (full === __filename) continue;
    try {
      if (fs.statSync(full).isFile()) files.push(full);
    } catch {
      // Not a path to an existing file.
    }
  }
  return files;
}

function queueFiles(files) {
  if (files.length === 0) return;
  pendingFiles.push(...files);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mdc:files-pending');
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

// One running app: a second launch (double-clicking another file) hands its
// files to this instance and exits. Without this, each launch started its own
// window and server on a different port, so it also lost the open tabs and
// folders (localStorage belongs to the page origin, which includes the port).
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    queueFiles(filesFromArgv(argv, workingDirectory));
    if (!mainWindow && app.isReady()) createWindow();
  });
  // macOS delivers files through this event (also before 'ready').
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    queueFiles([filePath]);
  });
  queueFiles(filesFromArgv(process.argv, process.cwd()));
}

// ── Poll localhost until the Express server responds (dev only) ──────────────
function waitForServer(port, attempts = 40, interval = 500) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      tries++;
      const req = http.get(`http://127.0.0.1:${port}/api/documents`, () => {
        resolve();
      });
      req.on('error', () => {
        if (tries >= attempts) {
          reject(new Error(`Server on port ${port} did not respond after ${attempts} attempts.`));
        } else {
          setTimeout(check, interval);
        }
      });
      req.end();
    };
    check();
  });
}

// ── Database location ────────────────────────────────────────────────────────
// Keep the database in the per-user data folder: the install folder (e.g.
// Program Files) is usually not writable. A database left by older builds at
// ./data/editor.db is copied over once.
function resolveSqlitePath() {
  if (process.env.SQLITE_PATH) return process.env.SQLITE_PATH;

  const dataDir = app.getPath('userData');
  const dbPath = path.join(dataDir, 'editor.db');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const legacyPath = path.join(process.cwd(), 'data', 'editor.db');
    if (!fs.existsSync(dbPath) && fs.existsSync(legacyPath)) {
      fs.copyFileSync(legacyPath, dbPath);
      console.log(`[electron] Copied existing database from ${legacyPath}`);
    }
  } catch (err) {
    console.warn('[electron] Could not prepare data folder:', err.message);
  }
  return dbPath;
}

// ── Start the bundled Express server (production only) ───────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    // dist/** is unpacked from app.asar (see electron-builder.yml asarUnpack):
    // the bundled Bun binary cannot read files inside an asar archive.
    const appRoot = app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked');
    const serverPath = path.join(appRoot, 'dist', 'index.js');
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(PACKED_PREFERRED_PORT),
      PORT_FALLBACK: '1',
      // Opening folders from disk is a desktop feature.
      FS_ACCESS: '1',
      // Shipped by electron-builder.yml extraResources (fetched by script/fetch-vendor.mjs).
      PLANTUML_JAR: path.join(process.resourcesPath, 'plantuml', 'plantuml.jar'),
      SQLITE_PATH: resolveSqlitePath(),
    };

    // The packaged app bundles a per-platform Bun binary because the server
    // uses bun:sqlite (a built-in module unavailable in Electron's Node).
    const bunName = process.platform === 'win32' ? 'bun.exe' : 'bun';
    const bunPath = isPacked
      ? path.join(process.resourcesPath, bunName)
      : 'bun';

    serverProcess = spawn(bunPath, [serverPath], {
      env,
      cwd: app.getPath('userData'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    const finish = (err, port) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(port);
    };
    const timer = setTimeout(
      () => finish(new Error(`Server did not report ready within ${SERVER_START_TIMEOUT_MS}ms.`)),
      SERVER_START_TIMEOUT_MS,
    );

    // Resolve as soon as the server prints its ready line (no polling).
    let stdoutTail = '';
    serverProcess.stdout.on('data', (data) => {
      const text = data.toString();
      process.stdout.write('[server] ' + text);
      stdoutTail = (stdoutTail + text).slice(-1024);
      const match = SERVER_READY_RE.exec(stdoutTail);
      if (match) finish(null, Number(match[1]));
    });

    serverProcess.stderr.on('data', (data) => {
      process.stderr.write('[server] ' + data.toString());
    });

    serverProcess.on('error', (err) => {
      console.error('Failed to start server process:', err.message);
      finish(err);
    });

    serverProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`Server exited with code ${code}`);
      }
      finish(new Error(`Server exited before it was ready (code ${code}).`));
    });
  });
}

// ── Zoom ─────────────────────────────────────────────────────────────────────
// The built-in zoomIn role listens for Ctrl+Plus, which needs Shift on most
// keyboards, so Ctrl+= did nothing. Zoom keys are handled here instead, and
// the level is remembered between launches.

function zoomStatePath() {
  return path.join(app.getPath('userData'), 'zoom.json');
}

function loadZoomLevel() {
  try {
    const { level } = JSON.parse(fs.readFileSync(zoomStatePath(), 'utf8'));
    return typeof level === 'number' ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level)) : 0;
  } catch {
    return 0;
  }
}

function saveZoomLevel(level) {
  try {
    fs.writeFileSync(zoomStatePath(), JSON.stringify({ level }));
  } catch (err) {
    console.warn('[electron] Could not save zoom level:', err.message);
  }
}

function setZoom(contents, level) {
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
  contents.setZoomLevel(next);
  saveZoomLevel(next);
}

const zoomIn = (contents) => setZoom(contents, contents.getZoomLevel() + ZOOM_STEP);
const zoomOut = (contents) => setZoom(contents, contents.getZoomLevel() - ZOOM_STEP);
const resetZoom = (contents) => setZoom(contents, 0);

function installZoomHandling(contents) {
  // Ctrl/Cmd with =, +, -, 0 on the main keys or the numpad.
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const { key, code } = input;
    if (key === '=' || key === '+' || code === 'NumpadAdd') {
      event.preventDefault();
      zoomIn(contents);
    } else if (key === '-' || key === '_' || code === 'NumpadSubtract') {
      event.preventDefault();
      zoomOut(contents);
    } else if ((key === '0' && !input.shift) || code === 'Numpad0') {
      event.preventDefault();
      resetZoom(contents);
    }
  });

  // Ctrl + mouse wheel / trackpad pinch.
  contents.on('zoom-changed', (_event, direction) => {
    if (direction === 'in') zoomIn(contents);
    else zoomOut(contents);
  });

  contents.on('did-finish-load', () => contents.setZoomLevel(loadZoomLevel()));
}

// ── Application menu (minimal) ───────────────────────────────────────────────
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        // Accelerators are shown in the menu; the keys themselves are handled
        // in installZoomHandling so Ctrl+= and the numpad work too.
        {
          label: 'Actual Size',
          accelerator: 'CommandOrControl+0',
          registerAccelerator: false,
          click: (_item, win) => win && resetZoom(win.webContents),
        },
        {
          label: 'Zoom In',
          accelerator: 'CommandOrControl+=',
          registerAccelerator: false,
          click: (_item, win) => win && zoomIn(win.webContents),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CommandOrControl+-',
          registerAccelerator: false,
          click: (_item, win) => win && zoomOut(win.webContents),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(!isPacked ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Only hand web and mail links to the OS. Other schemes (file:, smb:, custom
// protocol handlers) could launch local programs.
function openExternalSafely(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
      shell.openExternal(url);
    }
  } catch {
    // Ignore malformed URLs.
  }
}

// ── Create the main browser window ───────────────────────────────────────────
async function createWindow() {
  console.log(isPacked ? '[electron] Production mode — starting server...' : '[electron] Dev mode — connecting to existing server...');

  if (isPacked) {
    if (!serverProcess) {
      try {
        serverPort = await startServer();
        console.log(`[electron] Server ready on port ${serverPort}.`);
      } catch (err) {
        console.error('[electron] Could not start server:', err.message);
      }
    }
  } else {
    // Dev: the server is already running via `bun run dev`
    try {
      await waitForServer(serverPort, 60, 500);
      console.log('[electron] Connected to dev server.');
    } catch (err) {
      console.warn('[electron] Dev server not ready yet, loading anyway...');
    }
  }

  // The packaged server only listens on IPv4 loopback; "localhost" can resolve
  // to ::1 first on some systems.
  const appOrigin = isPacked ? `http://127.0.0.1:${serverPort}` : `http://localhost:${serverPort}`;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    title: 'GD Markdown Composer',
    icon: path.join(__dirname, 'icons', 'icon-256.png'),
    show: false,
    backgroundColor: '#eef0f2',
    // Remove default frame on macOS for a native feel
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
  });

  buildMenu();

  installZoomHandling(mainWindow.webContents);

  mainWindow.loadURL(appOrigin);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Links that would open a new window go to the system browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });

  // Never let a link navigate the app window away from the app.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(appOrigin)) return;
    event.preventDefault();
    openExternalSafely(url);
  });

  // Give the page a chance to save pending edits before the window closes.
  let flushedBeforeClose = false;
  mainWindow.on('close', (event) => {
    if (flushedBeforeClose) return;
    event.preventDefault();
    const win = mainWindow;
    const flush = win.webContents.executeJavaScript(
      'window.__flushPendingSaves ? window.__flushPendingSaves() : undefined',
      true,
    );
    const timeout = new Promise((resolve) => setTimeout(resolve, CLOSE_FLUSH_TIMEOUT_MS));
    Promise.race([flush, timeout])
      .catch((err) => console.warn('[electron] Saving before close failed:', err?.message ?? err))
      .finally(() => {
        flushedBeforeClose = true;
        if (!win.isDestroyed()) win.close();
      });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC for electron/preload.cjs ─────────────────────────────────────────────
ipcMain.handle('mdc:pick-folders', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Open Folder',
    properties: ['openDirectory', 'multiSelections'],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('mdc:take-pending-files', () => pendingFiles.splice(0));

// Only documents: opening an arbitrary path could run a program.
const OPENABLE_EXTENSIONS = new Set(['.docx', '.doc', '.xlsx', '.xlsm', '.xls', '.pptx', '.pdf', '.csv']);

ipcMain.handle('mdc:open-path', async (_event, targetPath) => {
  if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath)) return 'Invalid path';
  if (!OPENABLE_EXTENSIONS.has(path.extname(targetPath).toLowerCase())) return 'Not an openable document';
  return shell.openPath(targetPath);
});

ipcMain.handle('mdc:reveal-path', (_event, targetPath) => {
  if (typeof targetPath === 'string' && path.isAbsolute(targetPath)) {
    shell.showItemInFolder(targetPath);
  }
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
if (isPrimaryInstance) app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    killServer();
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// 'will-quit' fires after every window has closed (and flushed its saves);
// 'before-quit' would stop the server while the windows are still saving.
app.on('will-quit', killServer);

function killServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}
