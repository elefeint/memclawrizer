/**
 * Typed query helpers over the v1 schema — the ONLY place row-shape knowledge
 * lives. Everything above this layer (packs, sessions, ipc) works with plain
 * JS objects; everything below is SQL with parameterized statements.
 *
 * Conventions:
 *  - All timestamps cross this boundary as epoch milliseconds (numbers).
 *    They are stored as DuckDB TIMESTAMP (microseconds, UTC).
 *  - JSON columns cross as parsed values (string[], objects), stored via
 *    JSON.stringify.
 *  - No Electron imports: unit-testable under plain Node with ':memory:'.
 */
import {
  DuckDBConnection,
  DuckDBTimestampValue,
  DuckDBBlobValue,
  DuckDBValue,
  timestampValue,
} from '@duckdb/node-api';
import type { DeckSettings, Outcome } from '../shared/api';
import { DEFAULT_MAX_BOX1_FOR_NEW } from '../shared/api';

// ---------------------------------------------------------------------------
// Value conversion

export function msToTimestamp(ms: number): DuckDBTimestampValue {
  return timestampValue(BigInt(Math.round(ms)) * 1000n);
}

function msToTimestampOrNull(ms: number | null): DuckDBTimestampValue | null {
  return ms === null ? null : msToTimestamp(ms);
}

export function timestampToMs(v: DuckDBValue): number {
  if (v instanceof DuckDBTimestampValue) return Number(v.micros / 1000n);
  throw new Error(`expected TIMESTAMP value, got ${typeof v}: ${String(v)}`);
}

function timestampToMsOrNull(v: DuckDBValue): number | null {
  return v === null ? null : timestampToMs(v);
}

function asString(v: DuckDBValue): string {
  if (typeof v === 'string') return v;
  throw new Error(`expected string value, got ${typeof v}`);
}

function asStringOrNull(v: DuckDBValue): string | null {
  return v === null ? null : asString(v);
}

function asNumber(v: DuckDBValue): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  throw new Error(`expected numeric value, got ${typeof v}`);
}

function asBoolean(v: DuckDBValue): boolean {
  if (typeof v === 'boolean') return v;
  throw new Error(`expected boolean value, got ${typeof v}`);
}

function asJson<T>(v: DuckDBValue): T {
  return JSON.parse(asString(v)) as T;
}

// ---------------------------------------------------------------------------
// Row shapes (JS side)

export interface DeckRow {
  /** Internal id — may differ from packId after archive + re-import (v3). */
  id: string;
  /** Author-chosen id from deck.json; the import matching key. */
  packId: string;
  name: string;
  description: string | null;
  settings: DeckSettings;
  formatVersion: number;
  importedAtMs: number;
  /** Non-null = archived: hidden, not drillable, history frozen. */
  archivedAtMs: number | null;
}

export interface CardRow {
  deckId: string;
  id: string;
  promptType: string;
  promptText: string | null;
  mediaId: string | null;
  /** Audio played during feedback after the attempt (format v2); never
   * exposed before the attempt. */
  answerMediaId: string | null;
  answers: string[];
  hint: string | null;
  tags: string[];
  active: boolean;
}

export interface CardStateRow {
  deckId: string;
  cardId: string;
  box: number;
  dueAtMs: number | null;
  lastSuccessAtMs: number | null;
  lastSeenAtMs: number | null;
  lifetimeCorrect: number;
  lifetimeWrong: number;
}

export interface MediaRow {
  id: string;
  deckId: string;
  mime: string;
  bytes: Uint8Array;
}

export interface SessionInsert {
  id: string;
  deckId: string;
  startedAtMs: number;
  tagFilter: string[] | null;
  settings: DeckSettings;
  /** v4: 'drill' (default) or 'calibration'; NULL in pre-v4 rows = 'drill'. */
  kind?: 'drill' | 'calibration';
}

export interface AttemptInsert {
  sessionId: string;
  deckId: string;
  cardId: string;
  shownAtMs: number;
  timerMs: number;
  elapsedMs: number;
  response: string;
  outcome: Outcome;
  isFirstOfSession: boolean;
  boxBefore: number;
  boxAfter: number;
}

