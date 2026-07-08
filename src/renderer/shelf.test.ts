/**
 * Unit tests for the pure denominational-shelf derivation (DESIGN.md
 * "The trophy shelf at scale").
 */
import { describe, it, expect } from 'vitest';
import type { TrophyView } from '../shared/api';
import { consolidationEvent, deriveShelf } from './shelf';

/** n trophies for one deck; index i ended on day i (chronological by index). */
function make(deckId: string, n: number, startDay = 1): TrophyView[] {
  return Array.from({ length: n }, (_, i) => ({
    sessionId: `${deckId}-s${i}`,
    deckId,
    deckName: `Deck ${deckId}`,
    endedAtIso: new Date(Date.UTC(2026, 0, startDay + i)).toISOString(),
    size: (i % 7) + 1,
    jar: ['🎁'],
  }));
}

function counts(rows: ReturnType<typeof deriveShelf>, deckId: string) {
  const r = rows.find((x) => x.deckId === deckId);
  if (!r) throw new Error(`no row for ${deckId}`);
  return { h: r.hundreds.length, t: r.tens.length, s: r.singles.length, total: r.total };
}

describe('deriveShelf place-value chunking', () => {
  it.each([
    [0, { h: 0, t: 0, s: 0 }],
    [9, { h: 0, t: 0, s: 9 }],
    [10, { h: 0, t: 1, s: 0 }],
    [11, { h: 0, t: 1, s: 1 }],
    [99, { h: 0, t: 9, s: 9 }],
    [100, { h: 1, t: 0, s: 0 }],
    [101, { h: 1, t: 0, s: 1 }],
    [113, { h: 1, t: 1, s: 3 }],
  ])('%i trophies → %o', (n, want) => {
    const rows = deriveShelf(make('a', n));
    if (n === 0) {
      expect(rows).toHaveLength(0);
      return;
    }
    expect(counts(rows, 'a')).toEqual({ ...want, total: n });
  });

  it('consolidates the OLDEST ten; new singles accumulate after', () => {
    const rows = deriveShelf(make('a', 13));
    const row = rows[0];
    expect(row.tens).toHaveLength(1);
    expect(row.tens[0].trophies.map((t) => t.sessionId)).toEqual(
      Array.from({ length: 10 }, (_, i) => `a-s${i}`),
    );
    expect(row.singles.map((t) => t.sessionId)).toEqual(['a-s10', 'a-s11', 'a-s12']);
  });

  it('is insensitive to input order (sorts chronologically per deck)', () => {
    const trophies = make('a', 12);
    // stats.trophies() arrives newest-first; also interleave a shuffle.
    const shuffled = [trophies[5], ...trophies.slice(6).reverse(), ...trophies.slice(0, 5).reverse()];
    const row = deriveShelf(shuffled)[0];
    expect(row.tens[0].trophies.map((t) => t.sessionId)).toEqual(
      Array.from({ length: 10 }, (_, i) => `a-s${i}`),
    );
    expect(row.singles.map((t) => t.sessionId)).toEqual(['a-s10', 'a-s11']);
  });

  it('hundred-jars take the oldest hundred; tens the next-oldest tens', () => {
    const row = deriveShelf(make('a', 123))[0];
    expect(row.hundreds).toHaveLength(1);
    expect(row.hundreds[0].denomination).toBe(100);
    expect(row.hundreds[0].trophies).toHaveLength(100);
    expect(row.hundreds[0].trophies[0].sessionId).toBe('a-s0');
    expect(row.hundreds[0].trophies[99].sessionId).toBe('a-s99');
    expect(row.tens).toHaveLength(2);
    expect(row.tens[0].trophies[0].sessionId).toBe('a-s100');
    expect(row.tens[1].trophies[9].sessionId).toBe('a-s119');
    expect(row.singles.map((t) => t.sessionId)).toEqual(['a-s120', 'a-s121', 'a-s122']);
  });

  it('keeps decks separate and sorts rows by deck name', () => {
    const rows = deriveShelf([...make('zeta', 11), ...make('alpha', 3)]);
    expect(rows.map((r) => r.deckId)).toEqual(['alpha', 'zeta']);
    expect(counts(rows, 'zeta')).toEqual({ h: 0, t: 1, s: 1, total: 11 });
    expect(counts(rows, 'alpha')).toEqual({ h: 0, t: 0, s: 3, total: 3 });
  });
});

describe('consolidationEvent', () => {
  it.each([
    [9, 10, 10],
    [10, 11, null],
    [0, 1, null],
    [19, 20, 10],
    [99, 100, 100],
    [100, 101, null],
    [199, 200, 100],
    [10, 10, null], // no change
    [11, 10, null], // never on decrease
    [0, 0, null],
  ] as const)('%i → %i = %o', (prev, next, want) => {
    expect(consolidationEvent(prev, next)).toBe(want);
  });
});
