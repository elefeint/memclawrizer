/**
 * Practice attendance (contract #8) against real DuckDB. Attempts are written
 * straight into the table so a test can span months cheaply; the local-day
 * grouping is the same one records() uses, so both must agree.
 *
 * All dates are built from LOCAL components — the grouping is by local
 * calendar day and must be timezone- (and DST-) independent.
 */
import { describe, it, expect } from 'vitest';
import { openDatabase, Db } from './db';
import { insertAttempt } from './queries';
import { practiceHistory, records } from './stats';
import type { Outcome } from '../shared/api';

const NOW = new Date(2026, 7, 2, 10, 0, 0); // 2026-08-02, 10:00 local

/** Local midnight-anchored date `back` whole days before NOW (DST-safe). */
function dayBack(back: number, hour = 9): Date {
  const d = new Date(NOW);
  d.setDate(d.getDate() - back);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function keyBack(back: number): string {
  const d = dayBack(back);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function attemptsOn(
  db: Db,
  back: number,
  count = 1,
  outcome: Outcome = 'correct',
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await insertAttempt(db.conn, {
      sessionId: `s-${back}`,
      deckId: 'mini',
      cardId: `c-${i}`,
      shownAtMs: dayBack(back).getTime() + i * 60_000,
      timerMs: 5000,
      elapsedMs: 1000,
      response: 'x',
      outcome,
      isFirstOfSession: true,
      boxBefore: 1,
      boxAfter: 2,
    });
  }
}

describe('practiceHistory (contract #8)', () => {
  it('returns zeros and a full strip of zero days on an empty DB', async () => {
    const db = await openDatabase(':memory:');
    const h = await practiceHistory(db.conn, NOW);
    expect(h.currentStreakDays).toBe(0);
    expect(h.longestStreakDays).toBe(0);
    expect(h.days).toHaveLength(30);
    expect(h.days.every((d) => d.attempts === 0)).toBe(true);
    // Oldest first, ending today.
    expect(h.days[0].dateIso).toBe(keyBack(29));
    expect(h.days[29].dateIso).toBe(keyBack(0));
  });

  it('counts a clean run back from today and agrees with records()', async () => {
    const db = await openDatabase(':memory:');
    for (const back of [0, 1, 2, 3, 4]) await attemptsOn(db, back, back + 1);

    const h = await practiceHistory(db.conn, NOW);
    expect(h.currentStreakDays).toBe(5);
    expect(h.longestStreakDays).toBe(5);
    expect(h.days).toHaveLength(30);
    expect(h.days[29]).toEqual({ dateIso: keyBack(0), attempts: 1 });
    expect(h.days[25]).toEqual({ dateIso: keyBack(4), attempts: 5 });
    expect(h.days[24]).toEqual({ dateIso: keyBack(5), attempts: 0 });

    // Same local-day grouping as the Hall of Fame.
    const hof = await records(db.conn);
    expect(hof.daysPracticed).toBe(h.days.filter((d) => d.attempts > 0).length);
    expect(hof.totalAttempts).toBe(h.days.reduce((a, d) => a + d.attempts, 0));
  });

  it('a missed day breaks the current streak but keeps the longer run visible', async () => {
    const db = await openDatabase(':memory:');
    for (const back of [0, 1, 2, 4, 5, 6, 7]) await attemptsOn(db, back);

    const h = await practiceHistory(db.conn, NOW);
    expect(h.currentStreakDays).toBe(3); // today, -1, -2 (gap at -3)
    expect(h.longestStreakDays).toBe(4); // -4..-7
    // The gap is a visible hole in the strip, not a break in it.
    expect(h.days[26]).toEqual({ dateIso: keyBack(3), attempts: 0 });
    expect(h.days[25].attempts).toBe(1);
  });

  it('reports yesterday-anchored streaks when today has no practice yet', async () => {
    const db = await openDatabase(':memory:');
    for (const back of [1, 2, 3]) await attemptsOn(db, back);

    const h = await practiceHistory(db.conn, NOW);
    expect(h.currentStreakDays).toBe(3); // counted back from yesterday
    expect(h.longestStreakDays).toBe(3);
    expect(h.days[29]).toEqual({ dateIso: keyBack(0), attempts: 0 });
  });

  it('reports 0 when neither today nor yesterday has a drill attempt', async () => {
    const db = await openDatabase(':memory:');
    for (const back of [2, 3, 4]) await attemptsOn(db, back);

    const h = await practiceHistory(db.conn, NOW);
    expect(h.currentStreakDays).toBe(0);
    expect(h.longestStreakDays).toBe(3);
  });

  it('finds the longest streak in history older than the 30-day window', async () => {
    const db = await openDatabase(':memory:');
    for (let back = 100; back >= 90; back--) await attemptsOn(db, back); // 11 days
    for (const back of [0, 1]) await attemptsOn(db, back);

    const h = await practiceHistory(db.conn, NOW);
    expect(h.currentStreakDays).toBe(2);
    expect(h.longestStreakDays).toBe(11);
    // ...while the strip still only shows the last 30 days.
    expect(h.days.filter((d) => d.attempts > 0)).toHaveLength(2);
  });

  it('never counts calibration attempts, so they cannot bridge a gap', async () => {
    const db = await openDatabase(':memory:');
    await attemptsOn(db, 0);
    await attemptsOn(db, 1);
    await attemptsOn(db, 2, 5, 'calibration'); // typing test, not practice
    await attemptsOn(db, 3);

    const h = await practiceHistory(db.conn, NOW);
    expect(h.currentStreakDays).toBe(2); // today + yesterday only
    expect(h.longestStreakDays).toBe(2);
    expect(h.days[27]).toEqual({ dateIso: keyBack(2), attempts: 0 });
    expect(h.days[26]).toEqual({ dateIso: keyBack(3), attempts: 1 });
  });

  it('counts calendar days across a DST spring-forward, not 24-hour blocks', async () => {
    // 2026-03-08 is the US spring-forward: that local day is only 23 hours
    // long, so ms-based day math would mis-bucket it.
    const saved = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const db = await openDatabase(':memory:');
      for (const day of [6, 7, 8, 9]) {
        await insertAttempt(db.conn, {
          sessionId: `dst-${day}`, deckId: 'mini', cardId: 'c1',
          shownAtMs: new Date(2026, 2, day, 9, 0, 0).getTime(),
          timerMs: 5000, elapsedMs: 1000, response: 'x', outcome: 'correct',
          isFirstOfSession: true, boxBefore: 1, boxAfter: 2,
        });
      }
      const h = await practiceHistory(db.conn, new Date(2026, 2, 9, 10, 0, 0));
      expect(h.currentStreakDays).toBe(4);
      expect(h.longestStreakDays).toBe(4);
      expect(h.days.slice(26).map((d) => d.dateIso)).toEqual([
        '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09',
      ]);
      expect(h.days.slice(26).every((d) => d.attempts === 1)).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  it('counts a day drilled across several decks once, with attempts summed', async () => {
    const db = await openDatabase(':memory:');
    await attemptsOn(db, 0, 2);
    await insertAttempt(db.conn, {
      sessionId: 'other-deck', deckId: 'piano', cardId: 'c1',
      shownAtMs: dayBack(0, 21).getTime(), timerMs: 5000, elapsedMs: 900,
      response: 'x', outcome: 'wrong', isFirstOfSession: true, boxBefore: 2, boxAfter: 1,
    });

    const h = await practiceHistory(db.conn, NOW);
    expect(h.days[29]).toEqual({ dateIso: keyBack(0), attempts: 3 });
    expect(h.currentStreakDays).toBe(1);
  });
});
