/**
 * Hall of Fame aggregates (contract #6) against real DuckDB: real drill
 * sessions on two local days, an interleaved calibration run that must not
 * pollute any figure, an archived deck that must still rank, and the
 * empty-DB case.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openDatabase, Db } from './db';
import { importPack } from './packs';
import { SessionManager } from './sessions';
import { CalibrationManager } from './calibration';
import { records } from './stats';
import { archiveDeck, getCardState, upsertCardState } from './queries';

const MINI = path.resolve(__dirname, '../../test/fixtures/mini.deckpack');
// Local-component dates: local-day grouping must be timezone-independent.
const DAY1 = new Date(2026, 7, 1, 9, 0, 0);
const DAY2 = new Date(2026, 7, 2, 9, 0, 0);

const noShuffle = () => 0.999999; // queue order = listCards order: dot, ka, n, shi

function manager(db: Db, nowRef: { now: Date }, prefix: string): SessionManager {
  let n = 0;
  return new SessionManager(db.conn, {
    now: () => nowRef.now,
    rng: noShuffle,
    uuid: () => `${prefix}-${++n}`,
  });
}

describe('records (Hall of Fame)', () => {
  it('returns nulls, zeros, and an empty ranking on an empty DB', async () => {
    const db = await openDatabase(':memory:');
    expect(await records(db.conn)).toEqual({
      deckScores: [],
      fastestCorrect: null,
      largestPerfectSession: null,
      busiestDay: null,
      daysPracticed: 0,
      totalAttempts: 0,
    });
  });

  it('aggregates across days and decks, excluding calibration everywhere', async () => {
    const db = await openDatabase(':memory:');
    await importPack(db.conn, MINI, DAY1);
    const nowRef = { now: DAY1 };

    // Day 1, first: a calibration run with absurdly fast trials — if any
    // figure counted calibration, it would dominate fastest/busiest/totals.
    const cal = new CalibrationManager(db.conn, {
      now: () => DAY1,
      rng: noShuffle,
      uuid: () => 'cal-1',
    });
    const c = await cal.start('mini');
    await cal.submit(
      c.sessionId,
      c.trials.map((t) => ({ cardId: t.cardId, text: t.text, response: t.text, elapsedMs: 10 })),
    );

    // Day 1: a PERFECT session (4 correct first attempts; fastest = ka @ 800).
    const sm = manager(db, nowRef, 'day1');
    await sm.start('mini');
    const elapsed: Record<string, number> = { dot: 1200, ka: 800, n: 1500, shi: 2000 };
    for (const id of ['dot', 'ka', 'n', 'shi']) {
      await sm.answer('day1-1', {
        cardId: id, response: id, elapsedMs: elapsed[id], timedOut: false, prize: '⭐',
      });
    }

    // Day 2: an imperfect session — first card wrong, three correct, then the
    // retry clears at 100 ms (faster than ka, but is_first=false: must not win).
    nowRef.now = DAY2;
    const sm2 = manager(db, nowRef, 'day2');
    const start2 = await sm2.start('mini');
    expect(start2.queueLength).toBe(4); // all due (box 2, +1 day)
    await sm2.answer('day2-1', { cardId: 'dot', response: 'zzz', elapsedMs: 3000, timedOut: false, prize: null });
    for (const id of ['ka', 'n', 'shi']) {
      await sm2.answer('day2-1', { cardId: id, response: id, elapsedMs: 1000, timedOut: false, prize: '⭐' });
    }
    await sm2.answer('day2-1', { cardId: 'dot', response: 'dot', elapsedMs: 100, timedOut: false, prize: null });

    // Master one card by hand (box 5) and archive the deck; then re-import →
    // fresh mini#2 with no history. Archived decks must still rank.
    const dot = await getCardState(db.conn, 'mini', 'dot');
    await upsertCardState(db.conn, { ...(dot as NonNullable<typeof dot>), box: 5 });
    await archiveDeck(db.conn, 'mini', DAY2.getTime());
    await importPack(db.conn, MINI, DAY2);

    const hof = await records(db.conn);

    expect(hof.deckScores).toEqual([
      {
        deckId: 'mini',
        deckName: 'Mini fixture deck',
        archived: true,
        sealedJars: 1,
        masteredCards: 1,
        lifetimeAttempts: 9, // 4 + 5 drill attempts; 4 calibration trials excluded
      },
      {
        deckId: 'mini#2',
        deckName: 'Mini fixture deck',
        archived: false,
        sealedJars: 0,
        masteredCards: 0,
        lifetimeAttempts: 0,
      },
    ]);

    // ka @ 800 on day 1 — not the 10 ms calibration copies, not the 100 ms retry.
    expect(hof.fastestCorrect).toMatchObject({
      deckName: 'Mini fixture deck',
      promptPreview: 'か',
      elapsedMs: 800,
    });
    expect(hof.fastestCorrect?.dateIso.slice(0, 10)).toBe(
      `${DAY1.getFullYear()}-08-01`,
    );

    expect(hof.largestPerfectSession).toMatchObject({
      deckName: 'Mini fixture deck',
      size: 4,
    });

    // Day 1 would hold 8 rows if calibration counted (4 + 4 trials) and win;
    // excluded, day 2's five drill attempts take it.
    expect(hof.busiestDay).toEqual({
      dateIso: `${DAY2.getFullYear()}-08-02`,
      attempts: 5,
    });
    expect(hof.daysPracticed).toBe(2);
    expect(hof.totalAttempts).toBe(9);
  });
});
