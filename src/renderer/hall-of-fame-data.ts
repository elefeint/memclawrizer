/**
 * Pure derivations behind the Hall of Fame screen (F10b) — ranking, record
 * formatting, deck-picker options. No DOM, no api: the screen stays a thin
 * rendering layer over these, and every rule here is unit-tested.
 *
 * Counts only: the no-percentages rule (DESIGN.md "Perfection mechanics")
 * holds in the hall of fame too.
 */
import type { DeckSummary, HallOfFame } from '../shared/api';

export interface ScoreRow {
  /** Competition rank: ties share a rank and the next rank skips. */
  rank: number;
  deckId: string;
  deckName: string;
  archived: boolean;
  /** THE score: sealed jars (perfect sessions). */
  sealedJars: number;
  masteredCards: number;
  lifetimeAttempts: number;
}

/**
 * Arcade high-score order: sealed jars descending, then mastered cards, then
 * name — a total order, so the table never reshuffles between renders even
 * if the backend's own tiebreak differs.
 */
export function rankDeckScores(scores: HallOfFame['deckScores']): ScoreRow[] {
  const sorted = [...scores].sort(
    (a, b) =>
      b.sealedJars - a.sealedJars ||
      b.masteredCards - a.masteredCards ||
      a.deckName.localeCompare(b.deckName) ||
      a.deckId.localeCompare(b.deckId),
  );
  const rows: ScoreRow[] = [];
  let rank = 0;
  let prev: { jars: number; mastered: number } | null = null;
  sorted.forEach((s, i) => {
    // Ties are decided by the SCORE (jars), with mastered cards as the
    // secondary — same pair means same rank.
    if (prev === null || prev.jars !== s.sealedJars || prev.mastered !== s.masteredCards) {
      rank = i + 1;
      prev = { jars: s.sealedJars, mastered: s.masteredCards };
    }
    rows.push({ ...s, rank });
  });
  return rows;
}

/** 1 → "1ST", 2 → "2ND", 11 → "11TH", 21 → "21ST" (arcade board style). */
export function rankLabel(rank: number): string {
  const rem100 = rank % 100;
  const rem10 = rank % 10;
  const suffix =
    rem100 >= 11 && rem100 <= 13 ? 'TH' : rem10 === 1 ? 'ST' : rem10 === 2 ? 'ND' : rem10 === 3 ? 'RD' : 'TH';
  return `${rank}${suffix}`;
}

/**
 * The backend hands out two date shapes (B10 note): local day keys
 * ('YYYY-MM-DD', busiestDay) and full ISO timestamps (fastestCorrect,
 * largestPerfectSession). A bare day key must be read as LOCAL midnight —
 * `new Date('2026-07-22')` would parse as UTC and can slide a day.
 */
export function parseDateIso(iso: string): Date {
  return new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
}

/** Injected so the pure layer stays locale- and timezone-independent. */
export interface RecordFormatters {
  day(iso: string): string;
  dateTime(iso: string): string;
  ms(ms: number): string;
}

export interface RecordTile {
  key: string;
  label: string;
  /** Big glowing figure; '—' when the record doesn't exist yet. */
  value: string;
  /** Supporting line: what/where/when, or why it's empty. */
  detail: string;
}

/** The records board. Every entry survives an empty database. */
export function recordTiles(hof: HallOfFame, f: RecordFormatters): RecordTile[] {
  const fast = hof.fastestCorrect;
  const big = hof.largestPerfectSession;
  const busy = hof.busiestDay;
  return [
    {
      key: 'fastest',
      label: 'fastest correct',
      value: fast ? f.ms(fast.elapsedMs) : '—',
      detail: fast
        ? `${fast.promptPreview} · ${fast.deckName} · ${f.dateTime(fast.dateIso)}`
        : 'no correct answer logged yet',
    },
    {
      key: 'largest',
      label: 'largest perfect session',
      value: big ? `${big.size} ${big.size === 1 ? 'card' : 'cards'}` : '—',
      detail: big ? `${big.deckName} · ${f.day(big.dateIso)}` : 'no sealed jar yet',
    },
    {
      key: 'busiest',
      label: 'busiest day',
      value: busy ? `${busy.attempts}` : '—',
      detail: busy ? `attempts on ${f.day(busy.dateIso)}` : 'nothing drilled yet',
    },
    {
      key: 'days',
      label: 'days practiced',
      value: `${hof.daysPracticed}`,
      detail: hof.daysPracticed === 1 ? 'day with a drill attempt' : 'days with a drill attempt',
    },
    {
      key: 'attempts',
      label: 'total attempts',
      value: `${hof.totalAttempts}`,
      detail: 'every attempt, retries included',
    },
  ];
}

export interface DeckOption {
  id: string;
  /** Picker text; archived decks carry the marker in the label. */
  label: string;
  archived: boolean;
}

/**
 * Deck-detail picker: active decks first (by name), archived after — their
 * history stays reachable (DESIGN.md UI item 3), just visibly parked.
 */
export function deckOptions(decks: DeckSummary[]): DeckOption[] {
  const byName = (a: DeckSummary, b: DeckSummary) => a.name.localeCompare(b.name);
  const active = decks.filter((d) => d.archivedAtIso === null).sort(byName);
  const archived = decks.filter((d) => d.archivedAtIso !== null).sort(byName);
  return [
    ...active.map((d) => ({ id: d.id, label: d.name, archived: false })),
    ...archived.map((d) => ({ id: d.id, label: `${d.name} (archived)`, archived: true })),
  ];
}

/** Deep-link target if it still exists, else the first deck, else nothing. */
export function initialDeckId(options: DeckOption[], preselected?: string): string | null {
  if (preselected && options.some((o) => o.id === preselected)) return preselected;
  return options[0]?.id ?? null;
}
