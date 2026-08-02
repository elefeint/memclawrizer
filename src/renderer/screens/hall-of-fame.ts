/**
 * Hall of Fame (F10b, DESIGN.md UI item 3) — ONE global screen; the per-deck
 * Stats button is gone. Styled as the arcade cabinet's own screen: a dark CRT
 * panel that stays dark in BOTH themes (the surrounding chrome — header,
 * back button — stays theme-aware), glowing monospace type, scanlines kept
 * faint because legibility wins.
 *
 * Top to bottom: the high-score table (score = SEALED JARS, counts only, no
 * percentages anywhere), the records board, and the deck-detail section — a
 * picker over active AND archived decks feeding the existing charts/tables
 * from deck-detail.ts. The Archived section's Stats link deep-links here with
 * its deck preselected.
 */
import { api } from '../api';
import { TESTIDS } from '../../shared/testids';
import type { HallOfFame } from '../../shared/api';
import {
  deckOptions,
  initialDeckId,
  parseDateIso,
  rankDeckScores,
  rankLabel,
  recordTiles,
  type DeckOption,
  type RecordFormatters,
} from '../hall-of-fame-data';
import { fmtDateTime, fmtMs, mountDeckDetail } from './deck-detail';
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

/** Lifetime board: a record from last year deserves its year. */
const FORMATTERS: RecordFormatters = {
  day: (iso) =>
    parseDateIso(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
  dateTime: (iso) => fmtDateTime(iso),
  ms: (ms) => fmtMs(ms),
};

function crtSection(title: string, className = ''): { section: HTMLElement; body: HTMLElement } {
  const section = el('section', `crt-section ${className}`.trim());
  const h = el('h2', 'crt-heading');
  h.textContent = title;
  const body = el('div', 'crt-body');
  section.append(h, body);
  return { section, body };
}

function note(text: string): HTMLElement {
  const p = el('p', 'crt-note');
  p.textContent = text;
  return p;
}

/** The high-score table: rank, deck, jars (THE score), mastered, attempts. */
function highScoreTable(hof: HallOfFame): HTMLElement {
  const rows = rankDeckScores(hof.deckScores);
  if (rows.length === 0) return note('no decks yet — import a .deckpack and drill something');

  const wrap = el('div', 'crt-table-wrap');
  const t = el('table', 'hof-table');
  const thead = el('thead');
  const hr = el('tr');
  for (const [label, cls] of [
    ['rank', 'col-rank'],
    ['deck', 'col-deck'],
    ['sealed jars', 'col-score'],
    ['mastered', 'col-num'],
    ['attempts', 'col-num'],
  ] as const) {
    const th = el('th', cls);
    th.textContent = label;
    hr.appendChild(th);
  }
  thead.appendChild(hr);

  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr', r.rank === 1 && r.sealedJars > 0 ? 'hof-row hof-top' : 'hof-row');
    const rank = el('td', 'col-rank');
    rank.textContent = rankLabel(r.rank);
    const deck = el('td', 'col-deck');
    deck.textContent = r.deckName;
    if (r.archived) {
      // Subtle: archived decks stay on the board, just visibly parked.
      const tag = el('span', 'hof-archived');
      tag.textContent = ' archived';
      deck.appendChild(tag);
    }
    const jars = el('td', 'col-score');
    jars.textContent = String(r.sealedJars);
    const mastered = el('td', 'col-num');
    mastered.textContent = String(r.masteredCards);
    const attempts = el('td', 'col-num');
    attempts.textContent = String(r.lifetimeAttempts);
    tr.append(rank, deck, jars, mastered, attempts);
    tbody.appendChild(tr);
  }
  t.append(thead, tbody);
  wrap.appendChild(t);
  return wrap;
}

function recordsBoard(hof: HallOfFame): HTMLElement {
  const grid = el('div', 'record-grid');
  for (const tile of recordTiles(hof, FORMATTERS)) {
    const card = el('div', `record-tile record-${tile.key}`);
    const label = el('span', 'record-label');
    label.textContent = tile.label;
    const value = el('span', 'record-value');
    value.textContent = tile.value;
    const detail = el('span', 'record-detail');
    detail.textContent = tile.detail;
    card.append(label, value, detail);
    grid.appendChild(card);
  }
  return grid;
}

export async function mountHallOfFame(
  root: HTMLElement,
  deckId: string | undefined,
  nav: Nav,
): Promise<() => void> {
  // Reuses the frozen stats-screen testid: same route, new content.
  const screen = el('div', 'hall', TESTIDS.statsScreen);

  const header = el('header', 'hall-header');
  const back = el('button', 'back-button');
  back.type = 'button';
  back.textContent = '← decks';
  back.addEventListener('click', () => nav.home());
  const h = el('h1');
  h.textContent = 'Hall of Fame';
  header.append(back, h);
  screen.appendChild(header);

  const crt = el('div', 'crt');
  screen.appendChild(crt);

  const scores = crtSection('high scores', 'hof-scores');
  const records = crtSection('records', 'hof-records');
  const detail = crtSection('deck detail', 'hof-detail');
  crt.append(scores.section, records.section, detail.section);

  root.appendChild(screen);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') nav.home();
  };
  window.addEventListener('keydown', onKey);

  const [hof, decks] = await Promise.all([api.stats.records(), api.decks.list()]);

  scores.body.appendChild(highScoreTable(hof));
  records.body.appendChild(recordsBoard(hof));

  // --- deck detail: picker + the existing charts/tables ---
  const options: DeckOption[] = deckOptions(decks);
  const picker = el('select', 'deck-picker');
  for (const o of options) {
    const opt = el('option');
    opt.value = o.id;
    opt.textContent = o.label;
    picker.appendChild(opt);
  }
  const filterRow = el('div', 'filter-row');
  const pickerLabel = el('label', 'picker-label');
  pickerLabel.textContent = 'deck ';
  pickerLabel.appendChild(picker);
  filterRow.appendChild(pickerLabel);
  detail.body.appendChild(filterRow);

  const detailHost = el('div', 'detail-host');
  detail.body.appendChild(detailHost);

  let disposeDetail: (() => void) | null = null;
  let detailToken = 0;

  async function showDeck(id: string): Promise<void> {
    const token = ++detailToken;
    disposeDetail?.();
    disposeDetail = null;
    detailHost.innerHTML = '';
    const dispose = await mountDeckDetail(detailHost, id);
    // A fast picker change could land out of order; last selection wins.
    if (token === detailToken) disposeDetail = dispose;
    else dispose();
  }

  const selected = initialDeckId(options, deckId);
  if (selected === null) {
    filterRow.hidden = true;
    detailHost.appendChild(note('nothing to chart yet'));
  } else {
    picker.value = selected;
    await showDeck(selected);
  }
  picker.addEventListener('change', () => void showDeck(picker.value));

  return () => {
    window.removeEventListener('keydown', onKey);
    detailToken++;
    disposeDetail?.();
    screen.remove();
  };
}
