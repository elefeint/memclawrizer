/**
 * Trophy-shelf denominational consolidation — pure view derivation
 * (DESIGN.md "The trophy shelf at scale"). No DOM, no state: the shelf is a
 * place-value reading of stats.trophies(), computed fresh on every render.
 *
 * Rules:
 * - Group by deck; each deck is one shelf row.
 * - Within a deck, sort chronologically (oldest first). The OLDEST hundred
 *   form the first hundred-jar, then the next hundred, and so on; of the
 *   remainder, the oldest ten form the first ten-jar; what's left (0–9,
 *   the newest) stay loose singles. Reading order: hundreds → tens →
 *   singles, like an odometer.
 * - Every perfect session counts equally regardless of card count.
 *
 * The consolidation ceremony is NOT persisted: detection is a same-session
 * count diff (see home.ts); this module only answers "did adding trophies
 * cross a boundary, and which denomination formed?".
 */
import type { TrophyView } from '../shared/api';

export interface DenominationJar {
  /** 10 or 100. */
  denomination: 10 | 100;
  /** The contained sessions, chronological (oldest first). 10 or 100 of them. */
  trophies: TrophyView[];
}

export interface DeckShelfRow {
  deckId: string;
  deckName: string;
  /** Oldest-first. */
  hundreds: DenominationJar[];
  tens: DenominationJar[];
  /** The newest 0–9 trophies, chronological (oldest first, newest rightmost). */
  singles: TrophyView[];
  total: number;
}

function byTimeAsc(a: TrophyView, b: TrophyView): number {
  return a.endedAtIso < b.endedAtIso ? -1 : a.endedAtIso > b.endedAtIso ? 1 : 0;
}

/** Group trophies into per-deck odometer rows. Rows sorted by deck name. */
export function deriveShelf(trophies: TrophyView[]): DeckShelfRow[] {
  const byDeck = new Map<string, TrophyView[]>();
  for (const t of trophies) {
    const list = byDeck.get(t.deckId);
    if (list) list.push(t);
    else byDeck.set(t.deckId, [t]);
  }

  const rows: DeckShelfRow[] = [];
  for (const [deckId, list] of byDeck) {
    const chron = [...list].sort(byTimeAsc);
    const n = chron.length;
    const nHundreds = Math.floor(n / 100);
    const nTens = Math.floor((n % 100) / 10);

    const hundreds: DenominationJar[] = [];
    for (let i = 0; i < nHundreds; i++) {
      hundreds.push({ denomination: 100, trophies: chron.slice(i * 100, i * 100 + 100) });
    }
    const tensStart = nHundreds * 100;
    const tens: DenominationJar[] = [];
    for (let j = 0; j < nTens; j++) {
      tens.push({
        denomination: 10,
        trophies: chron.slice(tensStart + j * 10, tensStart + j * 10 + 10),
      });
    }
    rows.push({
      deckId,
      deckName: chron[chron.length - 1].deckName,
      hundreds,
      tens,
      singles: chron.slice(tensStart + nTens * 10),
      total: n,
    });
  }

  rows.sort((a, b) => a.deckName.localeCompare(b.deckName));
  return rows;
}

/**
 * Did a deck's trophy count crossing prev → next complete a denomination?
 * Returns the denomination formed (100 wins when both boundaries coincide),
 * or null. Only exact arrivals count: a fresh mount with a stale baseline
 * (prev unknown) should pass prev = next and get null.
 */
export function consolidationEvent(prev: number, next: number): 10 | 100 | null {
  if (next <= prev || next === 0) return null;
  // Celebrate only when the new count lands exactly on a boundary.
  if (next % 100 === 0) return 100;
  if (next % 10 === 0) return 10;
  return null;
}