// ---------------------------------------------------------------------------
// Decks

export async function upsertDeck(conn: DuckDBConnection, deck: DeckRow): Promise<void> {
  await conn.run(
    `INSERT INTO decks
       (id, pack_id, name, description, settings, format_version, imported_at, archived_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       pack_id = excluded.pack_id,
       name = excluded.name,
       description = excluded.description,
       settings = excluded.settings,
       format_version = excluded.format_version,
       imported_at = excluded.imported_at,
       archived_at = excluded.archived_at`,
    [
      deck.id,
      deck.packId,
      deck.name,
      deck.description,
      JSON.stringify(deck.settings),
      deck.formatVersion,
      msToTimestamp(deck.importedAtMs),
      deck.archivedAtMs === null ? null : msToTimestamp(deck.archivedAtMs),
    ],
  );
}

function deckFromRow(r: DuckDBValue[]): DeckRow {
  return {
    id: asString(r[0]),
    packId: asString(r[1]),
    name: asString(r[2]),
    description: asStringOrNull(r[3]),
    // Rows written before a settings field existed (maxBox1ForNew, added
    // 2026-07-10) pick up the default at read time.
    settings: withSettingsDefaults(asJson<DeckSettings>(r[4])),
    formatVersion: asNumber(r[5]),
    importedAtMs: timestampToMs(r[6]),
    archivedAtMs: r[7] === null ? null : timestampToMs(r[7]),
  };
}

function withSettingsDefaults(stored: DeckSettings): DeckSettings {
  return { ...stored, maxBox1ForNew: stored.maxBox1ForNew ?? DEFAULT_MAX_BOX1_FOR_NEW };
}

const DECK_COLS =
  'id, pack_id, name, description, settings, format_version, imported_at, archived_at';

export async function getDeck(conn: DuckDBConnection, id: string): Promise<DeckRow | null> {
  const reader = await conn.runAndReadAll(
    `SELECT ${DECK_COLS} FROM decks WHERE id = $1`,
    [id],
  );
  const rows = reader.getRows();
  return rows.length === 0 ? null : deckFromRow(rows[0]);
}

export async function listDecks(conn: DuckDBConnection): Promise<DeckRow[]> {
  const reader = await conn.runAndReadAll(`SELECT ${DECK_COLS} FROM decks ORDER BY name, id`);
  return reader.getRows().map(deckFromRow);
}

export async function updateDeckSettings(
  conn: DuckDBConnection,
  id: string,
  settings: DeckSettings,
): Promise<void> {
  await conn.run('UPDATE decks SET settings = $1 WHERE id = $2', [
    JSON.stringify(settings),
    id,
  ]);
}

/**
 * The import target for a pack id: the ACTIVE deck carrying it. If several
 * active decks share a pack_id (unarchive after a re-import), the most
 * recently imported one wins (DESIGN.md "Deck lifecycle: archiving").
 */
export async function findActiveDeckByPackId(
  conn: DuckDBConnection,
  packId: string,
): Promise<DeckRow | null> {
  const reader = await conn.runAndReadAll(
    `SELECT ${DECK_COLS} FROM decks
     WHERE pack_id = $1 AND archived_at IS NULL
     ORDER BY imported_at DESC, id DESC LIMIT 1`,
    [packId],
  );
  const rows = reader.getRows();
  return rows.length === 0 ? null : deckFromRow(rows[0]);
}

/** Reversible: hides the deck and freezes its import identity (v3). */
export async function archiveDeck(
  conn: DuckDBConnection,
  id: string,
  nowMs: number,
): Promise<void> {
  await conn.run('UPDATE decks SET archived_at = $1 WHERE id = $2', [msToTimestamp(nowMs), id]);
}

export async function unarchiveDeck(conn: DuckDBConnection, id: string): Promise<void> {
  await conn.run('UPDATE decks SET archived_at = NULL WHERE id = $1', [id]);
}

/**
 * Removes deck content and scheduling state. Sessions and attempts stay — the
 * audit log is never deleted (DESIGN.md), and dangling deck ids there are
 * harmless history.
 */
