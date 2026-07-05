/**
 * Stats screen. Stub until F4 (box histogram, due forecast, response-time
 * trend, per-card table, filterable attempt log).
 */
import { TESTIDS } from '../../shared/testids';
import type { Nav } from './drill';

export async function mountStats(root: HTMLElement, deckId: string, nav: Nav): Promise<() => void> {
  const screen = document.createElement('div');
  screen.className = 'stats';
  screen.dataset.testid = TESTIDS.statsScreen;

  const h = document.createElement('h1');
  h.textContent = `stats — ${deckId}`;
  screen.appendChild(h);

  const back = document.createElement('button');
  back.textContent = '← back';
  back.addEventListener('click', () => nav.home());
  screen.appendChild(back);

  root.appendChild(screen);
  return () => screen.remove();
}
