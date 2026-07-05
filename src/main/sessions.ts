/**
 * Drill sessions — the queue lives HERE, in main (single source of truth;
 * the renderer can't lose it on a reload). Semantics mirror the executable
 * spec in src/renderer/mock-api.ts exactly:
 *  - only the FIRST attempt on a card per session decides its jar slot and
 *    moves its Leitner box;
 *  - wrong/timeout re-queues the card ~3 positions later with isRetry=true;
 *  - a session is perfect when every jar slot holds a prize.
 *
 * No Electron imports; `now`, `rng` and `uuid` are injected for tests.
 */
import type { DuckDBConnection } from '@duckdb/node-api';
import type {
  AnswerRequest,
  AnswerResult,
  CardView,
  DeckSettings,
  Outcome,
  SessionStart,
} from '../shared/api';
import {
  applyOutcome,
  buildSessionQueue,
  evaluateOutcome,
  newCardState,
  timerFor,
} from './leitner';
import type { CardRow, CardStateRow } from './queries';
import {
  endSession,
  getDeck,
  insertAttempt,
  insertSession,
  listCards,
  listCardStates,
  upsertCardState,
} from './queries';

/** How far back in the queue a failed card returns (mock: min(3, length)). */
const REQUEUE_DISTANCE = 3;

interface QueueEntry {
  card: CardRow;
  slotIndex: number;
  isRetry: boolean;
}

interface ActiveSession {
  id: string;
  deckId: string;
  settings: DeckSettings;
  queue: QueueEntry[];
  /** Slot count, fixed at start. */
  queueLength: number;
  /** Current Leitner box per card (updated when a first attempt moves it). */
  boxByCard: Map<string, number>;
  /** Latest persisted state per card, for applyOutcome. */
  stateByCard: Map<string, CardStateRow>;
  firstAttempted: Set<string>;
  jar: (string | null)[];
  ended: boolean;
}

export interface SessionDeps {
  now?: () => Date;
  rng?: () => number;
  uuid?: () => string;
}

export function mediaUrlFor(mediaId: string): string {
  return `mem://media/${mediaId.split('/').map(encodeURIComponent).join('/')}`;
}

export class SessionManager {
  private readonly sessions = new Map<string, ActiveSession>();
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

  private toView(s: ActiveSession, e: QueueEntry): CardView {
    const box = s.boxByCard.get(e.card.id) ?? 1;
    return {
      cardId: e.card.id,
      promptType: e.card.promptType as CardView['promptType'],
      promptText: e.card.promptText,
      mediaUrl: e.card.mediaId === null ? null : mediaUrlFor(e.card.mediaId),
      timerMs: timerFor(s.settings.baseTimerMs, box),
      slotIndex: e.slotIndex,
      isRetry: e.isRetry,
    };
  }

  async start(deckId: string, opts: { tags?: string[] } = {}): Promise<SessionStart> {
    const deck = await getDeck(this.conn, deckId);
    if (deck === null) throw new Error(`unknown deck ${deckId}`);
    const now = this.now();
    const cards = await listCards(this.conn, deckId, { activeOnly: true });
    const states = await listCardStates(this.conn, deckId);
    const tagFilter = opts.tags ?? null;

    const queueCards = buildSessionQueue(states, cards, deck.settings, tagFilter, now, this.rng);

    const id = this.uuid();
    await insertSession(this.conn, {
      id,
      deckId,
      startedAtMs: now.getTime(),
      tagFilter,
      settings: deck.settings,
    });

    if (queueCards.length === 0) {
      // Nothing due, nothing new: close the row immediately (an empty jar is
      // not a perfect session — nothing was at stake).
      await endSession(this.conn, id, now.getTime(), false, []);
      return { sessionId: id, queueLength: 0, first: null };
    }

    const s: ActiveSession = {
      id,
      deckId,
      settings: deck.settings,
      queue: queueCards.map((qc, i) => ({ card: qc.card, slotIndex: i, isRetry: false })),
      queueLength: queueCards.length,
      boxByCard: new Map(queueCards.map((qc) => [qc.card.id, qc.box])),
      stateByCard: new Map(states.map((st) => [st.cardId, st])),
      firstAttempted: new Set(),
      jar: new Array<string | null>(queueCards.length).fill(null),
      ended: false,
    };
    this.sessions.set(id, s);
    return { sessionId: id, queueLength: s.queueLength, first: this.toView(s, s.queue[0]) };
  }

  async answer(sessionId: string, req: AnswerRequest): Promise<AnswerResult> {
    const s = this.sessions.get(sessionId);
    if (!s || s.ended) throw new Error(`no active session ${sessionId}`);
    const entry = s.queue[0];
    if (!entry || entry.card.id !== req.cardId) {
      throw new Error(`answer for ${req.cardId} but current card is ${entry?.card.id}`);
    }

    const now = this.now();
    const boxBefore = s.boxByCard.get(entry.card.id) ?? 1;
    const timerMs = timerFor(s.settings.baseTimerMs, boxBefore);
    const elapsedMs = Math.min(Math.max(0, Math.round(req.elapsedMs)), timerMs);
    const outcome: Outcome = evaluateOutcome(req.response, entry.card.answers, req.timedOut);
    const isFirstOfSession = !s.firstAttempted.has(entry.card.id);
    s.firstAttempted.add(entry.card.id);

    let boxAfter = boxBefore;
    if (isFirstOfSession) {
      const state = s.stateByCard.get(entry.card.id) ?? newCardState(s.deckId, entry.card.id);
      const nextState = applyOutcome(state, outcome, true, now);
      await upsertCardState(this.conn, nextState);
      s.stateByCard.set(entry.card.id, nextState);
      s.boxByCard.set(entry.card.id, nextState.box);
      boxAfter = nextState.box;
      s.jar[entry.slotIndex] = outcome === 'correct' ? (req.prize ?? '🎁') : null;
    }

    await insertAttempt(this.conn, {
      sessionId: s.id,
      deckId: s.deckId,
      cardId: entry.card.id,
      shownAtMs: now.getTime() - elapsedMs,
      timerMs,
      elapsedMs,
      response: req.response,
      outcome,
      isFirstOfSession,
      boxBefore,
      boxAfter,
    });

    s.queue.shift();
    if (outcome !== 'correct') {
      const at = Math.min(REQUEUE_DISTANCE, s.queue.length);
      s.queue.splice(at, 0, { ...entry, isRetry: true });
    }

    let sessionEnd: AnswerResult['sessionEnd'] = null;
    if (s.queue.length === 0) {
      s.ended = true;
      this.sessions.delete(s.id);
      const perfect = s.jar.every((x) => x !== null);
      await endSession(this.conn, s.id, now.getTime(), perfect, s.jar);
      sessionEnd = { perfect, jar: [...s.jar] };
    }

    return {
      outcome,
      isFirstOfSession,
      expected: outcome === 'correct' ? null : [...entry.card.answers],
      hint: outcome === 'correct' ? null : entry.card.hint,
      slotIndex: entry.slotIndex,
      next: s.queue.length > 0 ? this.toView(s, s.queue[0]) : null,
      remaining: s.queue.length,
      sessionEnd,
    };
  }

  /** Esc: the jar empties back into the pit — never perfect, jar not kept. */
  async abort(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s || s.ended) return;
    s.ended = true;
    this.sessions.delete(s.id);
    await endSession(this.conn, s.id, this.now().getTime(), false, []);
  }
}
