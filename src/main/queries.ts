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
  id: string;
  name: string;
  description: string | null;
  settings: DeckSettings;
  formatVersion: number;
  importedAtMs: number;
}

export interface CardRow {
  deckId: string;
  id: string;
  promptType: string;
  promptText: string | null;
  mediaId: string | null;
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
    `INSERT INTO decks (id, name, description, settings, format_version, imported_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       settings = excluded.settings,
       format_version = excluded.format_version,
       imported_at = excluded.imported_at`,
    [
      deck.id,
      deck.name,
      deck.description,
      JSON.stringify(deck.settings),
      deck.formatVersion,
      msToTimestamp(deck.importedAtMs),
    ],
  );
}

function deckFromRow(r: DuckDBValue[]): DeckRow {
  return {
    id: asString(r[0]),
    name: asString(r[1]),
    description: asStringOrNull(r[2]),
    settings: asJson<DeckSettings>(r[3]),
    formatVersion: asNumber(r[4]),
    importedAtMs: timestampToMs(r[5]),
  };
}

const DECK_COLS = 'id, name, description, settings, format_version, imported_at';

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
    `INSERT INTO cards (deck_id, id, prompt_type, prompt_text, media_id, answers, hint, tags, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (deck_id, id) DO UPDATE SET
       prompt_type = excluded.prompt_type,
       prompt_text = excluded.prompt_text,
       media_id = excluded.media_id,
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
    answers: asJson<string[]>(r[5]),
    hint: asStringOrNull(r[6]),
    tags: asJson<string[]>(r[7]),
    active: asBoolean(r[8]),
  };
}

const CARD_COLS = 'deck_id, id, prompt_type, prompt_text, media_id, answers, hint, tags, active';

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

/** Media ids no longer referenced by any card of the deck (after re-import). */
export async function deleteUnreferencedMedia(
  conn: DuckDBConnection,
  deckId: string,
): Promise<void> {
  await conn.run(
    `DELETE FROM media WHERE deck_id = $1
       AND id NOT IN (SELECT media_id FROM cards WHERE deck_id = $1 AND media_id IS NOT NULL)`,
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
    `INSERT INTO sessions (id, deck_id, started_at, ended_at, tag_filter, settings, perfect, jar)
     VALUES ($1, $2, $3, NULL, $4, $5, NULL, NULL)`,
    [
      session.id,
      session.deckId,
      msToTimestamp(session.startedAtMs),
      session.tagFilter === null ? null : JSON.stringify(session.tagFilter),
      JSON.stringify(session.settings),
    ],
  );
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
     WHERE s.perfect ORDER BY s.ended_at DESC`,
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