export async function removeDeck(conn: DuckDBConnection, id: string): Promise<void> {
  await conn.run('DELETE FROM card_state WHERE deck_id = $1', [id]);
  await conn.run('DELETE FROM cards WHERE deck_id = $1', [id]);
  await conn.run('DELETE FROM media WHERE deck_id = $1', [id]);
  await conn.run('DELETE FROM decks WHERE id = $1', [id]);
}

// ---------------------------------------------------------------------------
// Cards

export async function upsertCard(conn: DuckDBConnection, card: CardRow): Promise<void> {
  await conn.run(
    `INSERT INTO cards
       (deck_id, id, prompt_type, prompt_text, media_id, answer_media_id, answers, hint, tags, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (deck_id, id) DO UPDATE SET
       prompt_type = excluded.prompt_type,
       prompt_text = excluded.prompt_text,
       media_id = excluded.media_id,
       answer_media_id = excluded.answer_media_id,
       answers = excluded.answers,
       hint = excluded.hint,
       tags = excluded.tags,
       active = excluded.active`,
    [
      card.deckId,
      card.id,
      card.promptType,
      card.promptText,
      card.mediaId,
      card.answerMediaId,
      JSON.stringify(card.answers),
      card.hint,
      JSON.stringify(card.tags),
      card.active,
    ],
  );
}

function cardFromRow(r: DuckDBValue[]): CardRow {
  return {
    deckId: asString(r[0]),
    id: asString(r[1]),
    promptType: asString(r[2]),
    promptText: asStringOrNull(r[3]),
    mediaId: asStringOrNull(r[4]),
    answerMediaId: asStringOrNull(r[5]),
    answers: asJson<string[]>(r[6]),
    hint: asStringOrNull(r[7]),
    tags: asJson<string[]>(r[8]),
    active: asBoolean(r[9]),
  };
}

const CARD_COLS =
  'deck_id, id, prompt_type, prompt_text, media_id, answer_media_id, answers, hint, tags, active';

export async function listCards(
  conn: DuckDBConnection,
  deckId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<CardRow[]> {
  const activeClause = opts.activeOnly ? ' AND active' : '';
  const reader = await conn.runAndReadAll(
    `SELECT ${CARD_COLS} FROM cards WHERE deck_id = $1${activeClause} ORDER BY id`,
    [deckId],
  );
  return reader.getRows().map(cardFromRow);
}

// ---------------------------------------------------------------------------
// Media

export async function upsertMedia(conn: DuckDBConnection, media: MediaRow): Promise<void> {
  await conn.run(
    `INSERT INTO media (id, deck_id, mime, bytes) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       deck_id = excluded.deck_id,
       mime = excluded.mime,
       bytes = excluded.bytes`,
    [media.id, media.deckId, media.mime, new DuckDBBlobValue(media.bytes)],
  );
}

export async function getMedia(
  conn: DuckDBConnection,
  id: string,
): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const reader = await conn.runAndReadAll('SELECT mime, bytes FROM media WHERE id = $1', [id]);
  const rows = reader.getRows();
  if (rows.length === 0) return null;
  const blob = rows[0][1];
  if (!(blob instanceof DuckDBBlobValue)) throw new Error('media.bytes is not a BLOB');
  return { mime: asString(rows[0][0]), bytes: blob.bytes };
}

/** Media ids no longer referenced by any card of the deck (after re-import).
 * Both prompt media and answer media (format v2) count as references. */
export async function deleteUnreferencedMedia(
  conn: DuckDBConnection,
  deckId: string,
): Promise<void> {
  await conn.run(
    `DELETE FROM media WHERE deck_id = $1
       AND id NOT IN (SELECT media_id FROM cards WHERE deck_id = $1 AND media_id IS NOT NULL)
       AND id NOT IN (
         SELECT answer_media_id FROM cards WHERE deck_id = $1 AND answer_media_id IS NOT NULL
       )`,
    [deckId],
  );
}

// ---------------------------------------------------------------------------
// Card state

