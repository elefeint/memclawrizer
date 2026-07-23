/**
 * Database open + hand-rolled migrations (pattern shared with the author's earlier project):
 * a single-row schema_version table plus an ordered array of migration
 * functions run in a transaction on open. Newer app migrates older files;
 * older app refuses newer files. New files are created at the latest version
 * by running every migration in order.
 *
 * The db path is injected so tests can use ':memory:'.
 */
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';

export interface Db {
  instance: DuckDBInstance;
  conn: DuckDBConnection;
}

/** Exported for tests only: lets a test build a historical-version DB. */
export const MIGRATIONS: Array<(conn: DuckDBConnection) => Promise<void>> = [
  migrateV1,
  migrateV2,
  migrateV3,
  migrateV4,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function openDatabase(path: string): Promise<Db> {
  const instance = await DuckDBInstance.create(path);
  const conn = await instance.connect();
  await migrate(conn);
  return { instance, conn };
}

async function migrate(conn: DuckDBConnection): Promise<void> {
  await conn.run('CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL)');
  const reader = await conn.runAndReadAll('SELECT version FROM schema_version');
  const rows = reader.getRows();
  const current = rows.length === 0 ? 0 : Number(rows[0][0]);

  if (current > SCHEMA_VERSION) {
    throw new Error(
      `This file uses schema v${current}, but this build of memclawrizer only ` +
        `knows v${SCHEMA_VERSION}. Update the app to open this file.`,
    );
  }
  if (current === SCHEMA_VERSION) return;

  await conn.run('BEGIN TRANSACTION');
  try {
    for (let v = current; v < SCHEMA_VERSION; v++) {
      await MIGRATIONS[v](conn);
    }
    await conn.run('DELETE FROM schema_version');
    await conn.run(`INSERT INTO schema_version VALUES (${SCHEMA_VERSION})`);
    await conn.run('COMMIT');
  } catch (e) {
    await conn.run('ROLLBACK');
    throw e;
  }
}

/** v4 (2026-07-11): timer calibration — sessions get a kind so calibration
 * runs live in the same audit trail without being drills (DESIGN.md "Timer
 * calibration"). NULL reads as 'drill' (pre-v4 rows). */
async function migrateV4(conn: DuckDBConnection): Promise<void> {
  await conn.run("ALTER TABLE sessions ADD COLUMN kind TEXT DEFAULT 'drill'");
}

/** v3 (2026-07-10): archivable decks — internal id splits from the pack's
 * author id (DESIGN.md "Deck lifecycle: archiving"). Existing rows keep
 * their id as pack_id; nothing is archived retroactively. */
async function migrateV3(conn: DuckDBConnection): Promise<void> {
  await conn.run('ALTER TABLE decks ADD COLUMN pack_id TEXT');
  await conn.run('ALTER TABLE decks ADD COLUMN archived_at TIMESTAMP');
  await conn.run('UPDATE decks SET pack_id = id');
}

/** v2 (2026-07-08): answer-side audio — pack format v2, DESIGN.md. */
async function migrateV2(conn: DuckDBConnection): Promise<void> {
  await conn.run('ALTER TABLE cards ADD COLUMN answer_media_id TEXT');
}

/** v1: the full schema from DESIGN.md. */
async function migrateV1(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE TABLE decks(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      settings JSON NOT NULL,
      format_version INTEGER NOT NULL,
      imported_at TIMESTAMP NOT NULL
    )`);
  await conn.run(`
    CREATE TABLE media(
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes BLOB NOT NULL
    )`);
  await conn.run(`
    CREATE TABLE cards(
      deck_id TEXT NOT NULL,
      id TEXT NOT NULL,
      prompt_type TEXT NOT NULL,
      prompt_text TEXT,
      media_id TEXT,
      answers JSON NOT NULL,
      hint TEXT,
      tags JSON NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      PRIMARY KEY (deck_id, id)
    )`);
  await conn.run(`
    CREATE TABLE card_state(
      deck_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      box SMALLINT NOT NULL,
      due_at TIMESTAMP,
      last_success_at TIMESTAMP,
      last_seen_at TIMESTAMP,
      lifetime_correct INTEGER NOT NULL DEFAULT 0,
      lifetime_wrong INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (deck_id, card_id)
    )`);
  await conn.run(`
    CREATE TABLE sessions(
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL,
      started_at TIMESTAMP NOT NULL,
      ended_at TIMESTAMP,
      tag_filter JSON,
      settings JSON NOT NULL,
      perfect BOOLEAN,
      jar JSON
    )`);
  await conn.run('CREATE SEQUENCE attempt_seq');
  await conn.run(`
    CREATE TABLE attempts(
      id BIGINT PRIMARY KEY DEFAULT nextval('attempt_seq'),
      session_id TEXT NOT NULL,
      deck_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      shown_at TIMESTAMP NOT NULL,
      timer_ms INTEGER NOT NULL,
      elapsed_ms INTEGER NOT NULL,
      response TEXT NOT NULL,
      outcome TEXT NOT NULL,
      is_first_of_session BOOLEAN NOT NULL,
      box_before SMALLINT NOT NULL,
      box_after SMALLINT NOT NULL
    )`);
}
