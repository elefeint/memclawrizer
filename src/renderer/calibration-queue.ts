/**
 * Pure trial-queue logic for the calibration screen (F8), kept out of the DOM
 * layer so it can be unit-tested with plain data (same pattern as
 * drill-machine.ts). The screen owns timing (performance.now) and rendering;
 * this module owns ordering, re-queueing, and the attempt log.
 *
 * Semantics (DESIGN.md "Timer calibration"): every attempt is logged; a
 * mistyped trial (per shared isCorrect against the shown text) goes back to
 * the END of the queue and repeats until copied cleanly. The backend/mock
 * excludes mistypes from the floor — this module just never drops data.
 */
import type { CalibrationTrialResult } from '../shared/api';
import { isCorrect } from '../shared/normalize';

export interface CalibrationTrial {
  cardId: string;
  text: string;
}

export interface CalibrationQueue {
  /** Head is the current trial; empty = done. */
  pending: readonly CalibrationTrial[];
  /** EVERY attempt in order, clean and mistyped alike — the submit batch. */
  attempts: readonly CalibrationTrialResult[];
  /** Distinct trials handed out by calibration.start — the dot count. */
  total: number;
  /** Trials copied cleanly so far — the filled-dot count. */
  cleared: number;
}

export function initQueue(trials: readonly CalibrationTrial[]): CalibrationQueue {
  return { pending: [...trials], attempts: [], total: trials.length, cleared: 0 };
}

export const currentTrial = (q: CalibrationQueue): CalibrationTrial | null => q.pending[0] ?? null;

export const isDone = (q: CalibrationQueue): boolean => q.pending.length === 0;

/**
 * Record one Enter press on the current trial. Clean copy → trial cleared;
 * mistype → logged and re-queued to the end.
 */
export function submitTrial(
  q: CalibrationQueue,
  response: string,
  elapsedMs: number,
): CalibrationQueue {
  const trial = q.pending[0];
  if (!trial) return q;
  const clean = isCorrect(response, [trial.text]);
  return {
    pending: clean ? q.pending.slice(1) : [...q.pending.slice(1), trial],
    attempts: [
      ...q.attempts,
      { cardId: trial.cardId, text: trial.text, response, elapsedMs: Math.round(elapsedMs) },
    ],
    total: q.total,
    cleared: q.cleared + (clean ? 1 : 0),
  };
}
