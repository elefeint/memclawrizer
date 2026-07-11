/**
 * Renderer entry: a tiny in-memory router over the three screens.
 * All backend access goes through ./api (mock or real — never window.api).
 */
import './index.css';
import { mountHome } from './screens/home';
import { mountDrill, type Nav } from './screens/drill';
import { mountCalibrate } from './screens/calibrate';
import { mountStats } from './screens/stats';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');
const app: HTMLElement = root;

let unmount: (() => void) | null = null;
let swapId = 0;

function showError(e: unknown): void {
  const banner = document.createElement('pre');
  banner.className = 'error-banner';
  banner.textContent = String(e instanceof Error ? (e.stack ?? e.message) : e);
  app.appendChild(banner);
}

function swap(mount: (root: HTMLElement) => Promise<() => void>): void {
  const id = ++swapId;
  const prev = unmount;
  unmount = null;
  prev?.();
  app.innerHTML = '';
  mount(app).then(
    (u) => {
      if (id === swapId) unmount = u;
      else u();
    },
    (e) => showError(e),
  );
}

const nav: Nav = {
  home: (announce) => swap((r) => mountHome(r, nav, announce)),
  drill: (deckId, tags) => swap((r) => mountDrill(r, deckId, tags, nav)),
  calibrate: (deckId, tags, mode) => swap((r) => mountCalibrate(r, deckId, tags, mode, nav)),
  stats: (deckId) => swap((r) => mountStats(r, deckId, nav)),
};

window.addEventListener('error', (e) => showError(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

nav.home();
