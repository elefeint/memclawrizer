/**
 * Leitner scheduling — pure functions, no I/O, no Electron, no DB.
 * `now` and `rng` are always injected (DESIGN.md design-for-test rules);
 * nothing in here may call Date.now() or Math.random().
 */
import type { DeckSettings, Outcome } from '../shared/api';
import { isCorrect } from '../shared/normalize';
import type { CardRow, CardStateRow } from './queries';

export const MAX_BOX = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Interval before a card is due again after landing in a box.
 * Box 1 is always due — interval 0 keeps the due-comparison uniform.
 */
export function intervalMsFor(box: number): number {
  switch (box) {
    case 1:
      return 0;
    case 2:
      return 1 * DAY_MS;
    case 3:
      return 3 * DAY_MS;
    case 4:
      return 7 * DAY_MS;
    case 5:
      return 30 * DAY_MS;
    default:
      throw new Error(`invalid Leitner box ${box}`);
  }
}

/** Higher boxes get tighter timers — mastery is speed, not just recall. */
export function timerFor(baseTimerMs: number, box: number): number {
  const multipliers: Record<number, number> = { 1: 1.5, 2: 1.25, 3: 1.0, 4: 0.85, 5: 0.7 };
  const m = multipliers[box];
  if (m === undefined) throw new Error(`invalid Leitner box ${box}`);
  return Math.round(baseTimerMs * m);
}

/** State for a card that has never been drilled. */
export function newCardState(deckId: string, cardId: string): CardStateRow {
  return {
    deckId,
    cardId,
    box: 1,
    dueAtMs: null,
    lastSuccessAtMs: null,
    lastSeenAtMs: null,
    lifetimeCorrect: 0,
    lifetimeWrong: 0,
  };
}

/** Timeout wins over content; otherwise normalize-and-match (no fuzz). */
export function evaluateOutcome(
  response: string,
  answers: string[],
  timedOut: boolean,
): Outcome {
  if (timedOut) return 'timeout';
  return isCorrect(response, answers) ? 'correct' : 'wrong';
}

/**
 * First attempts move boxes; retries are practice and leave the scheduling
 * state untouched (they are still logged in `attempts` by the caller).
 */
export function applyOutcome(
  state: CardStateRow,
  outcome: Outcome,
  isFirstOfSession: boolean,
  now: Date,
): CardStateRow {
  if (!isFirstOfSession) return state;
  const nowMs = now.getTime();
  if (outcome === 'correct') {
    const box = Math.min(state.box + 1, MAX_BOX);
    return {
      ...state,
      box,
      dueAtMs: nowMs + intervalMsFor(box),
      lastSuccessAtMs: nowMs,
      lastSeenAtMs: nowMs,
      lifetimeCorrect: state.lifetimeCorrect + 1,
    };
  }
  // wrong or timeout: classic Leitner reset to box 1 (always due again).
  return {
    ...state,
    box: 1,
    dueAtMs: nowMs,
    lastSeenAtMs: nowMs,
    lifetimeWrong: state.lifetimeWrong + 1,
  };
}

export interface QueueCard {
  card: CardRow;
  /** Box the card sits in when the session starts (new cards: 1). */
  box: number;
  /** True when the card has never been drilled (no state row). */
  isNew: boolean;
}

function isDue(state: CardStateRow, nowMs: number): boolean {
  if (state.box <= 1) return true; // box 1 is always due
  return state.dueAtMs !== null && state.dueAtMs <= nowMs;
}

function matchesFilter(card: CardRow, tagFilter: string[] | null): boolean {
  if (tagFilter === null || tagFilter.length === 0) return true;
  return card.tags.some((t) => tagFilter.includes(t));
}

/** In-place Fisher–Yates with the injected rng. */
function shuffle<T>(a: T[], rng: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * All due cards (per Leitner intervals) plus never-seen cards (taken in the
 * stable order of `cards`), shuffled together. New-card introduction is
 * double-gated: at most newCardsPerSession, AND only up to the remaining
 * box-1 capacity (settings.maxBox1ForNew minus the box-1 cards already due
 * in this scope) — no new material while the struggling set is full.
 */
export function buildSessionQueue(
  states: CardStateRow[],
  cards: CardRow[],
  settings: DeckSettings,
  tagFilter: string[] | null,
  now: Date,
  rng: () => number,
): QueueCard[] {
  const nowMs = now.getTime();
  const stateByCard = new Map(states.map((s) => [s.cardId, s]));
  const queue: QueueCard[] = [];
  const fresh: CardRow[] = [];

  for (const card of cards) {
    if (!card.active || !matchesFilter(card, tagFilter)) continue;
    const state = stateByCard.get(card.id);
    if (state === undefined) {
      fresh.push(card);
    } else if (isDue(state, nowMs)) {
      queue.push({ card, box: state.box, isNew: false });
    }
  }

  const box1Count = queue.filter((q) => q.box === 1).length;
  const capacity = Math.max(0, settings.maxBox1ForNew - box1Count);
  const newAllowed = Math.min(Math.max(0, settings.newCardsPerSession), capacity);
  for (const card of fresh.slice(0, newAllowed)) {
    queue.push({ card, box: 1, isNew: true });
  }

  return shuffle(queue, rng);
}
