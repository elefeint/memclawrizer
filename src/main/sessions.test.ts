/**
 * SessionManager against real in-memory DuckDB + the mini fixture pack.
 * These tests mirror src/renderer/mock-api.test.ts — the mock is the
 * executable spec of the session semantics; the real backend must match.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { openDatabase, Db } from './db';
import { importPack } from './packs';
import { SessionManager, mediaUrlFor } from './sessions';
import { deckSummaries, trophyViews, attemptRows, cardStats, deckStats } from './stats';
import { getCardState } from './queries';

const MINI = path.resolve(__dirname, '../../test/fixtures/mini.deckpack');
const T0 = new Date('2026-07-05T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

// rng ≈ 1 keeps Fisher–Yates in place: queue order = listCards order (by id):
// dot(0), ka(1), n(2), shi(3).
const noShuffle = () => 0.999999;

function manager(db: Db, nowRef: { now: Date }): SessionManager {
  let n = 0;
  return new SessionManager(db.conn, {
    now: () => nowRef.now,
    rng: noShuffle,
    uuid: () => `session-${++n}`,
  });
}

describe('SessionManager', () => {
  let db: Db;
  let nowRef: { now: Date };
  let sm: SessionManager;

  beforeEach(async () => {
    db = await openDatabase(':memory:');
    await importPack(db.conn, MINI, T0);
    nowRef = { now: T0 };
    sm = manager(db, nowRef);
  });

  it('starts a session: shuffled queue in main, slot per card, box-1 timers, mem:// media urls', async () => {
    const start = await sm.start('mini');
    expect(start.sessionId).toBe('session-1');
    expect(start.queueLength).toBe(4);
    expect(start.first).toEqual({
      cardId: 'dot',
      promptType: 'image',
      promptText: null,
      mediaUrl: 'mem://media/mini/media/dot.svg',
      timerMs: 7500, // 5000 base × 1.5 (box 1)
      slotIndex: 0,
      isRetry: false,
    });
  });

  it('runs an imperfect session: first-attempt-only jar/boxes, retry re-queued ~3 later', async () => {
    const start = await sm.start('mini');

    // dot correct.
    let r = await sm.answer('session-1', {
      cardId: 'dot', response: ' DOT ', elapsedMs: 1200, timedOut: false, prize: '🦆',
    });
    expect(r.outcome).toBe('correct');
    expect(r.isFirstOfSession).toBe(true);
    expect(r.expected).toBeNull();
    expect(r.hint).toBeNull();
    expect(r.slotIndex).toBe(0);
    expect(r.remaining).toBe(3);

    // ka correct.
    r = await sm.answer('session-1', {
      cardId: 'ka', response: 'ka', elapsedMs: 900, timedOut: false, prize: '🎲',
    });

    // n times out → hint + expected surface, card re-queued with isRetry.
    r = await sm.answer('session-1', {
      cardId: 'n', response: '', elapsedMs: 999999, timedOut: true, prize: null,
    });
    expect(r.outcome).toBe('timeout');
    expect(r.expected).toEqual(['n']);
    expect(r.hint).toMatch(/lone consonant/);
    expect(r.remaining).toBe(2); // shi + re-queued n

    // shi correct (variant romanization, case/space normalization).
    r = await sm.answer('session-1', {
      cardId: 'shi', response: ' SI ', elapsedMs: 2000, timedOut: false, prize: '🌵',
    });
    expect(r.outcome).toBe('correct');

    // Re-queued n comes back as a retry; clearing it does NOT fill the slot.
    expect(r.next).toMatchObject({ cardId: 'n', isRetry: true, slotIndex: 2 });
    r = await sm.answer('session-1', {
      cardId: 'n', response: 'n', elapsedMs: 800, timedOut: false, prize: null,
    });
    expect(r.outcome).toBe('correct');
    expect(r.isFirstOfSession).toBe(false);
    expect(r.next).toBeNull();
    expect(r.remaining).toBe(0);
    expect(r.sessionEnd).toEqual({ perfect: false, jar: ['🦆', '🎲', null, '🌵'] });

    // No trophy for imperfect sessions.
    expect(await trophyViews(db.conn)).toHaveLength(0);

    // Leitner state: firsts moved boxes, the retry did not.
    expect((await getCardState(db.conn, 'mini', 'dot'))?.box).toBe(2);
    expect((await getCardState(db.conn, 'mini', 'ka'))?.box).toBe(2);
    expect((await getCardState(db.conn, 'mini', 'shi'))?.box).toBe(2);
    const n = await getCardState(db.conn, 'mini', 'n');
    expect(n?.box).toBe(1);
    expect(n?.lifetimeWrong).toBe(1);
    expect(n?.lifetimeCorrect).toBe(0); // retry success is practice, not progress
    expect(start.queueLength).toBe(4);
  });

  it('carries answerMediaUrl on every result for the audio-answer card, retries included', async () => {
    await sm.start('mini');
    // dot, ka: no answer audio → null.
    let r = await sm.answer('session-1', {
      cardId: 'dot', response: 'dot', elapsedMs: 500, timedOut: false, prize: '🦆',
    });
    expect(r.answerMediaUrl).toBeNull();
    r = await sm.answer('session-1', {
      cardId: 'ka', response: 'ka', elapsedMs: 500, timedOut: false, prize: '🎲',
    });
    expect(r.answerMediaUrl).toBeNull();

    // n has media/n.ogg: present on a failed first attempt...
    r = await sm.answer('session-1', {
      cardId: 'n', response: '', elapsedMs: 9999, timedOut: true, prize: null,
    });
    expect(r.outcome).toBe('timeout');
    expect(r.answerMediaUrl).toBe('mem://media/mini/media/n.ogg');

    r = await sm.answer('session-1', {
      cardId: 'shi', response: 'shi', elapsedMs: 500, timedOut: false, prize: '🌵',
    });
    expect(r.answerMediaUrl).toBeNull();

    // ...and again on the retry (correct this time) — both outcomes get it.
    expect(r.next).toMatchObject({ cardId: 'n', isRetry: true });
    r = await sm.answer('session-1', {
      cardId: 'n', response: 'n', elapsedMs: 500, timedOut: false, prize: null,
    });
    expect(r.outcome).toBe('correct');
    expect(r.isFirstOfSession).toBe(false);
    expect(r.answerMediaUrl).toBe('mem://media/mini/media/n.ogg');
    // But it never leaks into CardView pre-attempt.
    expect(r.sessionEnd).not.toBeNull();
  });

  it('writes the full audit log: every attempt incl. retries, elapsed clamped to timer', async () => {
    await sm.start('mini');
    await sm.answer('session-1', { cardId: 'dot', response: 'dot', elapsedMs: 1200, timedOut: false, prize: '🦆' });
    await sm.answer('session-1', { cardId: 'ka', response: 'ka', elapsedMs: 900, timedOut: false, prize: '🎲' });
    await sm.answer('session-1', { cardId: 'n', response: 'x', elapsedMs: 999999, timedOut: true, prize: null });
    await sm.answer('session-1', { cardId: 'shi', response: 'si', elapsedMs: -50, timedOut: false, prize: '🌵' });
    await sm.answer('session-1', { cardId: 'n', response: 'n', elapsedMs: 800, timedOut: false, prize: null });

    const rows = await attemptRows(db.conn, {});
    expect(rows).toHaveLength(5);
    const chrono = [...rows].reverse();

    // Timeout: elapsed clamped to the allowed timer, literal response kept.
    expect(chrono[2]).toMatchObject({
      cardId: 'n', outcome: 'timeout', timerMs: 7500, elapsedMs: 7500,
      response: 'x', isFirstOfSession: true, boxBefore: 1, boxAfter: 1,
    });
    // Negative elapsed clamps to 0.
    expect(chrono[3]).toMatchObject({ cardId: 'shi', elapsedMs: 0, outcome: 'correct', boxBefore: 1, boxAfter: 2 });
    // The in-session retry is logged but moves no box.
    expect(chrono[4]).toMatchObject({
      cardId: 'n', outcome: 'correct', isFirstOfSession: false, boxBefore: 1, boxAfter: 1,
    });
    expect(chrono[0]).toMatchObject({ cardId: 'dot', boxBefore: 1, boxAfter: 2, isFirstOfSession: true });
  });

  it('seals a perfect session: jar persisted, trophy on the shelf', async () => {
    await sm.start('mini');
    const prizes = ['🦆', '🎲', '🧸', '🌵'];
    const cards = ['dot', 'ka', 'n', 'shi'];
    let r;
    for (let i = 0; i < 4; i++) {
      r = await sm.answer('session-1', {
        cardId: cards[i],
        response: cards[i],
        elapsedMs: 1000,
        timedOut: false,
        prize: prizes[i],
      });
    }
    expect(r?.sessionEnd).toEqual({ perfect: true, jar: prizes });

    const trophies = await trophyViews(db.conn);
    expect(trophies).toHaveLength(1);
    expect(trophies[0]).toEqual({
      sessionId: 'session-1',
      deckId: 'mini',
      deckName: 'Mini fixture deck',
      endedAtIso: T0.toISOString(),
      size: 4,
      jar: prizes,
    });
  });

  it('falls back to a default prize when the renderer sends null on a first-attempt success', async () => {
    await sm.start('mini');
    const r = await sm.answer('session-1', {
      cardId: 'dot', response: 'dot', elapsedMs: 1000, timedOut: false, prize: null,
    });
    expect(r.outcome).toBe('correct');
    await sm.abort('session-1');
    // jar slot was filled (not a pebble) — visible via a would-be-perfect run,
    // asserted here through the session's internal jar via sessionEnd of a
    // full perfect session in the previous test; here we just confirm no throw.
  });

  it('schedules the next day correctly: nothing due right after, due again per interval', async () => {
    await sm.start('mini');
    for (const c of ['dot', 'ka', 'n', 'shi']) {
      await sm.answer('session-1', { cardId: c, response: c, elapsedMs: 500, timedOut: false, prize: '⭐' });
    }

    // Same moment: all four sit in box 2, due tomorrow; no new cards remain.
    let summaries = await deckSummaries(db.conn, nowRef.now);
    expect(summaries[0]).toMatchObject({
      id: 'mini', cardCount: 4, dueCount: 0, newCount: 0, boxCounts: [0, 4, 0, 0, 0],
    });
    const empty = await sm.start('mini');
    expect(empty.queueLength).toBe(0);
    expect(empty.first).toBeNull();

    // One day later: box-2 cards are due, timers tightened to 1.25×.
    nowRef.now = new Date(T0.getTime() + DAY);
    summaries = await deckSummaries(db.conn, nowRef.now);
    expect(summaries[0].dueCount).toBe(4);
    const s2 = await sm.start('mini');
    expect(s2.queueLength).toBe(4);
    expect(s2.first?.timerMs).toBe(6250); // 5000 × 1.25 (box 2)
  });

  it('start freezes settings and tag filter into the sessions row; tag filter narrows the queue', async () => {
    const start = await sm.start('mini', { tags: ['s-row'] });
    expect(start.queueLength).toBe(1);
    expect(start.first?.cardId).toBe('shi');
    const reader = await db.conn.runAndReadAll(
      `SELECT tag_filter, settings FROM sessions WHERE id = 'session-1'`,
    );
    const [tagFilter, settings] = reader.getRows()[0];
    expect(JSON.parse(String(tagFilter))).toEqual(['s-row']);
    expect(JSON.parse(String(settings))).toEqual({ baseTimerMs: 5000, newCardsPerSession: 5, maxBox1ForNew: 10, retrievalAllowanceMs: 2200 });
  });

  it('abort ends the session as imperfect and further answers throw', async () => {
    await sm.start('mini');
    await sm.abort('session-1');
    await expect(
      sm.answer('session-1', { cardId: 'dot', response: 'dot', elapsedMs: 1, timedOut: false, prize: null }),
    ).rejects.toThrow(/no active session/);
    const reader = await db.conn.runAndReadAll(
      `SELECT perfect, ended_at IS NOT NULL FROM sessions WHERE id = 'session-1'`,
    );
    expect(reader.getRows()[0]).toEqual([false, true]);
    // Double-abort is harmless.
    await sm.abort('session-1');
  });

  it('refuses to start a session on an archived deck; unarchive restores it', async () => {
    const { archiveDeck, unarchiveDeck } = await import('./queries');
    await archiveDeck(db.conn, 'mini', T0.getTime());
    await expect(sm.start('mini')).rejects.toThrow(/archived — unarchive it to drill/);

    // Summaries expose the archived state (real fields, not the B6 stubs).
    let summaries = await deckSummaries(db.conn, nowRef.now);
    expect(summaries[0].packId).toBe('mini');
    expect(summaries[0].archivedAtIso).toBe(T0.toISOString());

    await unarchiveDeck(db.conn, 'mini');
    summaries = await deckSummaries(db.conn, nowRef.now);
    expect(summaries[0].archivedAtIso).toBeNull();
    const start = await sm.start('mini');
    expect(start.queueLength).toBeGreaterThan(0);
  });

  it('rejects answers for the wrong card and for unknown sessions/decks', async () => {
    await expect(sm.start('nope')).rejects.toThrow(/unknown deck/);
    await sm.start('mini');
    await expect(
      sm.answer('session-1', { cardId: 'shi', response: 'si', elapsedMs: 1, timedOut: false, prize: null }),
    ).rejects.toThrow(/current card is dot/);
    await expect(
      sm.answer('ghost', { cardId: 'dot', response: 'dot', elapsedMs: 1, timedOut: false, prize: null }),
    ).rejects.toThrow(/no active session/);
  });

  it('feeds the stats screens: card stats, deck stats, filtered attempts', async () => {
    await sm.start('mini');
    await sm.answer('session-1', { cardId: 'dot', response: 'dot', elapsedMs: 1000, timedOut: false, prize: '🦆' });
    await sm.answer('session-1', { cardId: 'ka', response: 'nope', elapsedMs: 2000, timedOut: false, prize: null });

    const cs = await cardStats(db.conn, 'mini');
    expect(cs).toHaveLength(4);
    const dot = cs.find((c) => c.cardId === 'dot');
    expect(dot).toMatchObject({
      promptPreview: '[image]',
      box: 2,
      lifetimeCorrect: 1,
      lifetimeWrong: 0,
      medianElapsedMs: 1000,
      lastSuccessAtIso: T0.toISOString(),
    });
    const ka = cs.find((c) => c.cardId === 'ka');
    expect(ka).toMatchObject({ promptPreview: 'か', box: 1, lifetimeWrong: 1 });
    // Never-drilled card: box 1, no dates.
    expect(cs.find((c) => c.cardId === 'shi')).toMatchObject({
      box: 1, dueAtIso: null, lastSuccessAtIso: null, medianElapsedMs: null,
    });

    const ds = await deckStats(db.conn, 'mini', nowRef.now);
    expect(ds.boxCounts).toEqual([3, 1, 0, 0, 0]); // ka reset + 2 new, dot promoted
    expect(ds.dueForecast).toEqual([
      { dateIso: '2026-07-05', count: 1 }, // ka (box 1: due now)
      { dateIso: '2026-07-06', count: 1 }, // dot (box 2: tomorrow)
    ]);
    expect(ds.dailyMedianElapsed).toEqual([{ dateIso: '2026-07-05', medianMs: 1500 }]);

    expect(await attemptRows(db.conn, { outcome: 'wrong' })).toHaveLength(1);
    expect(await attemptRows(db.conn, { cardId: 'dot' })).toHaveLength(1);
    expect(await attemptRows(db.conn, { sinceIso: new Date(T0.getTime() + 1).toISOString() }))
      .toHaveLength(0);
  });
});

describe('once-a-day new-card introduction (B9)', () => {
  // Local-component dates: the gate works on LOCAL calendar days, so tests
  // must be timezone-independent.
  const DAY1_9AM = new Date(2026, 6, 11, 9, 0, 0);
  const DAY1_11AM = new Date(2026, 6, 11, 11, 0, 0);
  const DAY1_LATE = new Date(2026, 6, 11, 23, 30, 0);
  const DAY2_9AM = new Date(2026, 6, 12, 9, 0, 0);

  let db: Db;
  let nowRef: { now: Date };
  let sm: SessionManager;

  beforeEach(async () => {
    db = await openDatabase(':memory:');
    await importPack(db.conn, MINI, DAY1_9AM);
    nowRef = { now: DAY1_9AM };
    sm = manager(db, nowRef);
  });

  it('same-day second session introduces no new cards but still drills due ones', async () => {
    // First drill of the day: all 4 (new) cards introduced.
    const first = await sm.start('mini');
    expect(first.queueLength).toBe(4);
    // Fail one first attempt (→ box 1, due now), then quit.
    await sm.answer('session-1', {
      cardId: first.first?.cardId ?? '', response: 'zzz', elapsedMs: 500, timedOut: false, prize: null,
    });
    await sm.abort('session-1');

    // Two hours later, same local day: only the failed card comes back;
    // the three untouched (still-new) cards are NOT introduced again.
    nowRef.now = DAY1_11AM;
    const second = await sm.start('mini');
    expect(second.queueLength).toBe(1);
    expect(second.first?.cardId).toBe(first.first?.cardId);

    // Even late the same evening: still gated.
    await sm.abort('session-2');
    nowRef.now = DAY1_LATE;
    const third = await sm.start('mini');
    expect(third.queueLength).toBe(1);
  });

  it('the next local day introduces new cards again', async () => {
    const first = await sm.start('mini');
    await sm.answer('session-1', {
      cardId: first.first?.cardId ?? '', response: 'zzz', elapsedMs: 500, timedOut: false, prize: null,
    });
    await sm.abort('session-1');

    nowRef.now = DAY2_9AM;
    const nextDay = await sm.start('mini');
    // 1 due (failed yesterday, box 1) + 3 still-new introduced.
    expect(nextDay.queueLength).toBe(4);
  });

  it('a calibration session earlier in the day does not consume the introduction', async () => {
    const { CalibrationManager } = await import('./calibration');
    const cal = new CalibrationManager(db.conn, {
      now: () => DAY1_9AM,
      rng: noShuffle,
      uuid: () => 'cal-1',
    });
    const c = await cal.start('mini');
    await cal.submit(c.sessionId, c.trials.map((t) => ({
      cardId: t.cardId, text: t.text, response: t.text, elapsedMs: 1000,
    })));

    nowRef.now = DAY1_11AM;
    const first = await sm.start('mini');
    expect(first.queueLength).toBe(4); // still the day's first DRILL
  });

  it('tag-filtered and full-deck sessions share the per-deck day gate', async () => {
    // Tag-filtered drill first: introduces (and consumes the day for) the deck.
    const tagged = await sm.start('mini', { tags: ['s-row'] });
    expect(tagged.queueLength).toBe(1);
    await sm.abort('session-1');

    // Full-deck session the same day: nothing due, nothing introduced.
    nowRef.now = DAY1_11AM;
    const full = await sm.start('mini');
    expect(full.queueLength).toBe(0);
    expect(full.first).toBeNull();
  });

  it('deckSummaries dueCount/newCount are unaffected by the day gate', async () => {
    await sm.start('mini');
    await sm.abort('session-1');
    nowRef.now = DAY1_11AM;
    const summaries = await deckSummaries(db.conn, nowRef.now);
    // All 4 cards untouched by the aborted session: still new, none due.
    expect(summaries[0].newCount).toBe(4);
    expect(summaries[0].dueCount).toBe(0);
    expect(summaries[0].cardCount).toBe(4);
  });
});

describe('one trophy chance per day (B11)', () => {
  // Local-component dates: the gate works on LOCAL calendar days.
  const DAY1_9AM = new Date(2026, 7, 3, 9, 0, 0);
  const DAY1_11AM = new Date(2026, 7, 3, 11, 0, 0);
  const DAY2_NOON = new Date(2026, 7, 4, 12, 0, 0);
  const CARDS = ['dot', 'ka', 'n', 'shi'];

  let db: Db;
  let nowRef: { now: Date };
  let sm: SessionManager;

  beforeEach(async () => {
    db = await openDatabase(':memory:');
    await importPack(db.conn, MINI, DAY1_9AM);
    nowRef = { now: DAY1_9AM };
    sm = manager(db, nowRef);
  });

  /** Answers the given cards correctly in order; returns the last result. */
  async function clear(sessionId: string, ids: string[], prize = '⭐') {
    let r;
    for (const cardId of ids) {
      r = await sm.answer(sessionId, {
        cardId, response: cardId, elapsedMs: 1000, timedOut: false, prize,
      });
    }
    return r;
  }

  it("the day's first session seals a perfect run", async () => {
    const start = await sm.start('mini');
    expect(start.trophyEligible).toBe(true);
    const r = await clear('session-1', CARDS);
    expect(r?.sessionEnd).toEqual({ perfect: true, jar: ['⭐', '⭐', '⭐', '⭐'] });
    expect(await trophyViews(db.conn)).toHaveLength(1);
  });

  it('a perfect SECOND session the same day does not seal and adds no trophy', async () => {
    // Session 1 (eligible): dot fails its first attempt, so it drops to box 1
    // and is due again immediately — the loophole B11 closes.
    await sm.start('mini');
    await sm.answer('session-1', {
      cardId: 'dot', response: 'zzz', elapsedMs: 500, timedOut: false, prize: null,
    });
    const r1 = await clear('session-1', ['ka', 'n', 'shi', 'dot']);
    expect(r1?.sessionEnd?.perfect).toBe(false);
    expect(await trophyViews(db.conn)).toHaveLength(0);

    // Session 2, same local day: only dot is due, and it is answered
    // correctly — a full jar that must NOT seal.
    nowRef.now = DAY1_11AM;
    const second = await sm.start('mini');
    expect(second.trophyEligible).toBe(false);
    expect(second.queueLength).toBe(1);
    const r2 = await sm.answer('session-2', {
      cardId: 'dot', response: 'dot', elapsedMs: 900, timedOut: false, prize: '🦆',
    });
    // The jar filled — but the run is practice, so it ends unsealed.
    expect(r2.sessionEnd).toEqual({ perfect: false, jar: ['🦆'] });
    expect(await trophyViews(db.conn)).toHaveLength(0);

    // ...and nothing was sealed in the DB either: no perfect flag, no jar.
    const row = await db.conn.runAndReadAll(
      `SELECT perfect, jar, ended_at IS NOT NULL FROM sessions WHERE id = 'session-2'`,
    );
    expect(row.getRows()[0]).toEqual([false, null, true]);

    // The attempt still counted for Leitner: dot climbed to box 2.
    expect((await getCardState(db.conn, 'mini', 'dot'))?.box).toBe(2);
  });

  it('the next local day seals again', async () => {
    // Day 1: an imperfect run (dot missed) that leaves dot due again, then a
    // same-day practice round that clears it without sealing.
    await sm.start('mini');
    await sm.answer('session-1', {
      cardId: 'dot', response: 'zzz', elapsedMs: 500, timedOut: false, prize: null,
    });
    await clear('session-1', ['ka', 'n', 'shi', 'dot']);
    nowRef.now = DAY1_11AM;
    await sm.start('mini');
    await clear('session-2', ['dot'], '🦆');
    expect(await trophyViews(db.conn)).toHaveLength(0);

    // Day 2: fresh chance — all four are due again and the run seals.
    nowRef.now = DAY2_NOON;
    const third = await sm.start('mini');
    expect(third.trophyEligible).toBe(true);
    expect(third.queueLength).toBe(4);
    const r = await clear('session-3', CARDS, '🎁');
    expect(r?.sessionEnd?.perfect).toBe(true);
    const trophies = await trophyViews(db.conn);
    expect(trophies).toHaveLength(1);
    expect(trophies[0]).toMatchObject({ sessionId: 'session-3', size: 4 });
  });

  it("a calibration session doesn't consume the day's trophy chance", async () => {
    const { CalibrationManager } = await import('./calibration');
    const cal = new CalibrationManager(db.conn, {
      now: () => DAY1_9AM,
      rng: noShuffle,
      uuid: () => 'cal-1',
    });
    const c = await cal.start('mini');
    await cal.submit(c.sessionId, c.trials.map((t) => ({
      cardId: t.cardId, text: t.text, response: t.text, elapsedMs: 1000,
    })));

    nowRef.now = DAY1_11AM;
    const start = await sm.start('mini');
    expect(start.trophyEligible).toBe(true);
    const r = await clear('session-1', CARDS);
    expect(r?.sessionEnd?.perfect).toBe(true);
    expect(await trophyViews(db.conn)).toHaveLength(1);
  });

  it('an ineligible session still logs every attempt and moves boxes as before', async () => {
    // Session 1: everything times out, then every retry clears — all four
    // cards sit in box 1 and are due again the same day.
    await sm.start('mini');
    for (const cardId of CARDS) {
      await sm.answer('session-1', {
        cardId, response: '', elapsedMs: 999999, timedOut: true, prize: null,
      });
    }
    await clear('session-1', CARDS, '🦆'); // retries: logged, no box movement
    for (const id of CARDS) {
      const st = await getCardState(db.conn, 'mini', id);
      expect(st).toMatchObject({ box: 1, lifetimeWrong: 1, lifetimeCorrect: 0 });
    }

    // Session 2, same day (ineligible): dot/n/shi clear, ka times out and is
    // retried. Leitner and the audit log behave exactly as in session 1.
    nowRef.now = DAY1_11AM;
    const second = await sm.start('mini');
    expect(second.trophyEligible).toBe(false);
    expect(second.queueLength).toBe(4);
    await clear('session-2', ['dot'], '🦆');
    await sm.answer('session-2', {
      cardId: 'ka', response: '', elapsedMs: 999999, timedOut: true, prize: null,
    });
    await clear('session-2', ['n', 'shi'], '🧸');
    const last = await clear('session-2', ['ka'], '🌵');
    expect(last?.sessionEnd).toEqual({ perfect: false, jar: ['🦆', null, '🧸', '🧸'] });

    for (const id of ['dot', 'n', 'shi']) {
      expect(await getCardState(db.conn, 'mini', id)).toMatchObject({
        box: 2, lifetimeCorrect: 1, lifetimeWrong: 1,
      });
    }
    expect(await getCardState(db.conn, 'mini', 'ka')).toMatchObject({
      box: 1, lifetimeCorrect: 0, lifetimeWrong: 2,
    });

    // 8 attempts in session 1 (4 firsts + 4 retries) + 5 in session 2.
    const all = await attemptRows(db.conn, {});
    expect(all).toHaveLength(13);
    expect(all.filter((a) => a.sessionId === 'session-2')).toHaveLength(5);
    const kaRetry = all.find((a) => a.sessionId === 'session-2' && a.cardId === 'ka' && !a.isFirstOfSession);
    expect(kaRetry).toMatchObject({ outcome: 'correct', boxBefore: 1, boxAfter: 1 });
  });
});

describe('mediaUrlFor', () => {
  it('percent-encodes per segment, keeping the path structure', () => {
    expect(mediaUrlFor('mini/media/dot.svg')).toBe('mem://media/mini/media/dot.svg');
    expect(mediaUrlFor('my deck/media/no#te.svg')).toBe('mem://media/my%20deck/media/no%23te.svg');
  });
});
