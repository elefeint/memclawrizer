/**
 * Home screen (F3): deck list (due/new counts, box mini-bar, drill,
 * drill-by-tag, export, settings), global import, and the trophy shelf —
 * sealed jars from perfect sessions, newest first. Keyboard-only friendly:
 * everything is native buttons/inputs/details.
 */
import { api } from '../api';
import { TESTIDS } from '../../shared/testids';
import type { DeckSummary, TrophyView } from '../../shared/api';
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

function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/** 5-segment mini-bar showing the Leitner box distribution. */
function boxMiniBar(boxCounts: DeckSummary['boxCounts']): HTMLElement {
  const bar = el('div', 'box-bar');
  const total = boxCounts.reduce((a, b) => a + b, 0);
  bar.title = boxCounts.map((c, i) => `box ${i + 1}: ${c}`).join('  ·  ');
  boxCounts.forEach((count, i) => {
    const seg = el('span', `box-seg box-${i + 1}`);
    seg.style.flexGrow = String(total === 0 ? 1 : count);
    if (count === 0) seg.classList.add('zero');
    bar.appendChild(seg);
  });
  return bar;
}

export async function mountHome(root: HTMLElement, nav: Nav): Promise<() => void> {
  const screen = el('div', 'home', TESTIDS.homeScreen);

  const header = el('header', 'home-header');
  const h = el('h1');
  h.textContent = 'memclawrizer';
  const importBtn = el('button', 'import-button', TESTIDS.importButton);
  importBtn.type = 'button';
  importBtn.textContent = 'Import deck…';
  header.append(h, importBtn);
  screen.appendChild(header);

  const status = el('p', 'home-status');
  status.hidden = true;
  screen.appendChild(status);

  const list = el('ul', 'deck-list', TESTIDS.deckList);
  screen.appendChild(list);

  const shelfSection = el('section', 'trophy-section');
  const shelfTitle = el('h2');
  shelfTitle.textContent = 'trophy shelf';
  const shelf = el('div', 'trophy-shelf', TESTIDS.trophyShelf);
  shelfSection.append(shelfTitle, shelf);
  screen.appendChild(shelfSection);

  root.appendChild(screen);

  function say(text: string): void {
    status.textContent = text;
    status.hidden = false;
  }

  importBtn.addEventListener('click', () => {
    void api.decks.import().then((result) => {
      if (result === null) return; // user canceled the dialog
      say(
        `imported “${result.name}”: ${result.cardsAdded} added, ${result.cardsUpdated} updated` +
          (result.orphanedCardIds.length > 0
            ? ` — ${result.orphanedCardIds.length} card(s) in the DB are missing from the pack`
            : ''),
      );
      void refreshDecks();
    });
  });

  function deckRow(deck: DeckSummary): HTMLElement {
    const li = el('li', 'deck-row', TESTIDS.deckRow);

    const main = el('div', 'deck-main');
    const name = el('span', 'deck-name');
    name.textContent = deck.name;
    const counts = el('span', 'deck-counts');
    counts.textContent = `${deck.dueCount} due · ${deck.newCount} new · ${deck.cardCount} cards`;
    main.append(name, boxMiniBar(deck.boxCounts), counts);

    const actions = el('div', 'deck-actions');
    actions.append(
      button('Drill', () => nav.drill(deck.id), 'drill-button'),
      button('Stats', () => nav.stats(deck.id)),
      button('Export', () => {
        void api.decks.export(deck.id).then((path) => {
          if (path !== null) say(`exported “${deck.name}” to ${path}`);
        });
      }),
    );

    li.append(main, actions);

    // Drill by tag — a details disclosure with checkboxes, keyboard-native.
    if (deck.tags.length > 0) {
      const details = el('details', 'tag-picker');
      const summary = el('summary');
      summary.textContent = 'Drill by tag…';
      details.appendChild(summary);
      const form = el('div', 'tag-picker-body');
      const boxes: HTMLInputElement[] = [];
      for (const tag of deck.tags) {
        const label = el('label', 'tag-option');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.value = tag;
        boxes.push(cb);
        label.append(cb, document.createTextNode(tag));
        form.appendChild(label);
      }
      form.appendChild(
        button('Drill selected', () => {
          const tags = boxes.filter((b) => b.checked).map((b) => b.value);
          nav.drill(deck.id, tags.length > 0 ? tags : undefined);
        }),
      );
      details.appendChild(form);
      li.appendChild(details);
    }

    // Per-deck settings.
    {
      const details = el('details', 'deck-settings');
      const summary = el('summary');
      summary.textContent = 'Settings';
      details.appendChild(summary);
      const form = el('div', 'deck-settings-body');

      const timerLabel = el('label');
      timerLabel.append(document.createTextNode('base timer (ms) '));
      const timer = el('input');
      timer.type = 'number';
      timer.min = '1000';
      timer.step = '500';
      timer.value = String(deck.settings.baseTimerMs);
      timerLabel.appendChild(timer);

      const newLabel = el('label');
      newLabel.append(document.createTextNode('new cards / session '));
      const newCards = el('input');
      newCards.type = 'number';
      newCards.min = '0';
      newCards.value = String(deck.settings.newCardsPerSession);
      newLabel.appendChild(newCards);

      form.append(
        timerLabel,
        newLabel,
        button('Save', () => {
          const settings = {
            baseTimerMs: Math.max(1000, Number(timer.value) || deck.settings.baseTimerMs),
            newCardsPerSession: Math.max(0, Number(newCards.value) || 0),
          };
          void api.decks.updateSettings(deck.id, settings).then(() => {
            say(`saved settings for “${deck.name}”`);
            details.open = false;
          });
        }),
      );
      details.appendChild(form);
      li.appendChild(details);
    }

    return li;
  }

  function trophyJar(t: TrophyView): HTMLElement {
    const jar = el('div', 'trophy-jar');
    jar.tabIndex = 0; // hover AND keyboard-focus reveal the label
    const date = new Date(t.endedAtIso);
    jar.title = `${t.deckName} — ${date.toLocaleDateString()} — ${t.size} ${t.size === 1 ? 'prize' : 'prizes'}`;
    const lid = el('div', 'trophy-lid');
    const glass = el('div', 'trophy-glass');
    // A peek of the actual contents; the title carries the full story.
    for (const prize of t.jar.slice(0, 9)) {
      const s = el('span');
      s.textContent = prize;
      glass.appendChild(s);
    }
    jar.append(lid, glass);
    return jar;
  }

  async function refreshDecks(): Promise<void> {
    const decks = await api.decks.list();
    list.innerHTML = '';
    if (decks.length === 0) {
      const empty = el('li', 'deck-empty');
      empty.textContent = 'no decks yet — import a .deckpack to begin';
      list.appendChild(empty);
      return;
    }
    for (const deck of decks) list.appendChild(deckRow(deck));
  }

  async function refreshShelf(): Promise<void> {
    const trophies = await api.stats.trophies();
    shelf.innerHTML = '';
    if (trophies.length === 0) {
      const empty = el('p', 'shelf-empty');
      empty.textContent = 'perfect sessions live here';
      shelf.appendChild(empty);
      return;
    }
    for (const t of trophies) shelf.appendChild(trophyJar(t));
  }

  await Promise.all([refreshDecks(), refreshShelf()]);

  return () => screen.remove();
}
