'use strict';

const { app, BrowserWindow, shell, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = process.env.PORT || 5000;

// In a packaged build app.isPackaged === true.
// In dev (node electron/main.cjs) it is false.
const isPacked = app.isPackaged;

let mainWindow = null;
let serverProcess = null;

// ── Poll localhost until the Express server responds ─────────────────────────
function waitForServer(port, attempts = 40, interval = 500) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      tries++;
      const req = http.get(`http://localhost:${port}/api/documents`, (res) => {
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

// ── Start the bundled Express server (production only) ───────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    // dist/index.js is placed inside the app bundle at build time
    const serverPath = path.join(app.getAppPath(), 'dist', 'index.js');
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
    };

    // The packaged app bundles a per-platform Bun binary because the server
    // uses bun:sqlite (a built-in module unavailable in Electron's Node).
    const bunName = process.platform === 'win32' ? 'bun.exe' : 'bun';
    const bunPath = isPacked
      ? path.join(process.resourcesPath, bunName)
      : 'bun';

    serverProcess = spawn(bunPath, [serverPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess.stdout.on('data', (data) => {
      process.stdout.write('[server] ' + data.toString());
    });

    serverProcess.stderr.on('data', (data) => {
      process.stderr.write('[server] ' + data.toString());
    });

    serverProcess.on('error', (err) => {
      console.error('Failed to start server process:', err.message);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`Server exited with code ${code}`);
      }
    });

    // Resolve once the HTTP server is actually accepting requests
    waitForServer(PORT).then(resolve).catch(reject);
  });
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
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(!isPacked ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Create the main browser window ───────────────────────────────────────────
async function createWindow() {
  console.log(isPacked ? '[electron] Production mode — starting server...' : '[electron] Dev mode — connecting to existing server...');

  if (isPacked) {
    try {
      await startServer();
      console.log('[electron] Server ready.');
    } catch (err) {
      console.error('[electron] Could not start server:', err.message);
    }
  } else {
    // Dev: the server is already running via `npm run dev`
    try {
      await waitForServer(PORT, 60, 500);
      console.log('[electron] Connected to dev server.');
    } catch (err) {
      console.warn('[electron] Dev server not ready yet, loading anyway...');
    }
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    title: 'Markdown Editor',
    show: false,
    backgroundColor: '#eef0f2',
    // Remove default frame on macOS for a native feel
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
  });

  buildMenu();

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in the system browser, not in the app window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost')) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  killServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('before-quit', killServer);

function killServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}
