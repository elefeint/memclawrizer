/**
 * Home screen (F3): deck list (due/new counts, box mini-bar, drill,
 * drill-by-tag, export, settings), global import, a collapsed Archived
 * section (F7: unarchive + stats only, no drill), and the trophy shelf —
 * per-deck odometer rows with place-value consolidation (DESIGN.md "The
 * trophy shelf at scale"): hundreds → tens → loose singles. Keyboard-only
 * friendly: everything is native buttons/inputs/details.
 */
import { api } from '../api';
import { TESTIDS } from '../../shared/testids';
import type { DeckSummary, TrophyView } from '../../shared/api';
import { ASSETS, svgLayer } from '../svg-assets';
import { consolidationEvent, deriveShelf, type DeckShelfRow, type DenominationJar } from '../shelf';
import * as audio from '../audio';
import * as T from '../timings';
import type { Nav } from './drill';

/**
 * Ceremony detection (documented choice): a same-session diff of per-deck
 * trophy counts across home renders. Module-level, deliberately NOT
 * persisted — the first render of an app run only takes a baseline, so a
 * consolidation that happened before a restart simply shows as the already-
 * consolidated shelf, exactly as DESIGN.md specifies.
 */
const lastSeenTrophyCounts = new Map<string, number>();
let trophyBaselineTaken = false;

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

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

