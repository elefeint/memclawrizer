/**
 * Dev tool: import a .deckpack (zip or directory) into a memclawrizer DB
 * without launching the app. Used to seed the real userData DB for manual
 * verification, and handy for batch-importing the generated starter decks.
 *
 *   npx tsx scripts/import-pack.ts <pack-path> [db-path]
 *
 * db-path defaults to the dev userData location on Linux
 * (~/.config/memclawrizer/memclawrizer.duckdb). Do NOT run while the app has
 * the same DB open — DuckDB is single-writer.
 */
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/main/db';
import { importPack } from '../src/main/packs';

async function main(): Promise<void> {
  const [packPath, dbPathArg] = process.argv.slice(2);
  if (!packPath) {
    console.error('usage: npx tsx scripts/import-pack.ts <pack-path> [db-path]');
    process.exit(2);
  }
  const dbPath =
    dbPathArg ?? path.join(os.homedir(), '.config', 'memclawrizer', 'memclawrizer.duckdb');

  const db = await openDatabase(dbPath);
  try {
    const result = await importPack(db.conn, path.resolve(packPath), new Date());
    console.log(
      `[import-pack] ${result.deckId} ("${result.name}") into ${dbPath}: ` +
        `${result.cardsAdded} added, ${result.cardsUpdated} updated` +
        (result.orphanedCardIds.length > 0
          ? `, orphaned in DB: ${result.orphanedCardIds.join(', ')}`
          : ''),
    );
  } finally {
    db.conn.closeSync();
    db.instance.closeSync();
  }
}

main().catch((e) => {
  console.error(`[import-pack] failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
