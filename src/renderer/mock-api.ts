/**
 * In-memory mock of the window.api contract. Owned by the Frontend agent.
 *
 * Deterministic on purpose: fixed deck order, no shuffling, so every failure
 * path is exercisable on demand:
 *  - 'mock-kana' has an unguessable card ('mock-hard') to force wrong/re-queue
 *    (its real answer is 'xyzzy', so a retry CAN clear it);
 *  - 'mock-piano' has a single data:-SVG image card, so a one-card perfect
 *    session (sealed jar) is one correct answer away.
 * Also a mini executable spec of the contract semantics (see mock-api.test.ts).
 */
import type {
  AnswerRequest,
  AnswerResult,
  Api,
  CardView,
  DeckSettings,
  DeckSummary,
  PromptType,
  SessionEnd,
  SessionStart,
  TrophyView,
} from '../shared/api';
import { isCorrect } from '../shared/normalize';

interface MockCard {
  id: string;
  promptType: PromptType;
  promptText: string | null;
  mediaUrl: string | null;
  answers: string[];
  hint: string | null;
  tags: string[];
}

interface MockDeck {
  id: string;
  name: string;
  description: string;
  settings: DeckSettings;
  cards: MockCard[];
}

const STAFF_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="120" viewBox="0 0 220 120">
      <rect width="220" height="120" fill="white"/>
      ${[30, 45, 60, 75, 90].map((y) => `<line x1="10" y1="${y}" x2="210" y2="${y}" stroke="black" stroke-width="2"/>`).join('')}
      <line x1="120" y1="105" x2="160" y2="105" stroke="black" stroke-width="2"/>
      <ellipse cx="140" cy="105" rx="11" ry="8" fill="black"/>
      <line x1="150" y1="105" x2="150" y2="45" stroke="black" stroke-width="2"/>
    </svg>`,
  );

const DECKS: MockDeck[] = [
  {
    id: 'mock-kana',
    name: 'Mock kana (4 cards)',
    description: 'Text prompts; includes an unguessable card to exercise failure paths.',
    settings: { baseTimerMs: 5000, newCardsPerSession: 5 },
    cards: [
      { id: 'shi', promptType: 'text', promptText: 'し', mediaUrl: null, answers: ['shi', 'si'], hint: 'she has a fishing hook', tags: ['hiragana'] },
      { id: 'ka', promptType: 'text', promptText: 'か', mediaUrl: null, answers: ['ka'], hint: null, tags: ['hiragana'] },
      { id: 'n', promptType: 'text', promptText: 'ん', mediaUrl: null, answers: ['n'], hint: 'the only lone consonant', tags: ['hiragana'] },
      { id: 'mock-hard', promptType: 'text', promptText: '🂠 (unguessable)', mediaUrl: null, answers: ['xyzzy'], hint: 'the magic word is xyzzy', tags: ['mock'] },
    ],
  },
  {
    id: 'mock-piano',
    name: 'Mock piano (1 card)',
    description: 'One data:-SVG staff image; a perfect session is one answer away.',
    settings: { baseTimerMs: 7000, newCardsPerSession: 5 },
    cards: [
      { id: 'treble-c4', promptType: 'image', promptText: null, mediaUrl: STAFF_SVG, answers: ['c4', 'c'], hint: 'one ledger line below the staff — middle C', tags: ['treble'] },
    ],
  },
];

interface QueueEntry {
  card: MockCard;
  slotIndex: number;
  isRetry: boolean;
}

interface MockSession {
  id: string;
  deck: MockDeck;
  queue: QueueEntry[];
  queueLength: number;
  firstAttempted: Set<string>;
  jar: (string | null)[];
  ended: boolean;
}

export function createMockApi(): Api {
  const sessions = new Map<string, MockSession>();
  const trophies: TrophyView[] = [];
  let sessionCounter = 0;

  const toView = (s: MockSession, e: QueueEntry): CardView => ({
    cardId: e.card.id,
    promptType: e.card.promptType,
    promptText: e.card.promptText,
    mediaUrl: e.card.mediaUrl,
    timerMs: s.deck.settings.baseTimerMs,
    slotIndex: e.slotIndex,
    isRetry: e.isRetry,
  });

  const summary = (d: MockDeck): DeckSummary => ({
    id: d.id,
    name: d.name,
    description: d.description,
    cardCount: d.cards.length,
    dueCount: d.cards.length,
    newCount: d.cards.length,
    boxCounts: [d.cards.length, 0, 0, 0, 0],
    settings: { ...d.settings },
    tags: [...new Set(d.cards.flatMap((c) => c.tags))],
  });

  return {
    decks: {
      list: async () => DECKS.map(summary),
      import: async () => ({
        deckId: 'mock-imported',
        name: 'Pretend import',
        cardsAdded: 46,
        cardsUpdated: 0,
        orphanedCardIds: [],
      }),
      export: async () => '/tmp/mock-export.deckpack',
      remove: async () => undefined,
      updateSettings: async (deckId, settings) => {
        const d = DECKS.find((x) => x.id === deckId);
        if (d) d.settings = { ...settings };
      },
    },

    session: {
      start: async (deckId): Promise<SessionStart> => {
        const deck = DECKS.find((d) => d.id === deckId);
        if (!deck) throw new Error(`unknown deck ${deckId}`);
        const id = `mock-session-${++sessionCounter}`;
        const s: MockSession = {
          id,
          deck,
          queue: deck.cards.map((card, i) => ({ card, slotIndex: i, isRetry: false })),
          queueLength: deck.cards.length,
          firstAttempted: new Set(),
          jar: new Array(deck.cards.length).fill(null),
          ended: false,
        };
        sessions.set(id, s);
        return {
          sessionId: id,
          queueLength: s.queueLength,
          first: s.queue.length > 0 ? toView(s, s.queue[0]) : null,
        };
      },

      answer: async (sessionId, req: AnswerRequest): Promise<AnswerResult> => {
        const s = sessions.get(sessionId);
        if (!s || s.ended) throw new Error(`no active session ${sessionId}`);
        const entry = s.queue[0];
        if (!entry || entry.card.id !== req.cardId) {
          throw new Error(`answer for ${req.cardId} but current card is ${entry?.card.id}`);
        }

        const outcome = req.timedOut
          ? 'timeout'
          : isCorrect(req.response, entry.card.answers)
            ? 'correct'
            : 'wrong';
        const isFirstOfSession = !s.firstAttempted.has(entry.card.id);
        s.firstAttempted.add(entry.card.id);

        if (isFirstOfSession) {
          s.jar[entry.slotIndex] = outcome === 'correct' ? (req.prize ?? '🎁') : null;
        }

        s.queue.shift();
        if (outcome !== 'correct') {
          const at = Math.min(3, s.queue.length);
          s.queue.splice(at, 0, { ...entry, isRetry: true });
        }

        let sessionEnd: SessionEnd | null = null;
        if (s.queue.length === 0) {
          s.ended = true;
          const perfect = s.jar.every((x) => x !== null);
          sessionEnd = { perfect, jar: [...s.jar] };
          if (perfect) {
            trophies.unshift({
              sessionId: s.id,
              deckId: s.deck.id,
              deckName: s.deck.name,
              endedAtIso: new Date().toISOString(),
              size: s.queueLength,
              jar: s.jar.map((x) => x as string),
            });
          }
        }

        return {
          outcome,
          isFirstOfSession,
          expected: outcome === 'correct' ? null : [...entry.card.answers],
          hint: outcome === 'correct' ? null : entry.card.hint,
          slotIndex: entry.slotIndex,
          next: s.queue.length > 0 ? toView(s, s.queue[0]) : null,
          remaining: s.queue.length,
          sessionEnd,
        };
      },

      abort: async (sessionId) => {
        const s = sessions.get(sessionId);
        if (s) s.ended = true;
      },
    },

    stats: {
      deck: async (deckId) => ({
        deckId,
        boxCounts: [2, 1, 1, 0, 0],
        dueForecast: [
          { dateIso: '2026-07-05', count: 4 },
          { dateIso: '2026-07-06', count: 1 },
        ],
        dailyMedianElapsed: [
          { dateIso: '2026-07-04', medianMs: 3200 },
          { dateIso: '2026-07-05', medianMs: 2700 },
        ],
      }),
      cards: async (deckId) => {
        const deck = DECKS.find((d) => d.id === deckId);
        return (deck?.cards ?? []).map((c, i) => ({
          cardId: c.id,
          promptPreview: c.promptText ?? `[${c.promptType}]`,
          box: (i % 5) + 1,
          dueAtIso: '2026-07-06T09:00:00Z',
          lastSuccessAtIso: i === 0 ? '2026-07-04T09:00:00Z' : null,
          lifetimeCorrect: 3 * i,
          lifetimeWrong: i,
          medianElapsedMs: 2500 + 300 * i,
        }));
      },
      attempts: async () => [
        {
          id: 1,
          sessionId: 'mock-session-0',
          deckId: 'mock-kana',
          cardId: 'shi',
          shownAtIso: '2026-07-04T09:00:00Z',
          timerMs: 5000,
          elapsedMs: 2100,
          response: 'shi',
          outcome: 'correct',
          isFirstOfSession: true,
          boxBefore: 1,
          boxAfter: 2,
        },
      ],
      trophies: async () => [...trophies],
    },
  };
}
