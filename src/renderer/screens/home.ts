/**
 * Home screen. Interim version for F2 (deck list + drill buttons) — F3
 * expands it with box mini-bars, tag picker, import/export, settings, and the
 * trophy shelf.
 */
import { api } from '../api';
import { TESTIDS } from '../../shared/testids';
import type { Nav } from './drill';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  testid?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (testid) e.dataset.testid = testid;
  return e;
}

export async function mountHome(root: HTMLElement, nav: Nav): Promise<() => void> {
  const screen = el('div', 'home', TESTIDS.homeScreen);
  const h = el('h1');
  h.textContent = 'memclawrizer';
  screen.appendChild(h);

  const list = el('ul', 'deck-list', TESTIDS.deckList);
  screen.appendChild(list);

  const importBtn = el('button', 'import-button', TESTIDS.importButton);
  importBtn.textContent = 'Import deck…';
  importBtn.addEventListener('click', () => {
    void api.decks.import();
  });
  screen.appendChild(importBtn);

  const shelf = el('div', 'trophy-shelf', TESTIDS.trophyShelf);
  screen.appendChild(shelf);

  root.appendChild(screen);

  const decks = await api.decks.list();
  for (const deck of decks) {
    const li = el('li', 'deck-row', TESTIDS.deckRow);
    const name = el('span', 'deck-name');
    name.textContent = deck.name;
    const counts = el('span', 'deck-counts');
    counts.textContent = `${deck.dueCount} due · ${deck.newCount} new`;
    const drill = el('button', 'drill-button');
    drill.textContent = 'Drill';
    drill.addEventListener('click', () => nav.drill(deck.id));
    li.append(name, counts, drill);
    list.appendChild(li);
  }

  return () => screen.remove();
}
