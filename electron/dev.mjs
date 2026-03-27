/**
 * Dev launcher: starts the Express+Vite dev server, waits for it to be
 * ready, then opens the Electron window pointing at http://localhost:5000.
 *
 * Usage:  node electron/dev.mjs
 */

import { spawn } from 'child_process';
import http from 'http';

const PORT = process.env.PORT || 5000;

function waitForServer(port, attempts = 60, interval = 500) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      tries++;
      const req = http.get(`http://localhost:${port}/api/documents`, () => resolve());
      req.on('error', () => {
        if (tries >= attempts) reject(new Error('Server did not start in time.'));
        else setTimeout(check, interval);
      });
      req.end();
    };
    check();
  });
}

// 1. Start the web dev server (Express + Vite)
const devServer = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NODE_ENV: 'development' },
});

devServer.on('error', (err) => {
  console.error('Failed to start dev server:', err.message);
  process.exit(1);
});

console.log(`[electron-dev] Waiting for dev server on port ${PORT}...`);

// 2. Wait for it to respond, then launch Electron
waitForServer(PORT)
  .then(() => {
    console.log('[electron-dev] Server ready — launching Electron window.');

    const electronPath = new URL('../node_modules/.bin/electron', import.meta.url).pathname;

    const electronProc = spawn(electronPath, ['electron/main.cjs'], {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'development' },
    });

    electronProc.on('error', (err) => {
      console.error('Failed to start Electron:', err.message);
      console.error('Make sure electron is installed: npm install electron --save-dev');
    });

    electronProc.on('close', (code) => {
      console.log(`[electron-dev] Electron exited (${code}). Stopping dev server.`);
      devServer.kill();
      process.exit(code ?? 0);
    });
  })
  .catch((err) => {
    console.error('[electron-dev]', err.message);
    devServer.kill();
    process.exit(1);
  });

// Forward Ctrl-C to both child processes
process.on('SIGINT', () => {
  devServer.kill();
  process.exit(0);
});
