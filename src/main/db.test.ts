import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { openDatabase, SCHEMA_VERSION } from './db';

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
