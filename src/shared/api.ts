/**
 * The window.api contract between renderer and main — FROZEN after Phase 0.
 * Changes require a request in COORDINATION.md and coordinator approval, and
 * must be additive (optional fields; no renames, no removals).
 *
 * This module is imported by BOTH the CJS main/preload bundles and the ESM
 * renderer bundle: types and pure constants only. No Node imports, no DOM.
 */

export type PromptType = 'text' | 'image' | 'audio';
/**
 * 'calibration' rows (contract change #4) are copy-typing warm-up trials:
 * logged for the audit trail, never touch Leitner state, excluded from stats
 * medians. See DESIGN.md "Timer calibration".
 */
export type Outcome = 'correct' | 'wrong' | 'timeout' | 'calibration';

export interface DeckSettings {
  baseTimerMs: number;
  newCardsPerSession: number;
  /**
   * Don't introduce new cards while box 1 already holds at least this many
   * due cards (within the drilled scope); below that, introduce only up to
   * the remaining box-1 capacity. Keeps the struggling set bounded: no new
   * material while drowning in failures. (Contract change #2, additive,
   * coordinator-approved 2026-07-10.)
   */
  maxBox1ForNew: number;
}

/** Default box-1 capacity gate for decks/packs that don't specify one. */
export const DEFAULT_MAX_BOX1_FOR_NEW = 10;

export interface DeckSummary {
  /** Internal deck id (may differ from the pack's id after re-imports). */
  id: string;
  /** Author-chosen id from deck.json; import matching key. */
  packId: string;
  /** Set when archived: hidden from active list, not drillable; history and
   *  trophies retained. (Contract change #3, additive, 2026-07-10.) */
  archivedAtIso: string | null;
  /** When the deck's timer was last calibrated (copy-typing warm-up); null =
   *  never — the UI runs calibration before the first drill. (Contract
   *  change #4, additive, 2026-07-11.) */
  calibratedAtIso: string | null;
  name: string;
  description: string | null;
  cardCount: number;
  /** Cards due now (box-1 cards are always due). */
  dueCount: number;
  /** Cards never drilled, available to introduce this session. */
  newCount: number;
  /** Cards per Leitner box, index 0 = box 1. */
  boxCounts: [number, number, number, number, number];
  settings: DeckSettings;
  /** All tags present in the deck, for the drill-by-tag picker. */
  tags: string[];
}

export interface CardView {
  cardId: string;
  promptType: PromptType;
  promptText: string | null;
  /**
   * Opaque URL for image/audio prompts. The real backend emits
   * mem://media/<id>; the mock emits data: URIs. The renderer never
   * constructs or parses these.
   */
  mediaUrl: string | null;
  /** Time allowed for this presentation (base × box multiplier). */
  timerMs: number;
  /** Jar slot this card fills, 0-based, stable across re-queues. */
  slotIndex: number;
  /** True when re-queued after an in-session failure (claw-slip on success). */
  isRetry: boolean;
}

export interface SessionStart {
  sessionId: string;
  /** Number of cards in the session = number of jar slots. */
  queueLength: number;
  /** Null when nothing is due and no new cards remain. */
  first: CardView | null;
}

export interface AnswerRequest {
  cardId: string;
  /** Literal typed text; '' allowed (e.g. on timeout). */
  response: string;
  /** Renderer-measured via performance.now(); main clamps to timerMs. */
  elapsedMs: number;
  timedOut: boolean;
  /**
   * Trinket the renderer's claw grabbed on success (renderer owns the prize
   * pool and the weighted pick); persisted into sessions.jar. Null on failure
   * or on retry successes (the slip).
   */
  prize: string | null;
}

export interface SessionEnd {
  perfect: boolean;
  /** Per slot: prize string, or null where a pebble sits. */
  jar: (string | null)[];
}

export interface AnswerResult {
  outcome: Outcome;
  /** True → this attempt moved the Leitner box and decided the jar slot. */
  isFirstOfSession: boolean;
  /** Accepted answers, present when outcome !== 'correct'. */
  expected: string[] | null;
  /** Mnemonic to show with the failure feedback, when the card has one. */
  hint: string | null;
  /**
   * Answer-side audio (e.g. the spoken syllable), set when the card has it —
   * played during the feedback/grab phase for BOTH outcomes. Same opaque URL
   * scheme as CardView.mediaUrl; load via <audio>, never fetch(). Optional:
   * absent from older backends. (Contract change #1, coordinator-approved
   * 2026-07-08 — additive.)
   */
  answerMediaUrl?: string | null;
  slotIndex: number;
  next: CardView | null;
  /** Cards still to clear, including re-queued ones. */
  remaining: number;
  /** Present exactly when next is null. */
  sessionEnd: SessionEnd | null;
}

