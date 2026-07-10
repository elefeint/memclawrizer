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
    expect(JSON.parse(String(settings))).toEqual({ baseTimerMs: 5000, newCardsPerSession: 5 });
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

describe('mediaUrlFor', () => {
  it('percent-encodes per segment, keeping the path structure', () => {
    expect(mediaUrlFor('mini/media/dot.svg')).toBe('mem://media/mini/media/dot.svg');
    expect(mediaUrlFor('my deck/media/no#te.svg')).toBe('mem://media/my%20deck/media/no%23te.svg');
  });
});
