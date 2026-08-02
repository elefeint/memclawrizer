/**
 * Deck settings screen (F9) — everything that used to live in the deck row's
 * inline Settings disclosure, behind the gear icon at the row's right edge
 * (DESIGN.md UI item 1b): base timer, new cards/session, box-1 gate,
 * thinking room, Save, Recalibrate, Archive. Back (top-left) and Escape
 * return to the home overview; Save and Archive return announcing via the
 * home status line (mountHome's announce arg from F8).
 */
import { api } from '../api';
import type { DeckSettings } from '../../shared/api';
import type { Nav } from './drill';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function numberField(
  label: string,
  value: number,
  opts: { min?: string; step?: string; title?: string } = {},
): { wrap: HTMLLabelElement; input: HTMLInputElement } {
  const wrap = el('label', 'settings-field');
  wrap.append(document.createTextNode(label + ' '));
  const input = el('input');
  input.type = 'number';
  if (opts.min !== undefined) input.min = opts.min;
  if (opts.step !== undefined) input.step = opts.step;
  input.value = String(value);
  if (opts.title) wrap.title = opts.title;
  wrap.appendChild(input);
  return { wrap, input };
}

export async function mountDeckSettings(
  root: HTMLElement,
  deckId: string,
  nav: Nav,
): Promise<() => void> {
  const deck = (await api.decks.list()).find((d) => d.id === deckId);
  if (!deck) {
    // Deck vanished under us (e.g. removed elsewhere) — nothing to edit.
    nav.home('deck not found');
    return () => undefined;
  }

  const screen = el('div', 'settings-screen');

  const header = el('header', 'settings-header');
  const back = button('← Back', () => nav.home(), 'back-button');
  back.setAttribute('aria-label', 'back to deck list');
  const heading = el('div', 'settings-heading');
  const title = el('h1');
  title.textContent = deck.name;
  const context = el('p', 'settings-context');
  const calibrated = deck.calibratedAtIso
    ? `calibrated ${new Date(deck.calibratedAtIso).toLocaleDateString()}`
    : 'not calibrated yet';
  context.textContent = `${deck.cardCount} ${deck.cardCount === 1 ? 'card' : 'cards'} · ${calibrated}`;
  heading.append(title, context);
  header.append(back, heading);
  screen.appendChild(header);

  const form = el('div', 'settings-form');

  const timer = numberField('base timer (ms)', deck.settings.baseTimerMs, {
    min: '1000',
    step: '500',
  });
  const newCards = numberField('new cards / session', deck.settings.newCardsPerSession, {
    min: '0',
  });
  const gate = numberField('pause new cards at box-1 ≥', deck.settings.maxBox1ForNew, {
    min: '1',
    title:
      'No new cards are introduced while this many cards sit in box 1 (struggling). ' +
      'Below that, new cards fill only the remaining capacity.',
  });
  const allowance = numberField('thinking room (ms)', deck.settings.retrievalAllowanceMs, {
    min: '500',
    step: '100',
    title:
      'Added to your measured typing floor to form the box-1 window. ' +
      'Tight for calculable material (music notes) so only recall fits; ' +
      'looser where there is nothing to calculate (kana). ' +
      'Takes effect on the next (re)calibration.',
  });
  form.append(timer.wrap, newCards.wrap, gate.wrap, allowance.wrap);

  const actions = el('div', 'settings-actions');
  actions.append(
    button('Save', () => {
      const settings: DeckSettings = {
        baseTimerMs: Math.max(1000, Number(timer.input.value) || deck.settings.baseTimerMs),
        newCardsPerSession: Math.max(0, Number(newCards.input.value) || 0),
        maxBox1ForNew: Math.max(1, Number(gate.input.value) || deck.settings.maxBox1ForNew),
        retrievalAllowanceMs: Math.max(
          500,
          Number(allowance.input.value) || deck.settings.retrievalAllowanceMs,
        ),
      };
      void api.decks.updateSettings(deck.id, settings).then(() => {
        nav.home(`saved settings for “${deck.name}”`);
      });
    }),
    // F8: re-run the copy-typing warm-up (fingers change, keyboards change).
    // Returns home afterwards with the result announced.
    button(
      'Recalibrate timer',
      () => nav.calibrate(deck.id, undefined, 'recalibrate'),
      'recalibrate-button',
    ),
    // Export lives here rather than on the deck row (Elena, 2026-08): it's a
    // rare data-liberation action — writes a content-only .deckpack (cards,
    // media, current settings; no learning state) via a native save dialog.
    button('Export deck…', () => {
      void api.decks.export(deck.id).then((path) => {
        if (path !== null) nav.home(`exported “${deck.name}” to ${path}`);
      });
    }),
    // Archive is already two clicks from the drill flow (gear → here) and
    // reversible (Unarchive in the home's Archived section) — no confirm.
    button(
      'Archive deck',
      () => {
        void api.decks.archive(deck.id).then(() => {
          nav.home(`archived “${deck.name}” — find it under Archived below`);
        });
      },
      'archive-button',
    ),
  );

  screen.append(form, actions);
  root.appendChild(screen);
  back.focus();

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      nav.home();
    }
  };
  window.addEventListener('keydown', onKeydown);

  return () => {
    window.removeEventListener('keydown', onKeydown);
    screen.remove();
  };
}
