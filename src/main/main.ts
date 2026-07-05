import { app, BrowserWindow, dialog, protocol } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { openDatabase, Db, SCHEMA_VERSION } from './db';
import { registerIpc } from './ipc';
import { getMedia } from './queries';
import { SessionManager } from './sessions';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Test/dev hook: run against an isolated profile (and thus an isolated DB).
// Used by the Playwright smoke test and by parallel dev runs — DuckDB is
// single-writer, so two instances must not share one userData dir.
if (process.env.MEMCLAW_USERDATA) {
  app.setPath('userData', process.env.MEMCLAW_USERDATA);
}

// Must run before app ready. 'standard' lets mem:// URLs resolve like http
// ones inside <img>/<audio>; stream/fetch support for media playback.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mem',
    privileges: { standard: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
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

  // Headless-ish self-check for dev/CI: MEMCLAW_VERIFY=1 dumps what the
  // renderer actually rendered (api badge + deck rows) and probes the mem://
  // protocol end-to-end, then quits. No effect without the env var.
  if (process.env.MEMCLAW_VERIFY === '1') {
    mainWindow.webContents.on('did-finish-load', async () => {
      try {
        // Give the async renderer main() a beat to fill the deck list.
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const summary = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const badge = document.querySelector('.badge')?.textContent ?? '(no badge)';
            const rows = [...document.querySelectorAll('[data-testid="deck-row"]')]
              .map((el) => el.textContent);
            const probe = (src) => new Promise((resolve) => {
              const img = new Image();
              img.onload = () => resolve('img loaded ' + img.naturalWidth + 'x' + img.naturalHeight);
              img.onerror = () => resolve('img failed');
              img.src = src;
            });
            let mem = await probe('mem://media/mini/media/dot.svg');
            try {
              const r = await fetch('mem://media/mini/media/dot.svg');
              mem += '; fetch ' + r.status + ' ' + (r.headers.get('content-type') ?? '');
            } catch (e) { mem += '; fetch failed: ' + e; }
            return JSON.stringify({ badge, rows, mem });
          })()
        `);
        console.log(`[memclawrizer verify] ${summary}`);
      } catch (e) {
        console.log(`[memclawrizer verify] FAILED: ${String(e)}`);
      }
      app.quit();
    });
  }
};

app.whenReady().then(async () => {
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

  // mem://media/<media-id> streams BLOBs from the media table. The media id
  // is '<deck_id>/<path in pack>'; 'media' is the URL host and the id is the
  // URL path, percent-encoded per segment by sessions.mediaUrlFor.
  protocol.handle('mem', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'media' || db === null) {
      return new Response('not found', { status: 404 });
    }
    const mediaId = url.pathname
      .replace(/^\//, '')
      .split('/')
      .map(decodeURIComponent)
      .join('/');
    const media = await getMedia(db.conn, mediaId);
    if (media === null) return new Response('not found', { status: 404 });
    // The stored Uint8Array may view a larger buffer: copy to exact bytes.
    const body = new Uint8Array(media.bytes).buffer as ArrayBuffer;
    return new Response(body, {
      headers: {
        'Content-Type': media.mime,
        'Cache-Control': 'no-cache',
        // The renderer page's origin is http(s) (dev server / file). <img>
        // uses no-cors, but fetch/WebAudio need an explicit allow.
        'Access-Control-Allow-Origin': '*',
      },
    });
  });

  registerIpc(db, new SessionManager(db.conn));

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
