/**
 * Pure derivations for the home header's practice streak (F12, contract #8 —
 * DESIGN.md "Practice streak").
 *
 * An ATTENDANCE streak: it counts showing up, which is under the user's
 * control, not performing flawlessly, which is not. Two rules follow from
 * that and are enforced here rather than in the DOM layer:
 *
 *  - the language stays factual. No flames, no warnings, no rescue offers,
 *    and never a bare "0" at someone who simply hasn't started yet;
 *  - the dot strip is the anti-cliff device. The number resets on a missed
 *    day, but the whole month stays visible, so a gap reads as "a day off"
 *    rather than "everything erased".
 */
import type { PracticeHistory } from '../shared/api';

export interface StreakDot {
  dateIso: string;
  attempts: number;
  practiced: boolean;
  isToday: boolean;
  /** Hover text: the day and what happened on it. */
  label: string;
}

/**
 * Days back from the end of the window to the most recent day with practice;
 * 0 = today, null when the window holds no practice at all.
 */
export function daysSinceLastPractice(days: PracticeHistory['days']): number | null {
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].attempts > 0) return days.length - 1 - i;
  }
  return null;
}

/** The header's one line of text. Factual, never a bare number. */
export function streakLine(history: PracticeHistory): string {
  const n = history.currentStreakDays;
  if (n > 0) return `practised ${n} ${n === 1 ? 'day' : 'days'} running`;

  const since = daysSinceLastPractice(history.days);
  if (since === null) return 'no practice logged yet';
  if (since <= 1) return 'last practised yesterday';
  return `last practised ${since} days ago`;
}

export interface DotOptions {
  /** Local day key ('YYYY-MM-DD') for today, so one dot can be marked. */
  todayIso?: string;
  /** Locale date formatter for the hover label. */
  day(iso: string): string;
}

export function streakDots(history: PracticeHistory, opts: DotOptions): StreakDot[] {
  return history.days.map((d) => ({
    dateIso: d.dateIso,
    attempts: d.attempts,
    practiced: d.attempts > 0,
    isToday: d.dateIso === opts.todayIso,
    label:
      d.attempts > 0
        ? `${opts.day(d.dateIso)} — ${d.attempts} ${d.attempts === 1 ? 'attempt' : 'attempts'}`
        : `${opts.day(d.dateIso)} — no practice`,
  }));
}

/**
 * Hover/screen-reader summary for the strip as a whole. The longest run
 * lives here rather than in the header line: available on inspection,
 * never a scoreboard to be measured against.
 */
export function stripTitle(history: PracticeHistory): string {
  const window = history.days.length;
  const practised = history.days.filter((d) => d.attempts > 0).length;
  const parts = [`last ${window} ${window === 1 ? 'day' : 'days'}`, `${practised} practised`];
  if (history.longestStreakDays > 0) {
    parts.push(
      `longest run ${history.longestStreakDays} ${history.longestStreakDays === 1 ? 'day' : 'days'}`,
    );
  }
  return parts.join(' · ');
}

/** Local calendar day key — the shape the backend's day keys use. */
export function localDayKey(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
