import { app, BrowserWindow, shell } from 'electron';
import { join } from 'path';
import { registerIpcHandlers } from './ipc-handlers';

let mainWindow: BrowserWindow | null = null;

/**
 * Allowed URL schemes for external links opened from the renderer.
 * Restricting to http/https prevents a compromised renderer from opening
 * file://, javascript:, or other dangerous schemes via shell.openExternal.
 */
const SAFE_EXTERNAL_URL_RE = /^https?:\/\//i;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Repo Explorer',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Sandbox keeps the renderer in a restricted Chromium sandbox.
      // Disabled because the preload script requires Node.js APIs (fs, path,
      // child_process via IPC) that are not available under sandbox=true.
      // contextIsolation: true + nodeIntegration: false still isolate the
      // renderer from the preload's Node globals.
      sandbox: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only allow http/https URLs to be opened externally. Reject file://,
    // javascript:, and other schemes that could be dangerous.
    if (SAFE_EXTERNAL_URL_RE.test(url)) {
      shell.openExternal(url);
    } else {
      console.warn('[security] Blocked attempt to open non-http(s) URL:', url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err: unknown) => {
  console.error('Initialization failed:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
