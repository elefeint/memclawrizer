/**
 * CalibrationManager against real in-memory DuckDB + the mini fixture.
 * The math must mirror src/renderer/mock-api.ts (the executable spec):
 * floor = median of correctly copied trials, window = floor + 1200 ms,
 * base = window / 1.5 to 100 ms in [1500, 10000], applied only with >= 3
 * correct trials. Calibration is not Leitner: zero card_state writes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { openDatabase, Db } from './db';
import { importPack } from './packs';
import { CalibrationManager, suggestBaseTimerMs } from './calibration';
import { SessionManager } from './sessions';
import { attemptRows, cardStats, deckStats, deckSummaries, trophyViews } from './stats';
import { archiveDeck, getDeck, listCardStates } from './queries';
import type { CalibrationTrialResult } from '../shared/api';

const MINI = path.resolve(__dirname, '../../test/fixtures/mini.deckpack');
const T0 = new Date('2026-07-11T09:00:00Z');

const trial = (
  cardId: string,
  text: string,
  elapsedMs: number,
  response = text,
): CalibrationTrialResult => ({ cardId, text, response, elapsedMs });

describe('suggestBaseTimerMs', () => {
  it('mirrors the mock: (floor + 1200) / 1.5, to 100 ms, clamped [1500, 10000]', () => {
    expect(suggestBaseTimerMs(1400)).toBe(1700); // (1400+1200)/1.5 = 1733 → 1700
    expect(suggestBaseTimerMs(1450)).toBe(1800); // 1766.7 → 1800
    expect(suggestBaseTimerMs(0)).toBe(1500); // 800 → clamp up
    expect(suggestBaseTimerMs(100)).toBe(1500); // 866.7 → 900 → clamp up
    expect(suggestBaseTimerMs(60000)).toBe(10000); // clamp down
    expect(suggestBaseTimerMs(3000)).toBe(2800); // 2800 exactly
  });
});

describe('CalibrationManager', () => {
  let db: Db;
  let cal: CalibrationManager;
  let n: number;

  beforeEach(async () => {
    db = await openDatabase(':memory:');
    await importPack(db.conn, MINI, T0);
    n = 0;
    cal = new CalibrationManager(db.conn, {
      now: () => T0,
      rng: () => 0.999999, // identity shuffle: card order = listCards order
      uuid: () => `cal-${++n}`,
    });
  });

  it('start samples canonical answers (all cards when deck < 10) into a kind=calibration session', async () => {
    const start = await cal.start('mini');
    expect(start.sessionId).toBe('cal-1');
    // 4 cards < 10 trials → every card, canonical answer = answers[0].
    expect(start.trials).toEqual([
      { cardId: 'dot', text: 'dot' },
      { cardId: 'ka', text: 'ka' },
      { cardId: 'n', text: 'n' },
      { cardId: 'shi', text: 'shi' },
    ]);
    const row = await db.conn.runAndReadAll(
      `SELECT kind, ended_at FROM sessions WHERE id = 'cal-1'`,
    );
    expect(row.getRows()).toEqual([['calibration', null]]);
  });

  it('applies the suggestion with >= 3 correct trials and stamps calibratedAtIso', async () => {
    const before = await deckSummaries(db.conn, T0);
    expect(before[0].calibratedAtIso).toBeNull();

    const start = await cal.start('mini');
    const result = await cal.submit(start.sessionId, [
      trial('dot', 'dot', 1300),
      trial('ka', 'ka', 1500),
      trial('n', 'n', 1100),
      trial('shi', 'shi', 5000, 'sji'), // mistyped: logged, excluded from floor
    ]);
    // floor = median(1100, 1300, 1500) = 1300 → (1300+1200)/1.5 = 1666.7 → 1700
    expect(result).toEqual({ floorMs: 1300, suggestedBaseTimerMs: 1700, appliedToSettings: true });

    expect((await getDeck(db.conn, 'mini'))?.settings.baseTimerMs).toBe(1700);
    const after = await deckSummaries(db.conn, T0);
    expect(after[0].calibratedAtIso).toBe(T0.toISOString());
  });

  it('with fewer than 3 correct trials: nothing applied, no calibration stamp', async () => {
    const start = await cal.start('mini');
    const baseBefore = (await getDeck(db.conn, 'mini'))?.settings.baseTimerMs;
    const result = await cal.submit(start.sessionId, [
      trial('dot', 'dot', 1000),
      trial('ka', 'ka', 1200),
      trial('n', 'n', 900, 'm'), // wrong
      trial('shi', 'shi', 800, ''), // empty
    ]);
    // floor over the 2 correct = median(1000, 1200) = 1100 (even-length mean).
    expect(result).toEqual({
      floorMs: 1100,
      suggestedBaseTimerMs: suggestBaseTimerMs(1100),
      appliedToSettings: false,
    });
    expect((await getDeck(db.conn, 'mini'))?.settings.baseTimerMs).toBe(baseBefore);
    expect((await deckSummaries(db.conn, T0))[0].calibratedAtIso).toBeNull();
    // Trials are still in the audit log.
    expect(await attemptRows(db.conn, { outcome: 'calibration' })).toHaveLength(4);
  });

  it('copy-match uses shared normalization (case/whitespace forgiving)', async () => {
    const start = await cal.start('mini');
    const result = await cal.submit(start.sessionId, [
      trial('dot', 'dot', 1000, ' DOT '),
      trial('ka', 'ka', 1000, 'Ka'),
      trial('n', 'n', 1000, 'n '),
    ]);
    expect(result.appliedToSettings).toBe(true);
    expect(result.floorMs).toBe(1000);
  });

  it('writes audit rows without touching Leitner: box frozen, zero card_state', async () => {
    const start = await cal.start('mini');
    await cal.submit(start.sessionId, [
      trial('dot', 'dot', 1000),
      trial('ka', 'ka', 999999), // clamped to 60000
      trial('n', 'n', -50), // clamped to 0
    ]);
    const rows = await attemptRows(db.conn, { outcome: 'calibration' });
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.outcome).toBe('calibration');
      expect(r.timerMs).toBe(0);
      expect(r.isFirstOfSession).toBe(false);
      expect(r.boxBefore).toBe(r.boxAfter);
      expect(r.boxBefore).toBe(1); // stateless cards sit in box 1
    }
    expect(rows.map((r) => r.elapsedMs).sort((a, b) => a - b)).toEqual([0, 1000, 60000]);
    expect(await listCardStates(db.conn, 'mini')).toHaveLength(0);
  });

  it('calibration rows never pollute drill medians or the trophy shelf', async () => {
    // A real drill first: one correct answer on 'dot' (2000 ms elapsed).
    const sm = new SessionManager(db.conn, {
      now: () => T0,
      rng: () => 0.999999,
      uuid: () => 'drill-1',
    });
    await sm.start('mini');
    await sm.answer('drill-1', {
      cardId: 'dot', response: 'dot', elapsedMs: 2000, timedOut: false, prize: '🦆',
    });
    await sm.abort('drill-1');

    // Then a calibration with wildly different times on the same card.
    const start = await cal.start('mini');
    await cal.submit(start.sessionId, [
      trial('dot', 'dot', 100),
      trial('ka', 'ka', 100),
      trial('n', 'n', 100),
    ]);

    const ds = await deckStats(db.conn, 'mini', T0);
    expect(ds.dailyMedianElapsed).toEqual([{ dateIso: '2026-07-11', medianMs: 2000 }]);
    const cs = await cardStats(db.conn, 'mini');
    expect(cs.find((c) => c.cardId === 'dot')?.medianElapsedMs).toBe(2000);
    expect(cs.find((c) => c.cardId === 'ka')?.medianElapsedMs).toBeNull();

    // Trophies only ever consider drill sessions.
    expect(await trophyViews(db.conn)).toHaveLength(0);

    // The audit log shows everything and can filter to calibration rows.
    expect(await attemptRows(db.conn, {})).toHaveLength(4);
    expect(await attemptRows(db.conn, { outcome: 'calibration' })).toHaveLength(3);
  });

  it('abort discards: no suggestion, settings untouched, no stamp, submit refused', async () => {
    const start = await cal.start('mini');
    await cal.abort(start.sessionId);
    await expect(cal.submit(start.sessionId, [])).rejects.toThrow(/no active calibration/);
    expect((await deckSummaries(db.conn, T0))[0].calibratedAtIso).toBeNull();
    // The audit row of the discarded run remains, unended.
    const row = await db.conn.runAndReadAll(
      `SELECT ended_at FROM sessions WHERE id = 'cal-1'`,
    );
    expect(row.getRows()).toEqual([[null]]);
  });

  it('recalibration wins: the latest applied run stamps calibratedAtIso and settings', async () => {
    const s1 = await cal.start('mini');
    await cal.submit(s1.sessionId, [
      trial('dot', 'dot', 1000), trial('ka', 'ka', 1000), trial('n', 'n', 1000),
    ]);
    const later = new Date(T0.getTime() + 3600_000);
    const cal2 = new CalibrationManager(db.conn, {
      now: () => later,
      rng: () => 0.999999,
      uuid: () => 'cal-2nd',
    });
    const s2 = await cal2.start('mini');
    await cal2.submit(s2.sessionId, [
      trial('dot', 'dot', 3000), trial('ka', 'ka', 3000), trial('n', 'n', 3000),
    ]);
    expect((await getDeck(db.conn, 'mini'))?.settings.baseTimerMs).toBe(2800);
    expect((await deckSummaries(db.conn, T0))[0].calibratedAtIso).toBe(later.toISOString());
  });

  it('samples exactly 10 of a bigger deck, canonical answers only', async () => {
    const DECKS = path.resolve(__dirname, '../../decks/kana-hiragana.deckpack');
    await importPack(db.conn, DECKS, T0);
    const start = await cal.start('kana-hiragana-v1');
    expect(start.trials).toHaveLength(10);
    const unique = new Set(start.trials.map((t) => t.cardId));
    expect(unique.size).toBe(10);
  });

  it('refuses unknown and archived decks', async () => {
    await expect(cal.start('nope')).rejects.toThrow(/unknown deck/);
    await archiveDeck(db.conn, 'mini', T0.getTime());
    await expect(cal.start('mini')).rejects.toThrow(/archived/);
  });
});
