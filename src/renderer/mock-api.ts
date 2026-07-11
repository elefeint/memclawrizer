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
  /** Answer-side audio played at resolution (F6); null = card has none. */
  answerMediaUrl: string | null;
  answers: string[];
  hint: string | null;
  tags: string[];
}

/**
 * A tiny valid 8-bit mono WAV as a data: URI — a 0.15s sine with a short
 * fade, built in code so the mock ships no asset files. Distinct pitches per
 * card make it audible WHICH card's answer fired during manual verification.
 */
function sineWavDataUri(freqHz: number): string {
  const rate = 8000;
  const n = Math.floor(rate * 0.15);
  const bytes = new Uint8Array(44 + n);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  const u32 = (offset: number, v: number) => {
    bytes[offset] = v & 0xff;
    bytes[offset + 1] = (v >> 8) & 0xff;
    bytes[offset + 2] = (v >> 16) & 0xff;
    bytes[offset + 3] = (v >> 24) & 0xff;
  };
  const u16 = (offset: number, v: number) => {
    bytes[offset] = v & 0xff;
    bytes[offset + 1] = (v >> 8) & 0xff;
  };
  ascii(0, 'RIFF');
  u32(4, 36 + n);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  u32(16, 16);
  u16(20, 1); // PCM
  u16(22, 1); // mono
  u32(24, rate);
  u32(28, rate); // byte rate (8-bit mono)
  u16(32, 1); // block align
  u16(34, 8); // bits per sample
  ascii(36, 'data');
  u32(40, n);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, (5 * (n - i)) / n, (10 * i) / n);
    bytes[44 + i] = 128 + Math.round(96 * fade * Math.sin((2 * Math.PI * freqHz * i) / rate));
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return `data:audio/wav;base64,${btoa(bin)}`;
}

