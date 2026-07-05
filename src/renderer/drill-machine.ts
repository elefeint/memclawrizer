/**
 * drill-machine.ts — the pure drill-session state machine (Frontend F1).
 *
 * No DOM, no timers, no audio. The DOM layer feeds events in and executes the
 * returned effects (which are plain data, never functions). Time enters only
 * through TICK(nowMs); randomness only through the injected rng in MachineDeps.
 * The machine — not the DOM — decides when the timer has expired: a TICK at or
 * past the deadline produces a timeout submit (timedOut=true, elapsedMs=timerMs,
 * response = whatever was typed, carried on TICK.inputText).
 *
 * Phase map (happy path left to right):
 *
 *   idle --START--> presenting --SUBMIT/timeout-TICK--> awaitingResult
 *     awaitingResult --RESULT correct+first-->  grab      (claw grab-and-carry)
 *     awaitingResult --RESULT correct+retry-->  slip      (prize slips, no jar change)
 *     awaitingResult --RESULT wrong/timeout-->  feedback  (pebble if first attempt)
 *   grab/slip/feedback --ANIMATION_DONE--> presenting (next card)
 *                                      or --> sealing  (perfect session end)
 *                                      or --> emptying (imperfect session end)
 *   sealing/emptying --ANIMATION_DONE--> done (sessionComplete effect)
 *   any active phase --ABORT--> aborting --ANIMATION_DONE--> aborted
 */
import type {
  AnswerRequest,
  AnswerResult,
  CardView,
  SessionEnd,
  SessionStart,
} from '../shared/api';

// ---------------------------------------------------------------------------
// Game-feel constants (named so docs/verify.md tuning sessions can adjust them)
// ---------------------------------------------------------------------------

/** Kitchen-timer tick cadence for the first ~75% of the countdown. */
export const TICK_INTERVAL_BASE_MS = 500;
/** Tick cadence reached right at the deadline (the panic rate). */
export const TICK_INTERVAL_MIN_MS = 130;
/** Fraction of the countdown after which the tick starts accelerating. */
export const TICK_ACCEL_START = 0.75;

