/**
 * Copy-typing timer calibration (DESIGN.md "Timer calibration"; the mock in
 * src/renderer/mock-api.ts is the executable spec of the math — this must
 * mirror it exactly).
 *
 * The deadline must sit above the motor+retrieval floor and below the
 * algorithm's completion time (Logan's race model): trials show the deck's
 * canonical ANSWERS and the user just types them, yielding the
 * motor+perception floor for that answer format. Not Leitner by definition:
 * no card_state writes, no box movement; trials land in the audit log as
 * outcome='calibration' inside a sessions row with kind='calibration'.
 *
 * No Electron imports; now/rng/uuid injected for tests.
 */
import type { DuckDBConnection } from '@duckdb/node-api';
import type {
  CalibrationResult,
  CalibrationStart,
  CalibrationTrialResult,
  DeckSettings,
} from '../shared/api';
import { isCorrect } from '../shared/normalize';
import {
  closeCalibrationSession,
  getCardState,
  getDeck,
  insertAttempt,
  insertSession,
  listCards,
  updateDeckSettings,
} from './queries';
import type { SessionDeps } from './sessions';

/** Trials per run; smaller decks use every card. */
export const CALIBRATION_TRIALS = 10;
/** Box-1 timer multiplier the window is divided by. */
const BOX1_MULTIPLIER = 1.5;
/** Fewer correct trials than this → suggestion not applied. */
export const MIN_CORRECT_TRIALS = 3;
/** Sanity clamp for a single copy-typing trial's elapsed time. */
const MAX_TRIAL_MS = 60_000;

interface ActiveCalibration {
  deckId: string;
  settings: DeckSettings;
}

/** Median of a non-empty sorted-ascending array, mock-style rounding. */
function medianOf(sortedMs: number[]): number {
  const n = sortedMs.length;
  return n % 2 === 1
    ? sortedMs[(n - 1) / 2]
    : Math.round((sortedMs[n / 2 - 1] + sortedMs[n / 2]) / 2);
}

/**
 * floor + the deck's retrieval allowance (contract #5: a per-deck domain
 * fact — tight for calculable material), ÷ box-1 multiplier, to 100 ms,
 * clamped [1500, 10000].
 */
export function suggestBaseTimerMs(floorMs: number, allowanceMs: number): number {
  return Math.min(
    10_000,
    Math.max(1500, Math.round((floorMs + allowanceMs) / BOX1_MULTIPLIER / 100) * 100),
  );
}

export class CalibrationManager {
  private readonly active = new Map<string, ActiveCalibration>();
  private readonly now: () => Date;
  private readonly rng: () => number;
  private readonly uuid: () => string;

  constructor(
    private readonly conn: DuckDBConnection,
    deps: SessionDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date());
    this.rng = deps.rng ?? Math.random;
    this.uuid = deps.uuid ?? (() => crypto.randomUUID());
  }

  async start(deckId: string): Promise<CalibrationStart> {
    const deck = await getDeck(this.conn, deckId);
    if (deck === null) throw new Error(`unknown deck ${deckId}`);
    if (deck.archivedAtMs !== null) {
      throw new Error(`deck "${deck.name}" is archived — unarchive it to calibrate`);
    }
    const cards = await listCards(this.conn, deckId, { activeOnly: true });
    if (cards.length === 0) throw new Error(`deck "${deck.name}" has no cards to calibrate`);

    // Sample ~10 cards with the injected rng (Fisher–Yates prefix).
    const pool = [...cards];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const sampled = pool.slice(0, Math.min(CALIBRATION_TRIALS, pool.length));

    const id = this.uuid();
    await insertSession(this.conn, {
      id,
      deckId,
      startedAtMs: this.now().getTime(),
      tagFilter: null,
      settings: deck.settings,
      kind: 'calibration',
    });
    this.active.set(id, { deckId, settings: deck.settings });

    return {
      sessionId: id,
      trials: sampled.map((c) => ({ cardId: c.id, text: c.answers[0] })),
    };
  }

  async submit(
    sessionId: string,
    trials: CalibrationTrialResult[],
  ): Promise<CalibrationResult> {
    const cal = this.active.get(sessionId);
    if (cal === undefined) throw new Error(`no active calibration ${sessionId}`);
    this.active.delete(sessionId);
    const now = this.now();

    // Audit-everything: each trial is one attempts row, but Leitner is
    // untouched (box_before = box_after, no card_state writes).
    for (const trial of trials) {
      const elapsedMs = Math.min(Math.max(0, Math.round(trial.elapsedMs)), MAX_TRIAL_MS);
      const box = (await getCardState(this.conn, cal.deckId, trial.cardId))?.box ?? 1;
      await insertAttempt(this.conn, {
        sessionId,
        deckId: cal.deckId,
        cardId: trial.cardId,
        shownAtMs: now.getTime() - elapsedMs,
        timerMs: 0,
        elapsedMs,
        response: trial.response,
        outcome: 'calibration',
        isFirstOfSession: false,
        boxBefore: box,
        boxAfter: box,
      });
    }

    // Mirror of the mock's math (the executable spec).
    const ok = trials
      .filter((t) => isCorrect(t.response, [t.text]))
      .map((t) => Math.min(Math.max(0, Math.round(t.elapsedMs)), MAX_TRIAL_MS))
      .sort((a, b) => a - b);
    const floorMs = ok.length === 0 ? 0 : medianOf(ok);
    const appliedToSettings = ok.length >= MIN_CORRECT_TRIALS;
    // Re-read: settings (incl. the allowance) may have been hand-edited
    // since start; fall back to the frozen ones if the deck vanished.
    const deck = await getDeck(this.conn, cal.deckId);
    const allowanceMs = (deck ?? { settings: cal.settings }).settings.retrievalAllowanceMs;
    const suggestedBaseTimerMs = suggestBaseTimerMs(floorMs, allowanceMs);

    if (appliedToSettings) {
      if (deck !== null) {
        await updateDeckSettings(this.conn, cal.deckId, {
          ...deck.settings,
          baseTimerMs: suggestedBaseTimerMs,
        });
      }
      // Only applied runs get ended_at — calibratedAtIso is the latest one.
      await closeCalibrationSession(this.conn, sessionId, now.getTime());
    }

    return { floorMs, suggestedBaseTimerMs, appliedToSettings };
  }

  /** Discard: the sessions row stays for the audit trail, ended_at stays
   *  NULL so it never counts as a calibration. */
  async abort(sessionId: string): Promise<void> {
    this.active.delete(sessionId);
  }
}
