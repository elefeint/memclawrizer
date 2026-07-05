import './index.css';
import { api, usingMock } from './api';
import { TESTIDS } from '../shared/testids';

/**
 * Phase 0 placeholder UI: proves the api swap point works end-to-end.
 * The Frontend agent replaces this with the home/drill/stats screens.
 */
async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('missing #app');

  const heading = document.createElement('h1');
  heading.textContent = 'memclawrizer';
  root.appendChild(heading);

  const badge = document.createElement('p');
  badge.className = 'badge';
  badge.textContent = usingMock ? 'walking skeleton — mock api' : 'walking skeleton — real api';
  root.appendChild(badge);

  const list = document.createElement('ul');
  list.dataset.testid = TESTIDS.deckList;
  root.appendChild(list);

  const decks = await api.decks.list();
  for (const deck of decks) {
    const li = document.createElement('li');
    li.dataset.testid = TESTIDS.deckRow;
    li.textContent = `${deck.name} — ${deck.dueCount} due, ${deck.newCount} new`;
    list.appendChild(li);
  }
}

main().catch((e) => {
  const root = document.getElementById('app');
  if (root) {
    const err = document.createElement('pre');
    err.textContent = String(e);
    root.appendChild(err);
  }
});