export async function mountHome(
  root: HTMLElement,
  nav: Nav,
  announce?: string,
): Promise<() => void> {
  const screen = el('div', 'home', TESTIDS.homeScreen);

  const header = el('header', 'home-header');
  const h = el('h1');
  h.textContent = 'memclawrizer';
  const importBtn = el('button', 'import-button', TESTIDS.importButton);
  importBtn.type = 'button';
  importBtn.textContent = 'Import deck…';
  // F10b: stats went global — one Hall of Fame entry in the header instead of
  // a Stats button on every row.
  const hofBtn = button('Hall of Fame', () => nav.hallOfFame(), 'hof-button');
  const headerActions = el('div', 'home-header-actions');
  headerActions.append(hofBtn, importBtn);
  header.append(h, headerActions);
  screen.appendChild(header);

  const status = el('p', 'home-status');
  status.hidden = true;
  screen.appendChild(status);

  const list = el('ul', 'deck-list', TESTIDS.deckList);
  screen.appendChild(list);

  // F7: archived decks live in a collapsed disclosure below the active list.
  // The <details> element persists across refreshes so its open state does.
  const archivedSection = el('details', 'archived-section');
  const archivedSummary = el('summary');
  const archivedList = el('ul', 'archived-list');
  archivedSection.append(archivedSummary, archivedList);
  archivedSection.hidden = true;
  screen.appendChild(archivedSection);

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
  if (announce) say(announce); // e.g. a recalibration result carried home (F8)

  /** F8: an uncalibrated deck gets the copy-typing warm-up first; the drill
   *  intent (deck + tags) rides along and the drill starts automatically
   *  after the result line. A skipped warm-up is re-offered next time. */
  function startDrill(deck: DeckSummary, tags?: string[]): void {
    if (deck.calibratedAtIso === null) nav.calibrate(deck.id, tags, 'pre-drill');
    else nav.drill(deck.id, tags);
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
    // Export moved to the gear screen (Elena, 2026-08): too rare to merit
    // space next to the daily Drill. Stats went GLOBAL in F10 (Hall of Fame
    // in the header), so the row's only heavy element is the arcade button.
    actions.append(drillControl(deck), gearButton(deck));

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
          startDrill(deck, tags.length > 0 ? tags : undefined);
        }),
      );
      details.appendChild(form);
      li.appendChild(details);
    }

    // F9: settings moved to their own screen behind the gear — no inline
    // Settings disclosure anymore (Save/Recalibrate/Archive live there).

    return li;
  }

  /**
   * F10 (DESIGN.md UI item 1): the row's single heavy element — a convex
   * accent dome *mounted* in a recessed well. The well is what keeps it from
   * reading as a lollipop: the ring is part of the cabinet, the dome sits in
   * it and sinks on press. Still a native <button> whose accessible name is
   * exactly "Drill" (the ALL-CAPS look is `font-variant-caps`, not
   * text-transform, so the accname the smoke test matches stays untouched).
   *
   * Unlit = nothing due and nothing new: a cabinet that's off. Disabled, so
   * an empty session can't burn the deck's once-a-day new-card introduction
   * (B9) either.
   */
  function drillControl(deck: DeckSummary): HTMLElement {
    const unlit = deck.dueCount === 0 && deck.newCount === 0;
    const well = el('div', unlit ? 'drill-well unlit' : 'drill-well');
    const b = el('button', 'drill-button');
    b.type = 'button';
    const label = el('span', 'drill-label');
    label.textContent = 'Drill';
    b.appendChild(label);
    if (unlit) {
      b.disabled = true;
      b.title = 'nothing due right now';
    } else {
      b.title = `drill ${deck.name}`;
      b.addEventListener('click', () => startDrill(deck));
    }
    well.appendChild(b);
    return well;
  }

  /** F9: gear icon at the row's right edge → the deck settings screen.
   *  Drawn inline (no font/emoji dependence); a native button, so keyboard
   *  reachable like everything else on this screen. */
  function gearButton(deck: DeckSummary): HTMLButtonElement {
    const b = el('button', 'gear-button');
    b.type = 'button';
    b.setAttribute('aria-label', 'deck settings');
    b.title = 'deck settings';
    b.innerHTML =
      '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
      '<path fill="currentColor" fill-rule="evenodd" d="M6.8 1h2.4l.3 1.7q.63.18 1.2.5l1.4-1 ' +
      '1.7 1.7-1 1.4q.32.57.5 1.2l1.7.3v2.4l-1.7.3q-.18.63-.5 1.2l1 1.4-1.7 1.7-1.4-1q-.57.32' +
      '-1.2.5l-.3 1.7H6.8l-.3-1.7q-.63-.18-1.2-.5l-1.4 1-1.7-1.7 1-1.4q-.32-.57-.5-1.2L1 9.2V6.8' +
      'l1.7-.3q.18-.63.5-1.2l-1-1.4 1.7-1.7 1.4 1q.57-.32 1.2-.5L6.8 1zm1.2 4.3a2.7 2.7 0 1 0 0 ' +
      '5.4 2.7 2.7 0 0 0 0-5.4z"/></svg>';
    b.addEventListener('click', () => nav.deckSettings(deck.id));
    return b;
  }

  function trophyJar(t: TrophyView): HTMLElement {
    const jar = el('div', 'trophy-jar');
    jar.tabIndex = 0; // hover AND keyboard-focus reveal the label
    const date = new Date(t.endedAtIso);
    jar.title = `${t.deckName} — ${date.toLocaleDateString()} — ${t.size} ${t.size === 1 ? 'prize' : 'prizes'}`;
    // Asset E: prize glyphs sandwiched between mini-jar back and front+lid.
    const glass = el('div', 'trophy-glass');
    for (const prize of t.jar.slice(0, 9)) {
      const s = el('span');
      s.textContent = prize;
      glass.appendChild(s);
    }
    jar.append(
      svgLayer(ASSETS.miniJar, ['mini-back'], { className: 'trophy-mini' }),
      glass,
      svgLayer(ASSETS.miniJar, ['mini-front'], { className: 'trophy-mini' }),
    );
    return jar;
  }

  /** Archived deck row: name, count, archived date, Unarchive, Stats.
   *  Deliberately NO Drill — archived decks are not drillable; history and
   *  shelf trophies remain. */
  function archivedRow(deck: DeckSummary): HTMLElement {
    const li = el('li', 'archived-row');

    const main = el('div', 'deck-main');
    const name = el('span', 'deck-name');
    name.textContent = deck.name;
    const counts = el('span', 'deck-counts');
    const when = deck.archivedAtIso ? new Date(deck.archivedAtIso).toLocaleDateString() : '?';
    counts.textContent = `${deck.cardCount} cards · archived ${when}`;
    main.append(name, counts);

    const actions = el('div', 'deck-actions');
    actions.append(
      button(
        'Unarchive',
        () => {
          void api.decks.unarchive(deck.id).then(() => {
            say(`unarchived “${deck.name}” — back in the active list`);
            void refreshDecks();
          });
        },
        'unarchive-button',
      ),
      // Deep-links into the global hall of fame with this deck preselected.
      button('Stats', () => nav.hallOfFame(deck.id)),
    );

    li.append(main, actions);
    return li;
  }

  async function refreshDecks(): Promise<void> {
    const decks = await api.decks.list();
    const active = decks.filter((d) => d.archivedAtIso === null);
    const archived = decks.filter((d) => d.archivedAtIso !== null);

    list.innerHTML = '';
    if (active.length === 0) {
      const empty = el('li', 'deck-empty');
      empty.textContent =
        archived.length > 0
          ? 'no active decks — unarchive one below, or import a .deckpack'
          : 'no decks yet — import a .deckpack to begin';
      list.appendChild(empty);
    } else {
      for (const deck of active) list.appendChild(deckRow(deck));
    }

    archivedSection.hidden = archived.length === 0;
    archivedSummary.textContent = `Archived (${archived.length})`;
    archivedList.innerHTML = '';
    for (const deck of archived) archivedList.appendChild(archivedRow(deck));
  }

  /** A ten-jar or hundred-jar: the vessel with its contents visible inside. */
  function denomJar(row: DeckShelfRow, jar: DenominationJar): HTMLElement {
    const d = el('div', `denom-jar denom-${jar.denomination}`);
    d.tabIndex = 0; // hover AND keyboard-focus reveal the label
    const first = jar.trophies[0];
    const last = jar.trophies[jar.trophies.length - 1];
    d.title =
      jar.denomination === 10
        ? // Endowment: the ten contained sessions stay enumerable.
          `${row.deckName} — ten perfect sessions: ` +
          jar.trophies.map((t) => `${fmtDay(t.endedAtIso)} (${t.size})`).join(', ')
        : `${row.deckName} — one hundred perfect sessions, ` +
          `${fmtDay(first.endedAtIso)} – ${fmtDay(last.endedAtIso)}`;
    d.appendChild(
      svgLayer(
        ASSETS.miniJar,
        [
          'denom-back',
          'denom-contents',
          'denom-front',
          jar.denomination === 100 ? 'numeral-100' : 'numeral-10',
        ],
        { className: 'denom-svg' },
      ),
    );
    return d;
  }

  interface RowRefs {
    el: HTMLElement;
    newestTen: HTMLElement | null;
    newestHundred: HTMLElement | null;
  }

  /** One deck's odometer row: hundreds → tens → singles, on its own strip. */
  function shelfRow(row: DeckShelfRow): RowRefs {
    const wrap = el('div', 'shelf-row');
    const name = el('span', 'shelf-row-name');
    name.textContent = row.deckName;
    const jars = el('div', 'shelf-row-jars');
    let newestHundred: HTMLElement | null = null;
    let newestTen: HTMLElement | null = null;
    for (const h of row.hundreds) {
      newestHundred = denomJar(row, h);
      jars.appendChild(newestHundred);
    }
    for (const t of row.tens) {
      newestTen = denomJar(row, t);
      jars.appendChild(newestTen);
    }
    for (const t of row.singles) jars.appendChild(trophyJar(t));
    wrap.append(
      name,
      jars,
      svgLayer(ASSETS.miniJar, ['shelf'], { className: 'shelf-strip', stretch: true }),
    );
    return { el: wrap, newestTen, newestHundred };
  }

  let ceremonyTimer: number | undefined;

  /**
   * The tenth-seal ceremony: ten ghost jars pour/slide into the (already
   * rendered) denomination vessel, under the deep consolidation chime.
   * One-shot, unpersisted, transform/opacity only.
   */
  function ceremony(rowEl: HTMLElement, vessel: HTMLElement): void {
    vessel.classList.add('consolidating'); // hidden until the pour lands
    audio.playConsolidationChime();
    const rowRect = rowEl.getBoundingClientRect();
    const vRect = vessel.getBoundingClientRect();
    const toX = vRect.left - rowRect.left + vRect.width / 2;
    const toY = vRect.top - rowRect.top + vRect.height / 2;
    for (let i = 0; i < 10; i++) {
      const ghost = el('div', 'ghost-jar');
      ghost.appendChild(svgLayer(ASSETS.miniJar, ['mini-back', 'mini-front'], {}));
      // Spread the ten along the row, where the singles just stood.
      const fromX = toX + 46 + i * 32;
      const fromY = toY - 8 + (i % 2) * 10;
      rowEl.appendChild(ghost);
      ghost.animate(
        [
          { transform: `translate(${fromX}px, ${fromY}px) translate(-50%, -50%)`, opacity: 0.9 },
          {
            transform: `translate(${toX}px, ${toY}px) translate(-50%, -50%) scale(0.4)`,
            opacity: 0,
          },
        ],
        {
          duration: T.CONSOLIDATE_GHOST_MS,
          delay: i * T.CONSOLIDATE_STAGGER_MS,
          easing: 'cubic-bezier(.5,0,.8,1)',
          fill: 'both',
        },
      ).finished.then(
        () => ghost.remove(),
        () => ghost.remove(),
      );
    }
    const landAt = T.CONSOLIDATE_GHOST_MS + 9 * T.CONSOLIDATE_STAGGER_MS;
    ceremonyTimer = window.setTimeout(() => {
      if (!screen.isConnected) return;
      vessel.classList.remove('consolidating');
      vessel.animate(
        [
          { transform: 'scale(1.14)', opacity: 0 },
          { transform: 'scale(1)', opacity: 1 },
        ],
        { duration: T.CONSOLIDATE_POP_MS, easing: 'cubic-bezier(0,.6,.4,1)' },
      );
    }, landAt);
  }

  async function refreshShelf(): Promise<void> {
    const trophies = await api.stats.trophies();
    const rows = deriveShelf(trophies);
    shelf.innerHTML = '';

    // Detect boundary crossings BEFORE updating the session baseline.
    const events: { deckId: string; denom: 10 | 100 }[] = [];
    for (const row of rows) {
      const prev = lastSeenTrophyCounts.get(row.deckId) ?? 0;
      if (trophyBaselineTaken) {
        const denom = consolidationEvent(prev, row.total);
        if (denom) events.push({ deckId: row.deckId, denom });
      }
      lastSeenTrophyCounts.set(row.deckId, row.total);
    }
    trophyBaselineTaken = true;

    if (rows.length === 0) {
      shelf.appendChild(
        svgLayer(ASSETS.miniJar, ['shelf'], { className: 'shelf-strip', stretch: true }),
      );
      const empty = el('p', 'shelf-empty');
      empty.textContent = 'perfect sessions live here';
      shelf.appendChild(empty);
      return;
    }

    const refs = new Map<string, RowRefs>();
    for (const row of rows) {
      const r = shelfRow(row);
      refs.set(row.deckId, r);
      shelf.appendChild(r.el);
    }

    // At most one ceremony per render (overlapping chimes would mush).
    const ev = events[0];
    if (ev) {
      const r = refs.get(ev.deckId);
      const vessel = ev.denom === 100 ? r?.newestHundred : r?.newestTen;
      if (r && vessel) ceremony(r.el, vessel);
    }
  }

  await Promise.all([refreshDecks(), refreshShelf()]);

  return () => {
    if (ceremonyTimer !== undefined) window.clearTimeout(ceremonyTimer);
    screen.remove();
  };
}
