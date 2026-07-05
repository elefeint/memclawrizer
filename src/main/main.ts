import { app, BrowserWindow, dialog, protocol } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { openDatabase, Db, SCHEMA_VERSION } from './db';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Must run before app ready. 'standard' lets mem:// URLs resolve like http
// ones inside <img>/<audio>; stream/fetch support for media playback.
protocol.registerSchemesAsPrivileged([
  { scheme: 'mem', privileges: { standard: true, supportFetchAPI: true, stream: true } },
]);

let db: Db | null = null;

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

app.whenReady().then(async () => {
  // Placeholder until B4 streams BLOBs from the media table.
  protocol.handle('mem', () => new Response('media not wired yet', { status: 404 }));

  const dbPath = path.join(app.getPath('userData'), 'memclawrizer.duckdb');
  try {
    db = await openDatabase(dbPath);
    // Load-bearing for packaged-app verification: greppable proof the native
    // addon loaded and migrations ran outside `npm start`.
    console.log(`[memclawrizer] DuckDB ready at ${dbPath} (schema v${SCHEMA_VERSION})`);
  } catch (e) {
    dialog.showErrorBox('memclawrizer cannot open its database', String(e));
    app.quit();
    return;
  }

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

export { db };
