/**
 * Calibration screen (F8) — the copy-typing warm-up that measures the
 * motor+perception floor (DESIGN.md "Timer calibration"). Deliberately
 * UNLIKE the drill: no claw, no timer, no sounds, calm. The user copies the
 * shown answer text; elapsed is measured from trial display to Enter with
 * performance.now(). Mistyped trials re-queue to the end (every attempt is
 * logged in the submit batch — the backend/mock excludes mistypes from the
 * floor). Esc skips: calibration.abort, then proceed without changing
 * anything (a pre-drill run is re-offered next time).
 *
 * Queue/attempt-log logic lives in ../calibration-queue (pure, unit-tested);
 * this module owns timing and DOM only.
 */
import { api } from '../api';
import {
  currentTrial,
  initQueue,
  isDone,
  submitTrial,
  type CalibrationQueue,
} from '../calibration-queue';
import * as T from '../timings';
import type { Nav } from './drill';

export type CalibrateMode = 'pre-drill' | 'recalibrate';

const fmtSec = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

export async function mountCalibrate(
  root: HTMLElement,
  deckId: string,
  tags: string[] | undefined,
  mode: CalibrateMode,
  nav: Nav,
): Promise<() => void> {
  const screen = el('div', 'calibrate');

  const header = el('header', 'calibrate-header');
  const title = el('h1');
  title.textContent = 'warm-up: type what you see';
  const sub = el('p', 'calibrate-sub');
  sub.textContent = 'measuring your typing speed, not your memory';
  header.append(title, sub);

  const dots = el('div', 'calibrate-dots');
  const text = el('div', 'calibrate-text');
  const input = el('input', 'calibrate-input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'copy the text shown above');

  const note = el('p', 'calibrate-note');
  note.hidden = true;

  const result = el('p', 'calibrate-result');
  result.hidden = true;

  const skipHint = el('p', 'calibrate-skip-hint');
  skipHint.textContent = 'Esc to skip';

  screen.append(header, dots, text, input, note, result, skipHint);
  root.appendChild(screen);

  // ------------------------------------------------------------- state ----
  const started = await api.calibration.start(deckId);
  let queue: CalibrationQueue = initQueue(started.trials);
  let shownAt = 0;
  let finished = false; // submit/abort sent; ignore further input
  let exitTimer: number | undefined;

  function proceed(announce?: string): void {
    if (mode === 'pre-drill') nav.drill(deckId, tags);
    else nav.home(announce);
  }

  function renderDots(): void {
    dots.innerHTML = '';
    for (let i = 0; i < queue.total; i++) {
      dots.appendChild(el('span', i < queue.cleared ? 'dot done' : 'dot'));
    }
  }

  function showTrial(): void {
    const trial = currentTrial(queue);
    if (!trial) return;
    renderDots();
    text.textContent = trial.text;
    input.value = '';
    input.focus();
    shownAt = performance.now();
  }

  async function finish(): Promise<void> {
    finished = true;
    input.value = '';
    input.disabled = true;
    note.hidden = true;
    renderDots();
    const r = await api.calibration.submit(started.sessionId, [...queue.attempts]);
    if (!screen.isConnected) return;
    text.textContent = '';
    const line = r.appliedToSettings
      ? `your floor: ${fmtSec(r.floorMs)} → base timer set to ${fmtSec(r.suggestedBaseTimerMs)}`
      : 'too few clean trials to measure a floor — settings unchanged';
    result.textContent = line;
    result.hidden = false;
    // Show the result plainly for a beat, then continue automatically.
    exitTimer = window.setTimeout(() => {
      proceed(
        mode === 'recalibrate'
          ? r.appliedToSettings
            ? `recalibrated: ${line}`
            : `recalibration finished: ${line}`
          : undefined,
      );
    }, T.CALIBRATE_RESULT_MS);
  }

  function onEnter(): void {
    const elapsedMs = performance.now() - shownAt;
    const before = queue;
    queue = submitTrial(queue, input.value, elapsedMs);
    const mistyped = queue.cleared === before.cleared;
    note.hidden = !mistyped;
    if (mistyped) note.textContent = 'not quite — it will come round again';
    if (isDone(queue)) void finish();
    else showTrial();
  }

  function skip(): void {
    finished = true;
    void api.calibration.abort(started.sessionId).then(() => {
      proceed('calibration skipped — settings unchanged');
    });
  }

  const onKeydown = (e: KeyboardEvent): void => {
    if (finished) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      skip();
    } else if (e.key === 'Enter' && document.activeElement === input) {
      e.preventDefault();
      onEnter();
    }
  };
  window.addEventListener('keydown', onKeydown);

  if (isDone(queue)) {
    // Deck with no cards: nothing to measure; behave like a skip.
    skip();
  } else {
    showTrial();
  }

  return () => {
    window.removeEventListener('keydown', onKeydown);
    if (exitTimer !== undefined) window.clearTimeout(exitTimer);
    screen.remove();
  };
}
