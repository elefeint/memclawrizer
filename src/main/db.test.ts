import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { openDatabase, MIGRATIONS, SCHEMA_VERSION } from './db';

describe('openDatabase', () => {
  it('migrates a fresh database to the latest schema', async () => {
    const db = await openDatabase(':memory:');
    const version = await db.conn.runAndReadAll('SELECT version FROM schema_version');
    expect(Number(version.getRows()[0][0])).toBe(SCHEMA_VERSION);

    const reader = await db.conn.runAndReadAll(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'main' ORDER BY table_name`,
    );
    const tables = reader.getRows().map((r) => String(r[0]));
    for (const t of ['attempts', 'card_state', 'cards', 'decks', 'media', 'schema_version', 'sessions']) {
      expect(tables).toContain(t);
    }
  });

  it('reopening an up-to-date file is a no-op and preserves data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memclawrizer-test-'));
    const file = join(dir, 'reopen.duckdb');
    try {
      const db1 = await openDatabase(file);
      await db1.conn.run(
        `INSERT INTO decks (id, name, description, settings, format_version, imported_at, pack_id)
         VALUES ('d1', 'Deck', NULL, '{}', 1, TIMESTAMP '2026-07-05 09:00:00', 'd1')`,
      );
      db1.conn.closeSync();
      db1.instance.closeSync();

      const db2 = await openDatabase(file);
      const version = await db2.conn.runAndReadAll('SELECT version FROM schema_version');
      expect(version.getRows()).toEqual([[SCHEMA_VERSION]]);
      const decks = await db2.conn.runAndReadAll('SELECT id FROM decks');
      expect(decks.getRows()).toEqual([['d1']]);
      db2.conn.closeSync();
      db2.instance.closeSync();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats an empty schema_version table as version 0 and migrates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memclawrizer-test-'));
    const file = join(dir, 'empty-version.duckdb');
    try {
      const instance = await DuckDBInstance.create(file);
      const conn = await instance.connect();
      await conn.run('CREATE TABLE schema_version(version INTEGER NOT NULL)');
      conn.closeSync();
      instance.closeSync();

      const db = await openDatabase(file);
      const version = await db.conn.runAndReadAll('SELECT version FROM schema_version');
      expect(version.getRows()).toEqual([[SCHEMA_VERSION]]);
      db.conn.closeSync();
      db.instance.closeSync();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates a schema-v1 file to latest, preserving data (v2 audio col, v3 pack_id backfill)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memclawrizer-test-'));
    const file = join(dir, 'v1.duckdb');
    try {
      // Build a real historical v1 file with data, exactly as the v1 app did.
      const instance = await DuckDBInstance.create(file);
      const conn = await instance.connect();
      await MIGRATIONS[0](conn);
      await conn.run('CREATE TABLE schema_version(version INTEGER NOT NULL)');
      await conn.run('INSERT INTO schema_version VALUES (1)');
      await conn.run(
        `INSERT INTO decks VALUES ('d1', 'Deck', NULL, '{}', 1, TIMESTAMP '2026-07-05 09:00:00')`,
      );
      await conn.run(
        `INSERT INTO cards (deck_id, id, prompt_type, prompt_text, media_id, answers, hint, tags)
         VALUES ('d1', 'c1', 'text', 'し', NULL, '["shi"]', NULL, '[]')`,
      );
      await conn.run(
        `INSERT INTO card_state VALUES ('d1', 'c1', 3, TIMESTAMP '2026-07-08 09:00:00',
           TIMESTAMP '2026-07-05 09:00:00', TIMESTAMP '2026-07-05 09:00:00', 4, 1)`,
      );
      conn.closeSync();
      instance.closeSync();

      const db = await openDatabase(file);
      const version = await db.conn.runAndReadAll('SELECT version FROM schema_version');
      expect(version.getRows()).toEqual([[SCHEMA_VERSION]]);
      const cards = await db.conn.runAndReadAll(
        'SELECT id, prompt_text, answer_media_id, active FROM cards',
      );
      expect(cards.getRows()).toEqual([['c1', 'し', null, true]]);
      const state = await db.conn.runAndReadAll('SELECT box, lifetime_correct FROM card_state');
      expect(state.getRows()).toEqual([[3, 4]]);
      // v3: pack_id backfilled from id, nothing archived retroactively.
      const decks = await db.conn.runAndReadAll('SELECT id, pack_id, archived_at FROM decks');
      expect(decks.getRows()).toEqual([['d1', 'd1', null]]);
      db.conn.closeSync();
      db.instance.closeSync();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates a schema-v2 file to v3, backfilling pack_id and leaving archived_at NULL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memclawrizer-test-'));
    const file = join(dir, 'v2.duckdb');
    try {
      const instance = await DuckDBInstance.create(file);
      const conn = await instance.connect();
      await MIGRATIONS[0](conn);
      await MIGRATIONS[1](conn);
      await conn.run('CREATE TABLE schema_version(version INTEGER NOT NULL)');
      await conn.run('INSERT INTO schema_version VALUES (2)');
      await conn.run(
        `INSERT INTO decks VALUES ('kana-v1', 'Kana', NULL, '{}', 2, TIMESTAMP '2026-07-09 09:00:00')`,
      );
      conn.closeSync();
      instance.closeSync();

      const db = await openDatabase(file);
      const version = await db.conn.runAndReadAll('SELECT version FROM schema_version');
      expect(version.getRows()).toEqual([[SCHEMA_VERSION]]);
      const decks = await db.conn.runAndReadAll('SELECT id, pack_id, archived_at, name FROM decks');
      expect(decks.getRows()).toEqual([['kana-v1', 'kana-v1', null, 'Kana']]);
      db.conn.closeSync();
      db.instance.closeSync();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates a schema-v3 file to v4: sessions gain kind, existing rows read as drill', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memclawrizer-test-'));
    const file = join(dir, 'v3.duckdb');
    try {
      const instance = await DuckDBInstance.create(file);
      const conn = await instance.connect();
      await MIGRATIONS[0](conn);
      await MIGRATIONS[1](conn);
      await MIGRATIONS[2](conn);
      await conn.run('CREATE TABLE schema_version(version INTEGER NOT NULL)');
      await conn.run('INSERT INTO schema_version VALUES (3)');
      await conn.run(
        `INSERT INTO sessions (id, deck_id, started_at, ended_at, tag_filter, settings, perfect, jar)
         VALUES ('s1', 'd1', TIMESTAMP '2026-07-10 09:00:00', TIMESTAMP '2026-07-10 09:05:00',
                 NULL, '{}', true, '["🏆"]')`,
      );
      conn.closeSync();
      instance.closeSync();

      const db = await openDatabase(file);
      const version = await db.conn.runAndReadAll('SELECT version FROM schema_version');
      expect(version.getRows()).toEqual([[SCHEMA_VERSION]]);
      const rows = await db.conn.runAndReadAll(
        `SELECT id, coalesce(kind, 'drill'), perfect FROM sessions`,
      );
      expect(rows.getRows()).toEqual([['s1', 'drill', true]]);
      db.conn.closeSync();
      db.instance.closeSync();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a file written by a newer schema', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memclawrizer-test-'));
    const file = join(dir, 'newer.duckdb');
    try {
      const instance = await DuckDBInstance.create(file);
      const conn = await instance.connect();
      await conn.run('CREATE TABLE schema_version(version INTEGER NOT NULL)');
      await conn.run(`INSERT INTO schema_version VALUES (${SCHEMA_VERSION + 1})`);
      conn.closeSync();
      instance.closeSync();

      await expect(openDatabase(file)).rejects.toThrow(/newer|Update the app/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
