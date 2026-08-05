import { describe, expect, it } from 'vitest';
import {
  daysSinceLastPractice,
  localDayKey,
  streakDots,
  streakLine,
  stripTitle,
} from './practice-streak';
import type { PracticeHistory } from '../shared/api';

/** Build a window from an attempts pattern, oldest first, ending 'today'. */
function history(pattern: number[], over: Partial<PracticeHistory> = {}): PracticeHistory {
  const days = pattern.map((attempts, i) => ({
    dateIso: `2026-07-${String(i + 1).padStart(2, '0')}`,
    attempts,
  }));
  return { currentStreakDays: 0, longestStreakDays: 0, days, ...over };
}

const FMT = { day: (iso: string) => `d(${iso})` };

describe('streakLine', () => {
  it('states the run factually', () => {
    expect(streakLine(history([1, 1], { currentStreakDays: 12 }))).toBe('practised 12 days running');
  });

  it('singularizes a one-day run', () => {
    expect(streakLine(history([1], { currentStreakDays: 1 }))).toBe('practised 1 day running');
  });

  it('never says 0 to a new user', () => {
    const line = streakLine(history([0, 0, 0]));
    expect(line).toBe('no practice logged yet');
    expect(line).not.toContain('0');
  });

  it('reports the last practice instead of the broken run', () => {
    // Practised three days back, nothing since: no run, but no scolding.
    expect(streakLine(history([1, 1, 0, 0, 0]))).toBe('last practised 3 days ago');
    expect(streakLine(history([1, 1, 1, 0]))).toBe('last practised yesterday');
  });

  it('uses no alarming vocabulary anywhere', () => {
    const lines = [
      streakLine(history([0, 0])),
      streakLine(history([1, 0, 0])),
      streakLine(history([1], { currentStreakDays: 9 })),
    ].join(' ');
    for (const word of ['lost', 'broke', 'broken', 'don’t', 'warning', 'save', '!', '🔥']) {
      expect(lines).not.toContain(word);
    }
  });
});

describe('daysSinceLastPractice', () => {
  it('counts back from the end of the window', () => {
    expect(daysSinceLastPractice(history([1, 0, 0]).days)).toBe(2);
    expect(daysSinceLastPractice(history([0, 0, 4]).days)).toBe(0);
    expect(daysSinceLastPractice(history([0, 0, 0]).days)).toBeNull();
    expect(daysSinceLastPractice([])).toBeNull();
  });
});

describe('streakDots', () => {
  it('keeps every day in the window, gaps included', () => {
    const dots = streakDots(history([3, 0, 5]), FMT);
    expect(dots.map((d) => d.practiced)).toEqual([true, false, true]);
    expect(dots).toHaveLength(3);
  });

  it('labels each dot with its date and attempt count', () => {
    const dots = streakDots(history([3, 0, 1]), FMT);
    expect(dots[0].label).toBe('d(2026-07-01) — 3 attempts');
    expect(dots[1].label).toBe('d(2026-07-02) — no practice');
    expect(dots[2].label).toBe('d(2026-07-03) — 1 attempt');
  });

  it('marks today when the key matches', () => {
    const dots = streakDots(history([1, 1]), { ...FMT, todayIso: '2026-07-02' });
    expect(dots.map((d) => d.isToday)).toEqual([false, true]);
    // No today key (defensive): nothing is marked, nothing throws.
    expect(streakDots(history([1, 1]), FMT).some((d) => d.isToday)).toBe(false);
  });

  it('survives an empty window', () => {
    expect(streakDots(history([]), FMT)).toEqual([]);
  });
});

describe('stripTitle', () => {
  it('summarizes the window and hides the longest run in the details', () => {
    expect(stripTitle(history([1, 0, 1, 1], { longestStreakDays: 12 }))).toBe(
      'last 4 days · 3 practised · longest run 12 days',
    );
  });

  it('omits the longest run for a new user', () => {
    expect(stripTitle(history([0, 0]))).toBe('last 2 days · 0 practised');
  });
});

describe('localDayKey', () => {
  it('formats the LOCAL calendar day, zero-padded', () => {
    expect(localDayKey(new Date(2026, 7, 2, 23, 30))).toBe('2026-08-02');
    expect(localDayKey(new Date(2026, 0, 9, 0, 5))).toBe('2026-01-09');
  });
});