export interface CalibrationStart {
  sessionId: string;
  /** ~10 sampled cards; text = the canonical answer to copy-type. */
  trials: { cardId: string; text: string }[];
}

export interface CalibrationTrialResult {
  cardId: string;
  /** The text that was shown. */
  text: string;
  /** What was typed (mistyped trials are logged but excluded from the floor). */
  response: string;
  elapsedMs: number;
}

export interface CalibrationResult {
  /** Median correct copy-typing time: the motor+perception floor. */
  floorMs: number;
  /** floor + retrieval allowance, divided by the box-1 multiplier. */
  suggestedBaseTimerMs: number;
  /** True when the suggestion was written into the deck's settings. */
  appliedToSettings: boolean;
}

export interface ImportResult {
  deckId: string;
  name: string;
  cardsAdded: number;
  cardsUpdated: number;
  /** Card ids present in the DB but missing from the imported pack. */
  orphanedCardIds: string[];
}

export interface TrophyView {
  sessionId: string;
  deckId: string;
  deckName: string;
  endedAtIso: string;
  /** Slot count of the sealed jar. */
  size: number;
  jar: string[];
}

export interface CardStats {
  cardId: string;
  promptPreview: string;
  box: number;
  dueAtIso: string | null;
  lastSuccessAtIso: string | null;
  lifetimeCorrect: number;
  lifetimeWrong: number;
  medianElapsedMs: number | null;
}

export interface DeckStats {
  deckId: string;
  boxCounts: [number, number, number, number, number];
  dueForecast: { dateIso: string; count: number }[];
  dailyMedianElapsed: { dateIso: string; medianMs: number }[];
}

export interface AttemptRow {
  id: number;
  sessionId: string;
  deckId: string;
  cardId: string;
  shownAtIso: string;
  timerMs: number;
  elapsedMs: number;
  response: string;
  outcome: Outcome;
  isFirstOfSession: boolean;
  boxBefore: number;
  boxAfter: number;
}

export interface AttemptFilter {
  deckId?: string;
  cardId?: string;
  outcome?: Outcome;
  sinceIso?: string;
  limit?: number;
}

export interface Api {
  decks: {
    list(): Promise<DeckSummary[]>;
    /** Main shows the open dialog. Null = user canceled. */
    import(): Promise<ImportResult | null>;
    /** Main shows the save dialog. Returns written path, or null if canceled. */
    export(deckId: string): Promise<string | null>;
    remove(deckId: string): Promise<void>;
    updateSettings(deckId: string, settings: DeckSettings): Promise<void>;
    /** Reversible; archived decks keep all history and trophies. */
    archive(deckId: string): Promise<void>;
    unarchive(deckId: string): Promise<void>;
  };
  session: {
    start(deckId: string, opts?: { tags?: string[] }): Promise<SessionStart>;
    answer(sessionId: string, req: AnswerRequest): Promise<AnswerResult>;
    abort(sessionId: string): Promise<void>;
  };
  /**
   * Copy-typing timer calibration (contract change #4). Trials show the
   * answer text itself; the user types it. Measures the motor+perception
   * floor so the drill deadline can sit above retrieval but below
   * calculation (DESIGN.md "Timer calibration"). Not Leitner: no box
   * movement, rows logged with outcome 'calibration'.
   */
  calibration: {
    start(deckId: string): Promise<CalibrationStart>;
    /** Logs all trials, computes the suggestion, applies it to the deck's
     *  baseTimerMs, and stamps calibratedAt. */
    submit(sessionId: string, trials: CalibrationTrialResult[]): Promise<CalibrationResult>;
    /** Abandon without logging a suggestion (trials so far are discarded). */
    abort(sessionId: string): Promise<void>;
  };
  stats: {
    deck(deckId: string): Promise<DeckStats>;
    cards(deckId: string): Promise<CardStats[]>;
    attempts(filter: AttemptFilter): Promise<AttemptRow[]>;
    trophies(): Promise<TrophyView[]>;
  };
}

/** IPC channel names — single source of truth for preload and ipcMain. */
export const IPC = {
  decksList: 'decks:list',
  decksImport: 'decks:import',
  decksExport: 'decks:export',
  decksRemove: 'decks:remove',
  decksUpdateSettings: 'decks:update-settings',
  decksArchive: 'decks:archive',
  decksUnarchive: 'decks:unarchive',
  sessionStart: 'session:start',
  sessionAnswer: 'session:answer',
  sessionAbort: 'session:abort',
  calibrationStart: 'calibration:start',
  calibrationSubmit: 'calibration:submit',
  calibrationAbort: 'calibration:abort',
  statsDeck: 'stats:deck',
  statsCards: 'stats:cards',
  statsAttempts: 'stats:attempts',
  statsTrophies: 'stats:trophies',
} as const;
