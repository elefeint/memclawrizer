/**
 * Pure Leitner logic — deterministic tests: fixed `now`, seeded rng.
 */
import { describe, it, expect } from 'vitest';
import {
  applyOutcome,
  buildSessionQueue,
  evaluateOutcome,
  intervalMsFor,
  newCardState,
  timerFor,
  MAX_BOX,
} from './leitner';
import type { CardRow, CardStateRow } from './queries';
import type { DeckSettings } from '../shared/api';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-05T09:00:00Z');
const NOW_MS = NOW.getTime();

/** mulberry32 — tiny seeded PRNG for reproducible shuffles. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const settings: DeckSettings = { baseTimerMs: 5000, newCardsPerSession: 5 };

const card = (id: string, over: Partial<CardRow> = {}): CardRow => ({
  deckId: 'd1',
  id,
  promptType: 'text',
  promptText: id,
  mediaId: null,
  answers: [id],
  hint: null,
  tags: [],
  active: true,
  ...over,
});

const state = (cardId: string, over: Partial<CardStateRow> = {}): CardStateRow => ({
  deckId: 'd1',
  cardId,
  box: 1,
  dueAtMs: null,
  lastSuccessAtMs: null,
  lastSeenAtMs: null,
  lifetimeCorrect: 0,
  lifetimeWrong: 0,
  ...over,
});

describe('intervalMsFor', () => {
  it('maps boxes to 0/1/3/7/30 days', () => {
    expect(intervalMsFor(1)).toBe(0);
    expect(intervalMsFor(2)).toBe(1 * DAY);
    expect(intervalMsFor(3)).toBe(3 * DAY);
    expect(intervalMsFor(4)).toBe(7 * DAY);
    expect(intervalMsFor(5)).toBe(30 * DAY);
  });

  it('rejects invalid boxes', () => {
    expect(() => intervalMsFor(0)).toThrow(/invalid/);
    expect(() => intervalMsFor(6)).toThrow(/invalid/);
  });
});

describe('timerFor', () => {
  it('applies the per-box multipliers 1.5/1.25/1.0/0.85/0.7', () => {
    expect(timerFor(5000, 1)).toBe(7500);
    expect(timerFor(5000, 2)).toBe(6250);
    expect(timerFor(5000, 3)).toBe(5000);
    expect(timerFor(5000, 4)).toBe(4250);
    expect(timerFor(5000, 5)).toBe(3500);
  });

  it('rounds to whole milliseconds', () => {
    expect(timerFor(7001, 4)).toBe(Math.round(7001 * 0.85));
  });

  it('rejects invalid boxes', () => {
    expect(() => timerFor(5000, 0)).toThrow(/invalid/);
    expect(() => timerFor(5000, 6)).toThrow(/invalid/);
  });
});

describe('evaluateOutcome', () => {
  it('matches via shared normalization (trim, case, whitespace collapse)', () => {
    expect(evaluateOutcome(' SHI ', ['shi', 'si'], false)).toBe('correct');
    expect(evaluateOutcome('middle  c', ['Middle C'], false)).toBe('correct');
    expect(evaluateOutcome('sh', ['shi'], false)).toBe('wrong');
    expect(evaluateOutcome('', ['shi'], false)).toBe('wrong');
  });

  it('timeout wins even when the typed text happens to match', () => {
    expect(evaluateOutcome('shi', ['shi'], true)).toBe('timeout');
    expect(evaluateOutcome('', ['shi'], true)).toBe('timeout');
  });
});

describe('applyOutcome', () => {
  it('promotes one box on first-attempt correct and schedules the new interval', () => {
    const s = state('c', { box: 2, dueAtMs: NOW_MS - DAY, lifetimeCorrect: 3 });
    const next = applyOutcome(s, 'correct', true, NOW);
    expect(next.box).toBe(3);
    expect(next.dueAtMs).toBe(NOW_MS + 3 * DAY);
    expect(next.lastSuccessAtMs).toBe(NOW_MS);
    expect(next.lastSeenAtMs).toBe(NOW_MS);
    expect(next.lifetimeCorrect).toBe(4);
    expect(next.lifetimeWrong).toBe(0);
  });

  it('promotes through every box with the right due interval', () => {
    const intervals = [DAY, 3 * DAY, 7 * DAY, 30 * DAY];
    let s = newCardState('d1', 'c');
    for (let i = 0; i < intervals.length; i++) {
      s = applyOutcome(s, 'correct', true, NOW);
      expect(s.box).toBe(i + 2);
      expect(s.dueAtMs).toBe(NOW_MS + intervals[i]);
    }
  });

  it('caps promotion at box 5', () => {
    const s = state('c', { box: 5 });
    const next = applyOutcome(s, 'correct', true, NOW);
    expect(next.box).toBe(MAX_BOX);
    expect(next.dueAtMs).toBe(NOW_MS + 30 * DAY);
  });

  it('resets to box 1 on first-attempt wrong (classic Leitner)', () => {
    const s = state('c', {
      box: 4,
      dueAtMs: NOW_MS - 1,
      lastSuccessAtMs: NOW_MS - 7 * DAY,
      lifetimeWrong: 1,
    });
    const next = applyOutcome(s, 'wrong', true, NOW);
    expect(next.box).toBe(1);
    expect(next.dueAtMs).toBe(NOW_MS);
    expect(next.lastSeenAtMs).toBe(NOW_MS);
    expect(next.lifetimeWrong).toBe(2);
    // A failure is not a success: last_success_at untouched.
    expect(next.lastSuccessAtMs).toBe(NOW_MS - 7 * DAY);
  });

  it('treats timeout exactly like wrong', () => {
    const s = state('c', { box: 3 });
    expect(applyOutcome(s, 'timeout', true, NOW)).toEqual(applyOutcome(s, 'wrong', true, NOW));
  });

  it('leaves state untouched on retries (only first attempts move boxes)', () => {
    const s = state('c', { box: 3, dueAtMs: NOW_MS - DAY, lifetimeCorrect: 2, lifetimeWrong: 1 });
    expect(applyOutcome(s, 'correct', false, NOW)).toEqual(s);
    expect(applyOutcome(s, 'wrong', false, NOW)).toEqual(s);
    expect(applyOutcome(s, 'timeout', false, NOW)).toEqual(s);
  });

  it('does not mutate its input', () => {
    const s = state('c', { box: 2 });
    const copy = { ...s };
    applyOutcome(s, 'correct', true, NOW);
    applyOutcome(s, 'wrong', true, NOW);
    expect(s).toEqual(copy);
  });

  it('starts a brand-new card in box 1 and promotes to box 2 on first success', () => {
    const next = applyOutcome(newCardState('d1', 'c'), 'correct', true, NOW);
    expect(next.box).toBe(2);
    expect(next.dueAtMs).toBe(NOW_MS + DAY);
    expect(next.lifetimeCorrect).toBe(1);
  });
});

describe('buildSessionQueue', () => {
  // rng that never shuffles (always picks index 0 → reverses...). Use a
  // "identity" shuffle: rng returning values that keep elements in place.
  // Fisher–Yates leaves order intact when rng() → j === i, i.e. rng returns
  // values just under 1.
  const noShuffle = () => 0.999999;

  it('includes box-1 cards always, higher boxes only when due', () => {
    const cards = [card('box1'), card('due3'), card('future3'), card('due5')];
    const states = [
      state('box1', { box: 1, dueAtMs: NOW_MS + 999 * DAY }), // box 1 → due regardless
      state('due3', { box: 3, dueAtMs: NOW_MS }), // due exactly now → due
      state('future3', { box: 3, dueAtMs: NOW_MS + 1 }), // 1ms in the future → not due
      state('due5', { box: 5, dueAtMs: NOW_MS - DAY }),
    ];
    const q = buildSessionQueue(states, cards, settings, null, NOW, noShuffle);
    expect(q.map((x) => x.card.id)).toEqual(['box1', 'due3', 'due5']);
    expect(q.map((x) => x.box)).toEqual([1, 3, 5]);
    expect(q.every((x) => !x.isNew)).toBe(true);
  });

  it('adds never-seen cards up to newCardsPerSession, in stable card order', () => {
    const cards = [card('n1'), card('n2'), card('n3'), card('n4')];
    const q = buildSessionQueue(
      [],
      cards,
      { ...settings, newCardsPerSession: 2 },
      null,
      NOW,
      noShuffle,
    );
    expect(q.map((x) => x.card.id)).toEqual(['n1', 'n2']);
    expect(q.every((x) => x.isNew && x.box === 1)).toBe(true);
  });

  it('handles newCardsPerSession of 0 and negative values as "no new cards"', () => {
    const cards = [card('n1'), card('seen')];
    const states = [state('seen', { box: 1 })];
    for (const n of [0, -3]) {
      const q = buildSessionQueue(states, cards, { ...settings, newCardsPerSession: n }, null, NOW, noShuffle);
      expect(q.map((x) => x.card.id)).toEqual(['seen']);
    }
  });

  it('filters by tag (any-of), counting the new-card budget after the filter', () => {
    const cards = [
      card('kat1', { tags: ['katakana', 'k-row'] }),
      card('hira1', { tags: ['hiragana'] }),
      card('kat2', { tags: ['katakana'] }),
      card('kat3', { tags: ['katakana'] }),
    ];
    const q = buildSessionQueue(
      [],
      cards,
      { ...settings, newCardsPerSession: 2 },
      ['katakana'],
      NOW,
      noShuffle,
    );
    expect(q.map((x) => x.card.id)).toEqual(['kat1', 'kat2']);
  });

  it('treats null and empty tag filters as "no filter"', () => {
    const cards = [card('a', { tags: ['x'] }), card('b', { tags: [] })];
    for (const f of [null, [] as string[]]) {
      const q = buildSessionQueue([], cards, settings, f, NOW, noShuffle);
      expect(q).toHaveLength(2);
    }
  });

  it('excludes inactive cards even when due', () => {
    const cards = [card('gone', { active: false }), card('here')];
    const states = [state('gone', { box: 1 }), state('here', { box: 1 })];
    const q = buildSessionQueue(states, cards, settings, null, NOW, noShuffle);
    expect(q.map((x) => x.card.id)).toEqual(['here']);
  });

  it('a card with a state row is never "new", even if it has no due_at', () => {
    // Defensive: state exists (it was seen) but due_at is null and box > 1.
    const cards = [card('odd')];
    const states = [state('odd', { box: 3, dueAtMs: null })];
    const q = buildSessionQueue(states, cards, settings, null, NOW, noShuffle);
    expect(q).toHaveLength(0); // not due, not new
  });

  it('shuffles deterministically with the injected rng', () => {
    const cards = [card('a'), card('b'), card('c'), card('d'), card('e')];
    const q1 = buildSessionQueue([], cards, settings, null, NOW, seededRng(42));
    const q2 = buildSessionQueue([], cards, settings, null, NOW, seededRng(42));
    const q3 = buildSessionQueue([], cards, settings, null, NOW, seededRng(7));
    expect(q1.map((x) => x.card.id)).toEqual(q2.map((x) => x.card.id));
    expect(q1.map((x) => x.card.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    // Different seed → (for these seeds) different order, same membership.
    expect(q3.map((x) => x.card.id)).not.toEqual(q1.map((x) => x.card.id));
    expect(q3.map((x) => x.card.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('mixes due and new cards into one shuffled queue', () => {
    const cards = [card('new1'), card('due1'), card('new2')];
    const states = [state('due1', { box: 2, dueAtMs: NOW_MS - 1 })];
    const q = buildSessionQueue(states, cards, { ...settings, newCardsPerSession: 5 }, null, NOW, seededRng(1));
    expect(q.map((x) => x.card.id).sort()).toEqual(['due1', 'new1', 'new2']);
    const due1 = q.find((x) => x.card.id === 'due1');
    expect(due1?.box).toBe(2);
    expect(due1?.isNew).toBe(false);
  });

  it('returns an empty queue when nothing is due and nothing is new', () => {
    const cards = [card('a')];
    const states = [state('a', { box: 4, dueAtMs: NOW_MS + DAY })];
    expect(buildSessionQueue(states, cards, settings, null, NOW, noShuffle)).toEqual([]);
  });
});
