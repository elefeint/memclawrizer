import { describe, expect, it } from 'vitest';
import {
  deckOptions,
  initialDeckId,
  parseDateIso,
  rankDeckScores,
  rankLabel,
  recordTiles,
  type RecordFormatters,
} from './hall-of-fame-data';
import type { DeckSummary, HallOfFame } from '../shared/api';

const score = (
  deckId: string,
  deckName: string,
  sealedJars: number,
  masteredCards = 0,
  archived = false,
) => ({ deckId, deckName, archived, sealedJars, masteredCards, lifetimeAttempts: 10 });

// Deterministic stand-ins for the screen's locale formatters.
const FMT: RecordFormatters = {
  day: (iso) => `day(${iso})`,
  dateTime: (iso) => `dt(${iso})`,
  ms: (ms) => `${ms}ms`,
};

const EMPTY: HallOfFame = {
  deckScores: [],
  fastestCorrect: null,
  largestPerfectSession: null,
  busiestDay: null,
  daysPracticed: 0,
  totalAttempts: 0,
};

describe('rankDeckScores', () => {
  it('orders by sealed jars descending', () => {
    const rows = rankDeckScores([score('a', 'Alpha', 2), score('b', 'Beta', 9)]);
    expect(rows.map((r) => [r.rank, r.deckId])).toEqual([
      [1, 'b'],
      [2, 'a'],
    ]);
  });

  it('shares a rank on ties and skips the next (competition ranking)', () => {
    const rows = rankDeckScores([
      score('a', 'Alpha', 5, 3),
      score('b', 'Beta', 5, 3),
      score('c', 'Gamma', 1),
    ]);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3]);
    // Stable within the tie: name order.
    expect(rows.map((r) => r.deckId)).toEqual(['a', 'b', 'c']);
  });

  it('breaks equal jars by mastered cards before name', () => {
    const rows = rankDeckScores([score('a', 'Alpha', 4, 1), score('z', 'Zeta', 4, 7)]);
    expect(rows.map((r) => [r.rank, r.deckId])).toEqual([
      [1, 'z'],
      [2, 'a'],
    ]);
  });

  it('keeps archived decks on the board and does not mutate the input', () => {
    const input = [score('a', 'Alpha', 3), score('b', 'Beta', 8, 0, true)];
    const rows = rankDeckScores(input);
    expect(rows[0]).toMatchObject({ deckId: 'b', archived: true, rank: 1 });
    expect(input.map((s) => s.deckId)).toEqual(['a', 'b']);
  });

  it('handles an empty board', () => {
    expect(rankDeckScores([])).toEqual([]);
  });
});

describe('rankLabel', () => {
  it('uses arcade ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(rankLabel)).toEqual([
      '1ST',
      '2ND',
      '3RD',
      '4TH',
      '11TH',
      '12TH',
      '13TH',
      '21ST',
      '22ND',
      '23RD',
      '101ST',
      '111TH',
    ]);
  });
});

describe('parseDateIso', () => {
  it('reads a bare day key as LOCAL midnight, not UTC', () => {
    const d = parseDateIso('2026-07-22');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(22);
    expect(d.getHours()).toBe(0);
  });

  it('reads a full timestamp as an instant', () => {
    expect(parseDateIso('2026-07-30T09:00:00Z').toISOString()).toBe('2026-07-30T09:00:00.000Z');
  });
});

describe('recordTiles', () => {
  const full: HallOfFame = {
    deckScores: [],
    fastestCorrect: {
      deckName: 'Kana',
      promptPreview: 'し',
      elapsedMs: 740,
      dateIso: '2026-07-30T09:00:00Z',
    },
    largestPerfectSession: { deckName: 'Piano', size: 17, dateIso: '2026-07-02T20:11:00Z' },
    busiestDay: { dateIso: '2026-07-22', attempts: 57 },
    daysPracticed: 31,
    totalAttempts: 688,
  };

  it('formats every record through the injected formatters', () => {
    const tiles = recordTiles(full, FMT);
    expect(tiles.map((t) => t.key)).toEqual([
      'fastest',
      'largest',
      'busiest',
      'days',
      'attempts',
    ]);
    expect(tiles[0]).toMatchObject({
      value: '740ms',
      detail: 'し · Kana · dt(2026-07-30T09:00:00Z)',
    });
    expect(tiles[1]).toMatchObject({ value: '17 cards', detail: 'Piano · day(2026-07-02T20:11:00Z)' });
    expect(tiles[2]).toMatchObject({ value: '57', detail: 'attempts on day(2026-07-22)' });
    expect(tiles[3].value).toBe('31');
    expect(tiles[4].value).toBe('688');
  });

  it('never shows a percentage', () => {
    const text = recordTiles(full, FMT)
      .map((t) => `${t.label}${t.value}${t.detail}`)
      .join(' ');
    expect(text).not.toContain('%');
  });

  it('singularizes a one-card perfect session', () => {
    const tiles = recordTiles(
      { ...full, largestPerfectSession: { deckName: 'Piano', size: 1, dateIso: 'x' } },
      FMT,
    );
    expect(tiles[1].value).toBe('1 card');
  });

  it('survives an empty database', () => {
    const tiles = recordTiles(EMPTY, FMT);
    expect(tiles.map((t) => t.value)).toEqual(['—', '—', '—', '0', '0']);
    expect(tiles[0].detail).toBe('no correct answer logged yet');
    expect(tiles[1].detail).toBe('no sealed jar yet');
    expect(tiles[2].detail).toBe('nothing drilled yet');
    expect(tiles[3].detail).toBe('days with a drill attempt');
  });
});

describe('deckOptions / initialDeckId', () => {
  const deck = (id: string, name: string, archivedAtIso: string | null): DeckSummary => ({
    id,
    packId: id,
    archivedAtIso,
    calibratedAtIso: null,
    name,
    description: null,
    cardCount: 1,
    dueCount: 0,
    newCount: 0,
    boxCounts: [1, 0, 0, 0, 0],
    settings: {
      baseTimerMs: 5000,
      newCardsPerSession: 5,
      maxBox1ForNew: 10,
      retrievalAllowanceMs: 2200,
    },
    tags: [],
  });

  const decks = [
    deck('z', 'Zeta', null),
    deck('arch', 'Beta', '2026-07-01T00:00:00Z'),
    deck('a', 'Alpha', null),
  ];

  it('lists active decks first by name, then archived with a marker', () => {
    expect(deckOptions(decks)).toEqual([
      { id: 'a', label: 'Alpha', archived: false },
      { id: 'z', label: 'Zeta', archived: false },
      { id: 'arch', label: 'Beta (archived)', archived: true },
    ]);
  });

  it('honours a deep-linked deck, including an archived one', () => {
    const options = deckOptions(decks);
    expect(initialDeckId(options, 'arch')).toBe('arch');
    expect(initialDeckId(options, 'gone')).toBe('a'); // stale link falls back
    expect(initialDeckId(options)).toBe('a');
    expect(initialDeckId([], 'arch')).toBeNull();
  });
});