/** Interval between tick sounds at a given countdown progress (0..1). */
export function tickIntervalAt(progress: number): number {
  if (progress <= TICK_ACCEL_START) return TICK_INTERVAL_BASE_MS;
  const t = Math.min(1, (progress - TICK_ACCEL_START) / (1 - TICK_ACCEL_START));
  return TICK_INTERVAL_BASE_MS + (TICK_INTERVAL_MIN_MS - TICK_INTERVAL_BASE_MS) * t;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DrillPhase =
  | 'idle'
  | 'presenting'
  | 'awaitingResult'
  | 'grab'
  | 'slip'
  | 'feedback'
  | 'sealing'
  | 'emptying'
  | 'aborting'
  | 'done'
  | 'aborted';

export type JarSlot =
  | { kind: 'empty' }
  | { kind: 'prize'; prize: string }
  | { kind: 'pebble' };

export interface DrillState {
  phase: DrillPhase;
  sessionId: string | null;
  queueLength: number;
  /** Cards still to clear, including re-queued ones (from AnswerResult). */
  remaining: number;
  /** Renderer-side view of the jar as it fills; source of truth is main. */
  slots: JarSlot[];
  /** Card being presented / answered / animated about. */
  card: CardView | null;
  /** nowMs of the first TICK after presentation began; null until then. */
  presentedAtMs: number | null;
  deadlineMs: number | null;
  lastTickSoundMs: number | null;
  /** Last TICK's nowMs — the machine's only clock. */
  nowMs: number;
  /** Live input text (mirrored via TICK.inputText) for timeout submits. */
  draftText: string;
  /** Prize picked at submit time; confirmed into the jar on a correct RESULT. */
  pendingPrize: string | null;
  /** Card to present after the current animation finishes. */
  pendingNext: CardView | null;
  sessionEnd: SessionEnd | null;
}

export type DrillEvent =
  | { type: 'START'; session: SessionStart }
  | { type: 'TICK'; nowMs: number; inputText?: string }
  | { type: 'SUBMIT'; text: string }
  | { type: 'RESULT'; result: AnswerResult }
  | { type: 'ANIMATION_DONE' }
  | { type: 'ABORT' };

export type Effect =
  | { type: 'startTimer'; ms: number }
  | { type: 'playTick'; rate: number }
  | { type: 'playDing' }
  | { type: 'playSuccessChirp' }
  | { type: 'playSealChime' }
  | { type: 'animateGrab'; slotIndex: number; prize: string }
  | { type: 'animateSlip'; slotIndex: number }
  | { type: 'animatePebble'; slotIndex: number }
  | { type: 'animateSeal'; jar: (string | null)[] }
  | { type: 'animateEmpty'; jar: (string | null)[] }
  | { type: 'showFeedback'; expected: string[]; hint: string | null }
  | { type: 'submitAnswer'; req: AnswerRequest }
  | { type: 'sessionComplete'; end: SessionEnd }
  /** DOM layer must call api.session.abort(sessionId). */
  | { type: 'abortSession' };

export interface MachineDeps {
  /** Uniform [0,1) — Math.random in the app, seeded/fixed in tests. */
  rng: () => number;
  /** Weighted by repetition: common trinkets appear many times, oddities once. */
  prizePool: readonly string[];
}

export interface ReduceResult {
  state: DrillState;
  effects: Effect[];
}

export const initialState: DrillState = {
  phase: 'idle',
  sessionId: null,
  queueLength: 0,
  remaining: 0,
  slots: [],
  card: null,
  presentedAtMs: null,
  deadlineMs: null,
  lastTickSoundMs: null,
  nowMs: 0,
  draftText: '',
  pendingPrize: null,
  pendingNext: null,
  sessionEnd: null,
};

export function pickPrize(rng: () => number, pool: readonly string[]): string {
  const i = Math.floor(rng() * pool.length);
  return pool[Math.min(Math.max(i, 0), pool.length - 1)];
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

const ACTIVE_PHASES: readonly DrillPhase[] = [
  'presenting',
  'awaitingResult',
  'grab',
  'slip',
  'feedback',
];

export function reduce(state: DrillState, event: DrillEvent, deps: MachineDeps): ReduceResult {
  const noop: ReduceResult = { state, effects: [] };

  switch (event.type) {
    case 'START': {
      const { session } = event;
      if (!session.first) {
        // Nothing due and no new cards: no session to run.
        return {
          state: { ...initialState, phase: 'done', sessionId: session.sessionId },
          effects: [],
        };
      }
      return {
        state: {
          ...initialState,
          phase: 'presenting',
          sessionId: session.sessionId,
          queueLength: session.queueLength,
          remaining: session.queueLength,
          slots: Array.from({ length: session.queueLength }, () => ({ kind: 'empty' as const })),
          card: session.first,
        },
        effects: [{ type: 'startTimer', ms: session.first.timerMs }],
      };
    }

    case 'TICK': {
      if (state.phase !== 'presenting' || !state.card) {
        return { state: { ...state, nowMs: event.nowMs }, effects: [] };
      }
      const draftText = event.inputText ?? state.draftText;

      // First TICK after presentation arms the deadline and plays tick #1.
      if (state.presentedAtMs === null) {
        return {
          state: {
            ...state,
            nowMs: event.nowMs,
            draftText,
            presentedAtMs: event.nowMs,
            deadlineMs: event.nowMs + state.card.timerMs,
            lastTickSoundMs: event.nowMs,
          },
          effects: [{ type: 'playTick', rate: 1 }],
        };
      }

      // Deadline passed → the machine submits a timeout.
      if (event.nowMs >= (state.deadlineMs ?? Infinity)) {
        const req: AnswerRequest = {
          cardId: state.card.cardId,
          response: draftText,
          elapsedMs: state.card.timerMs,
          timedOut: true,
          prize: null,
        };
        return {
          state: {
            ...state,
            nowMs: event.nowMs,
            draftText,
            phase: 'awaitingResult',
            pendingPrize: null,
          },
          effects: [{ type: 'playDing' }, { type: 'submitAnswer', req }],
        };
      }

      // Tick-sound scheduling, accelerating over the final stretch.
      const progress = (event.nowMs - state.presentedAtMs) / state.card.timerMs;
      const interval = tickIntervalAt(progress);
      const effects: Effect[] = [];
      let lastTickSoundMs = state.lastTickSoundMs;
      if (event.nowMs - (lastTickSoundMs ?? -Infinity) >= interval) {
        effects.push({ type: 'playTick', rate: TICK_INTERVAL_BASE_MS / interval });
        lastTickSoundMs = event.nowMs;
      }
      return {
        state: { ...state, nowMs: event.nowMs, draftText, lastTickSoundMs },
        effects,
      };
    }

    case 'SUBMIT': {
      if (state.phase !== 'presenting' || !state.card) return noop;
      // Ignore accidental empty Enter; waiting out the timer is the give-up path.
      if (event.text.trim() === '') return noop;
      const elapsedRaw =
        state.presentedAtMs === null ? 0 : state.nowMs - state.presentedAtMs;
      const elapsedMs = Math.max(0, Math.min(Math.round(elapsedRaw), state.card.timerMs));
      // Retry cards never earn a prize (the slip); first-timers pick one now.
      const prize = state.card.isRetry ? null : pickPrize(deps.rng, deps.prizePool);
      const req: AnswerRequest = {
        cardId: state.card.cardId,
        response: event.text,
        elapsedMs,
        timedOut: false,
        prize,
      };
      return {
        state: { ...state, phase: 'awaitingResult', draftText: event.text, pendingPrize: prize },
        effects: [{ type: 'submitAnswer', req }],
      };
    }

    case 'RESULT': {
      if (state.phase !== 'awaitingResult' || !state.card) return noop;
      const r = event.result;
      const slots = [...state.slots];
      const effects: Effect[] = [];
      let phase: DrillPhase;

      if (r.outcome === 'correct') {
        effects.push({ type: 'playSuccessChirp' });
        if (r.isFirstOfSession) {
          const prize = state.pendingPrize ?? '🎁';
          slots[r.slotIndex] = { kind: 'prize', prize };
          phase = 'grab';
          effects.push({ type: 'animateGrab', slotIndex: r.slotIndex, prize });
        } else {
          // Retry success: acknowledged, but the prize slips from the claw.
          phase = 'slip';
          effects.push({ type: 'animateSlip', slotIndex: r.slotIndex });
        }
      } else {
        phase = 'feedback';
        if (r.isFirstOfSession) {
          slots[r.slotIndex] = { kind: 'pebble' };
          effects.push({ type: 'animatePebble', slotIndex: r.slotIndex });
        }
        effects.push({ type: 'showFeedback', expected: r.expected ?? [], hint: r.hint });
      }

      return {
        state: {
          ...state,
          phase,
          slots,
          remaining: r.remaining,
          pendingNext: r.next,
          sessionEnd: r.sessionEnd,
          pendingPrize: null,
        },
        effects,
      };
    }

    case 'ANIMATION_DONE': {
      switch (state.phase) {
        case 'grab':
        case 'slip':
        case 'feedback': {
          if (state.pendingNext) {
            const card = state.pendingNext;
            return {
              state: {
                ...state,
                phase: 'presenting',
                card,
                presentedAtMs: null,
                deadlineMs: null,
                lastTickSoundMs: null,
                draftText: '',
                pendingNext: null,
              },
              effects: [{ type: 'startTimer', ms: card.timerMs }],
            };
          }
          const end = state.sessionEnd;
          if (!end) {
            // Contract promises sessionEnd exactly when next is null; be safe.
            return { state: { ...state, phase: 'done', card: null }, effects: [] };
          }
          if (end.perfect) {
            return {
              state: { ...state, phase: 'sealing', card: null },
              effects: [{ type: 'playSealChime' }, { type: 'animateSeal', jar: end.jar }],
            };
          }
          return {
            state: { ...state, phase: 'emptying', card: null },
            effects: [{ type: 'animateEmpty', jar: end.jar }],
          };
        }
        case 'sealing':
        case 'emptying': {
          const end = state.sessionEnd;
          return {
            state: { ...state, phase: 'done' },
            effects: end ? [{ type: 'sessionComplete', end }] : [],
          };
        }
        case 'aborting':
          return { state: { ...state, phase: 'aborted' }, effects: [] };
        default:
          return noop;
      }
    }

    case 'ABORT': {
      if (!ACTIVE_PHASES.includes(state.phase)) return noop;
      const jar = state.slots.map((s) => (s.kind === 'prize' ? s.prize : null));
      return {
        state: { ...state, phase: 'aborting', card: null, pendingNext: null },
        effects: [{ type: 'abortSession' }, { type: 'animateEmpty', jar }],
      };
    }
  }
}