export async function upsertCardState(
  conn: DuckDBConnection,
  state: CardStateRow,
): Promise<void> {
  await conn.run(
    `INSERT INTO card_state
       (deck_id, card_id, box, due_at, last_success_at, last_seen_at, lifetime_correct, lifetime_wrong)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (deck_id, card_id) DO UPDATE SET
       box = excluded.box,
       due_at = excluded.due_at,
       last_success_at = excluded.last_success_at,
       last_seen_at = excluded.last_seen_at,
       lifetime_correct = excluded.lifetime_correct,
       lifetime_wrong = excluded.lifetime_wrong`,
    [
      state.deckId,
      state.cardId,
      state.box,
      msToTimestampOrNull(state.dueAtMs),
      msToTimestampOrNull(state.lastSuccessAtMs),
      msToTimestampOrNull(state.lastSeenAtMs),
      state.lifetimeCorrect,
      state.lifetimeWrong,
    ],
  );
}

function cardStateFromRow(r: DuckDBValue[]): CardStateRow {
  return {
    deckId: asString(r[0]),
    cardId: asString(r[1]),
    box: asNumber(r[2]),
    dueAtMs: timestampToMsOrNull(r[3]),
    lastSuccessAtMs: timestampToMsOrNull(r[4]),
    lastSeenAtMs: timestampToMsOrNull(r[5]),
    lifetimeCorrect: asNumber(r[6]),
    lifetimeWrong: asNumber(r[7]),
  };
}

const CARD_STATE_COLS =
  'deck_id, card_id, box, due_at, last_success_at, last_seen_at, lifetime_correct, lifetime_wrong';

export async function listCardStates(
  conn: DuckDBConnection,
  deckId: string,
): Promise<CardStateRow[]> {
  const reader = await conn.runAndReadAll(
    `SELECT ${CARD_STATE_COLS} FROM card_state WHERE deck_id = $1 ORDER BY card_id`,
    [deckId],
  );
  return reader.getRows().map(cardStateFromRow);
}

export async function getCardState(
  conn: DuckDBConnection,
  deckId: string,
  cardId: string,
): Promise<CardStateRow | null> {
  const reader = await conn.runAndReadAll(
    `SELECT ${CARD_STATE_COLS} FROM card_state WHERE deck_id = $1 AND card_id = $2`,
    [deckId, cardId],
  );
  const rows = reader.getRows();
  return rows.length === 0 ? null : cardStateFromRow(rows[0]);
}

// ---------------------------------------------------------------------------
// Sessions

export async function insertSession(
  conn: DuckDBConnection,
  session: SessionInsert,
): Promise<void> {
  await conn.run(
    `INSERT INTO sessions (id, deck_id, started_at, ended_at, tag_filter, settings, perfect, jar, kind)
     VALUES ($1, $2, $3, NULL, $4, $5, NULL, NULL, $6)`,
    [
      session.id,
      session.deckId,
      msToTimestamp(session.startedAtMs),
      session.tagFilter === null ? null : JSON.stringify(session.tagFilter),
      JSON.stringify(session.settings),
      session.kind ?? 'drill',
    ],
  );
}

/**
 * Marks a calibration session as completed-with-suggestion. Discarded or
 * insufficient runs keep ended_at NULL — deckSummaries.calibratedAtIso is
 * the latest ENDED calibration session, so only applied runs count.
 */
export async function closeCalibrationSession(
  conn: DuckDBConnection,
  id: string,
  endedAtMs: number,
): Promise<void> {
  await conn.run('UPDATE sessions SET ended_at = $1 WHERE id = $2', [
    msToTimestamp(endedAtMs),
    id,
  ]);
}

/** Latest applied calibration for a deck (see closeCalibrationSession). */
export async function latestCalibrationEndMs(
  conn: DuckDBConnection,
  deckId: string,
): Promise<number | null> {
  const reader = await conn.runAndReadAll(
    `SELECT max(ended_at) FROM sessions
     WHERE deck_id = $1 AND kind = 'calibration' AND ended_at IS NOT NULL`,
    [deckId],
  );
  const v = reader.getRows()[0][0];
  return v === null ? null : timestampToMs(v);
}