const SHI_WAV = sineWavDataUri(440);
const KA_WAV = sineWavDataUri(660);
const HARD_WAV = sineWavDataUri(880);

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
    settings: { baseTimerMs: 5000, newCardsPerSession: 5, maxBox1ForNew: 10 },
    cards: [
      { id: 'shi', promptType: 'text', promptText: 'し', mediaUrl: null, answerMediaUrl: SHI_WAV, answers: ['shi', 'si'], hint: 'she has a fishing hook', tags: ['hiragana'] },
      { id: 'ka', promptType: 'text', promptText: 'か', mediaUrl: null, answerMediaUrl: KA_WAV, answers: ['ka'], hint: null, tags: ['hiragana'] },
      { id: 'n', promptType: 'text', promptText: 'ん', mediaUrl: null, answerMediaUrl: null, answers: ['n'], hint: 'the only lone consonant', tags: ['hiragana'] },
      { id: 'mock-hard', promptType: 'text', promptText: '🂠 (unguessable)', mediaUrl: null, answerMediaUrl: HARD_WAV, answers: ['xyzzy'], hint: 'the magic word is xyzzy', tags: ['mock'] },
    ],
  },
  {
    id: 'mock-piano',
    name: 'Mock piano (1 card)',
    description: 'One data:-SVG staff image; a perfect session is one answer away.',
    settings: { baseTimerMs: 7000, newCardsPerSession: 5, maxBox1ForNew: 10 },
    cards: [
      { id: 'treble-c4', promptType: 'image', promptText: null, mediaUrl: STAFF_SVG, answerMediaUrl: null, answers: ['c4', 'c'], hint: 'one ledger line below the staff — middle C', tags: ['treble'] },
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

/**
 * Deterministic trophy seeds (sessionId prefix 'seed-') so the shelf's
 * denominational consolidation is exercisable under start:mock:
 *  - 'mock-piano' gets 9: its 1-card deck means ONE perfect run completes a
 *    ten and fires the consolidation ceremony;
 *  - 'mock-legacy' (a trophies-only pseudo-deck, no cards) gets 113:
 *    1 hundred-jar + 1 ten-jar + 3 singles on first render.
 */
function seedTrophies(): TrophyView[] {
  const seeds: TrophyView[] = [];
  const day = (base: string, i: number): string =>
    new Date(Date.parse(base) + i * 86_400_000).toISOString();
  for (let i = 0; i < 9; i++) {
    seeds.push({
      sessionId: `seed-piano-${i}`,
      deckId: 'mock-piano',
      deckName: 'Mock piano (1 card)',
      endedAtIso: day('2026-06-20T09:00:00Z', i),
      size: 1,
      jar: ['🎁'],
    });
  }
  for (let i = 0; i < 113; i++) {
    seeds.push({
      sessionId: `seed-legacy-${i}`,
      deckId: 'mock-legacy',
      deckName: 'Mock legacy (seeded)',
      endedAtIso: day('2026-03-01T09:00:00Z', i),
      size: (i % 7) + 2,
      jar: ['⭐'],
    });
  }
  // stats.trophies() convention is newest first.
  return seeds.reverse();
}

export function createMockApi(): Api {
  // Per-instance deck state: settings are mutable (updateSettings,
  // calibration), so each mock instance gets its own copies — tests stay
  // independent of each other and of module evaluation order.
  const decks: MockDeck[] = DECKS.map((d) => ({ ...d, settings: { ...d.settings } }));
  const sessions = new Map<string, MockSession>();
  const trophies: TrophyView[] = seedTrophies();
  // Archive state (contract #3, F7): deckId → ISO timestamp. Archived decks
  // stay listed (archivedAtIso set), keep stats/trophies, refuse drills.
  const archivedAt = new Map<string, string>();
  // Calibration state (contract #4): deckId → ISO timestamp of last run.
  const calibratedAt = new Map<string, string>();
  const calibrationSessions = new Map<string, string>(); // sessionId → deckId
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
    packId: d.id,
    archivedAtIso: archivedAt.get(d.id) ?? null,
    calibratedAtIso: calibratedAt.get(d.id) ?? null,
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
      list: async () => decks.map(summary),
      import: async () => ({
        deckId: 'mock-imported',
        name: 'Pretend import',
        cardsAdded: 46,
        cardsUpdated: 0,
        orphanedCardIds: [],
      }),
      export: async () => '/tmp/mock-export.deckpack',
      remove: async () => undefined,
      archive: async (deckId) => {
        archivedAt.set(deckId, new Date().toISOString());
      },
      unarchive: async (deckId) => {
        archivedAt.delete(deckId);
      },
      updateSettings: async (deckId, settings) => {
        const d = decks.find((x) => x.id === deckId);
        if (d) d.settings = { ...settings };
      },
    },

    session: {
      start: async (deckId): Promise<SessionStart> => {
        const deck = decks.find((d) => d.id === deckId);
        if (!deck) throw new Error(`unknown deck ${deckId}`);
        // Mirrors B7: archived decks are not drillable (contract change #3).
        if (archivedAt.has(deckId)) throw new Error(`deck ${deckId} is archived`);
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
          // Answer-side audio rides along for BOTH outcomes (F6).
          answerMediaUrl: entry.card.answerMediaUrl,
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

    calibration: {
      start: async (deckId) => {
        const deck = decks.find((d) => d.id === deckId);
        if (!deck) throw new Error(`unknown deck ${deckId}`);
        const id = `mock-calibration-${++sessionCounter}`;
        calibrationSessions.set(id, deckId);
        return {
          sessionId: id,
          trials: deck.cards.map((c) => ({ cardId: c.id, text: c.answers[0] })),
        };
      },
      submit: async (sessionId, trials) => {
        const deckId = calibrationSessions.get(sessionId);
        if (deckId === undefined) throw new Error(`unknown calibration ${sessionId}`);
        calibrationSessions.delete(sessionId);
        // Mirror of the real math (DESIGN.md "Timer calibration"): floor =
        // median elapsed of correctly copied trials; window = floor + 1200ms
        // retrieval allowance; base = window / box-1 multiplier (1.5),
        // rounded to 100ms, clamped [1500, 10000].
        const ok = trials
          .filter((t) => isCorrect(t.response, [t.text]))
          .map((t) => t.elapsedMs)
          .sort((a, b) => a - b);
        const floorMs =
          ok.length === 0
            ? 0
            : ok.length % 2 === 1
              ? ok[(ok.length - 1) / 2]
              : Math.round((ok[ok.length / 2 - 1] + ok[ok.length / 2]) / 2);
        const applied = ok.length >= 3;
        const suggestedBaseTimerMs = Math.min(
          10000,
          Math.max(1500, Math.round((floorMs + 1200) / 1.5 / 100) * 100),
        );
        if (applied) {
          const deck = decks.find((d) => d.id === deckId);
          if (deck) deck.settings = { ...deck.settings, baseTimerMs: suggestedBaseTimerMs };
          calibratedAt.set(deckId, new Date().toISOString());
        }
        return { floorMs, suggestedBaseTimerMs, appliedToSettings: applied };
      },
      abort: async (sessionId) => {
        calibrationSessions.delete(sessionId);
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
        const deck = decks.find((d) => d.id === deckId);
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