/** jar is persisted only for perfect sessions (DESIGN.md schema comment). */
export async function endSession(
  conn: DuckDBConnection,
  id: string,
  endedAtMs: number,
  perfect: boolean,
  jar: (string | null)[],
): Promise<void> {
  await conn.run(
    'UPDATE sessions SET ended_at = $1, perfect = $2, jar = $3 WHERE id = $4',
    [msToTimestamp(endedAtMs), perfect, perfect ? JSON.stringify(jar) : null, id],
  );
}

export interface TrophyRow {
  sessionId: string;
  deckId: string;
  deckName: string;
  endedAtMs: number;
  jar: string[];
}

export async function listTrophies(conn: DuckDBConnection): Promise<TrophyRow[]> {
  const reader = await conn.runAndReadAll(
    `SELECT s.id, s.deck_id, coalesce(d.name, s.deck_id), s.ended_at, s.jar
     FROM sessions s LEFT JOIN decks d ON d.id = s.deck_id
     WHERE s.perfect AND coalesce(s.kind, 'drill') = 'drill'
     ORDER BY s.ended_at DESC`,
  );
  return reader.getRows().map((r) => ({
    sessionId: asString(r[0]),
    deckId: asString(r[1]),
    deckName: asString(r[2]),
    endedAtMs: timestampToMs(r[3]),
    jar: asJson<string[]>(r[4]),
  }));
}

// ---------------------------------------------------------------------------
// Attempts

export async function insertAttempt(
  conn: DuckDBConnection,
  attempt: AttemptInsert,
): Promise<void> {
  await conn.run(
    `INSERT INTO attempts
       (session_id, deck_id, card_id, shown_at, timer_ms, elapsed_ms, response, outcome,
        is_first_of_session, box_before, box_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      attempt.sessionId,
      attempt.deckId,
      attempt.cardId,
      msToTimestamp(attempt.shownAtMs),
      attempt.timerMs,
      attempt.elapsedMs,
      attempt.response,
      attempt.outcome,
      attempt.isFirstOfSession,
      attempt.boxBefore,
      attempt.boxAfter,
    ],
  );
}

export interface AttemptQueryRow extends AttemptInsert {
  id: number;
}

export async function listAttempts(
  conn: DuckDBConnection,
  filter: {
    deckId?: string;
    cardId?: string;
    outcome?: Outcome;
    sinceMs?: number;
    limit?: number;
  } = {},
): Promise<AttemptQueryRow[]> {
  const clauses: string[] = [];
  const params: DuckDBValue[] = [];
  const add = (clause: string, value: DuckDBValue) => {
    params.push(value);
    clauses.push(clause.replace('?', `$${params.length}`));
  };
  if (filter.deckId !== undefined) add('deck_id = ?', filter.deckId);
  if (filter.cardId !== undefined) add('card_id = ?', filter.cardId);
  if (filter.outcome !== undefined) add('outcome = ?', filter.outcome);
  if (filter.sinceMs !== undefined) add('shown_at >= ?', msToTimestamp(filter.sinceMs));
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  params.push(Math.min(filter.limit ?? 1000, 10000));
  const reader = await conn.runAndReadAll(
    `SELECT id, session_id, deck_id, card_id, shown_at, timer_ms, elapsed_ms, response,
            outcome, is_first_of_session, box_before, box_after
     FROM attempts${where} ORDER BY id DESC LIMIT $${params.length}`,
    params,
  );
  return reader.getRows().map((r) => ({
    id: asNumber(r[0]),
    sessionId: asString(r[1]),
    deckId: asString(r[2]),
    cardId: asString(r[3]),
    shownAtMs: timestampToMs(r[4]),
    timerMs: asNumber(r[5]),
    elapsedMs: asNumber(r[6]),
    response: asString(r[7]),
    outcome: asString(r[8]) as Outcome,
    isFirstOfSession: asBoolean(r[9]),
    boxBefore: asNumber(r[10]),
    boxAfter: asNumber(r[11]),
  }));
}
