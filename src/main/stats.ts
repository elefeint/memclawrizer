/**
 * Read-side DTO builders for decks.list and stats.* — maps DB rows to the
 * shared contract types. No Electron imports; `now` injected where due-ness
 * matters. Decks are small (tens to low hundreds of cards), so per-deck
 * aggregation in TS is fine; time-series math stays in SQL (DuckDB's turf).
 */
import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type {
  AttemptFilter,
  AttemptRow,
  CardStats,
  DeckStats,
  DeckSummary,
  TrophyView,
} from '../shared/api';
import { buildSessionQueue } from './leitner';
import type { CardRow, CardStateRow } from './queries';
import {
  latestCalibrationEndMs,
  listAttempts,
  listCards,
  listCardStates,
  listDecks,
  listTrophies,
} from './queries';

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function toIsoOrNull(ms: number | null): string | null {
  return ms === null ? null : toIso(ms);
}

function boxCountsFor(
  cards: CardRow[],
  stateByCard: Map<string, CardStateRow>,
): [number, number, number, number, number] {
  const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const card of cards) {
    const box = stateByCard.get(card.id)?.box ?? 1; // new cards sit in box 1
    counts[Math.min(Math.max(box, 1), 5) - 1]++;
  }
  return counts;
}

export async function deckSummaries(conn: DuckDBConnection, now: Date): Promise<DeckSummary[]> {
  const decks = await listDecks(conn);
  const result: DeckSummary[] = [];
  for (const deck of decks) {
    const cards = await listCards(conn, deck.id, { activeOnly: true });
    const states = await listCardStates(conn, deck.id);
    const stateByCard = new Map(states.map((s) => [s.cardId, s]));
    // Due = what a session with zero new cards would drill right now.
    const dueCount = buildSessionQueue(
      states,
      cards,
      { ...deck.settings, newCardsPerSession: 0 },
      null,
      now,
      () => 0.5,
    ).length;
    result.push({
      id: deck.id,
      packId: deck.packId,
      archivedAtIso: toIsoOrNull(deck.archivedAtMs),
      calibratedAtIso: toIsoOrNull(await latestCalibrationEndMs(conn, deck.id)),
      name: deck.name,
      description: deck.description,
      cardCount: cards.length,
      dueCount,
      newCount: cards.filter((c) => !stateByCard.has(c.id)).length,
      boxCounts: boxCountsFor(cards, stateByCard),
      settings: deck.settings,
      tags: [...new Set(cards.flatMap((c) => c.tags))].sort(),
    });
  }
  return result;
}

/** Days of forecast shown on the stats screen (today + 30 covers box 5). */
const FORECAST_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function deckStats(
  conn: DuckDBConnection,
  deckId: string,
  now: Date,
): Promise<DeckStats> {
  const cards = await listCards(conn, deckId, { activeOnly: true });
  const states = await listCardStates(conn, deckId);
  const stateByCard = new Map(states.map((s) => [s.cardId, s]));

  const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const forecast = new Map<string, number>();
  const nowMs = now.getTime();
  for (const card of cards) {
    const state = stateByCard.get(card.id);
    if (state === undefined) continue; // new cards enter by choice, not by due date
    const dueMs = state.box <= 1 ? nowMs : state.dueAtMs;
    if (dueMs === null || dueMs >= nowMs + FORECAST_DAYS * DAY_MS) continue;
    const key = dateOf(Math.max(dueMs, nowMs)); // overdue counts as today
    forecast.set(key, (forecast.get(key) ?? 0) + 1);
  }

  const medians = await conn.runAndReadAll(
    `SELECT strftime(shown_at, '%Y-%m-%d') AS day, median(elapsed_ms)
     FROM attempts WHERE deck_id = $1 AND outcome != 'calibration'
     GROUP BY day ORDER BY day`,
    [deckId],
  );

  return {
    deckId,
    boxCounts: boxCountsFor(cards, stateByCard),
    dueForecast: [...forecast.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateIso, count]) => ({ dateIso, count })),
    dailyMedianElapsed: medians.getRows().map((r) => ({
      dateIso: String(r[0]),
      medianMs: Math.round(Number(r[1])),
    })),
  };
}

export async function cardStats(conn: DuckDBConnection, deckId: string): Promise<CardStats[]> {
  const cards = await listCards(conn, deckId, { activeOnly: true });
  const states = await listCardStates(conn, deckId);
  const stateByCard = new Map(states.map((s) => [s.cardId, s]));

  const medians = await conn.runAndReadAll(
    `SELECT card_id, median(elapsed_ms) FROM attempts
     WHERE deck_id = $1 AND outcome != 'calibration' GROUP BY card_id`,
    [deckId],
  );
  const medianByCard = new Map<string, number>(
    medians.getRows().map((r: DuckDBValue[]) => [String(r[0]), Math.round(Number(r[1]))]),
  );

  return cards.map((card) => {
    const state = stateByCard.get(card.id);
    return {
      cardId: card.id,
      promptPreview: card.promptText ?? `[${card.promptType}]`,
      box: state?.box ?? 1,
      dueAtIso: toIsoOrNull(state?.dueAtMs ?? null),
      lastSuccessAtIso: toIsoOrNull(state?.lastSuccessAtMs ?? null),
      lifetimeCorrect: state?.lifetimeCorrect ?? 0,
      lifetimeWrong: state?.lifetimeWrong ?? 0,
      medianElapsedMs: medianByCard.get(card.id) ?? null,
    };
  });
}

export async function attemptRows(
  conn: DuckDBConnection,
  filter: AttemptFilter,
): Promise<AttemptRow[]> {
  const rows = await listAttempts(conn, {
    deckId: filter.deckId,
    cardId: filter.cardId,
    outcome: filter.outcome,
    sinceMs: filter.sinceIso === undefined ? undefined : Date.parse(filter.sinceIso),
    limit: filter.limit,
  });
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    deckId: r.deckId,
    cardId: r.cardId,
    shownAtIso: toIso(r.shownAtMs),
    timerMs: r.timerMs,
    elapsedMs: r.elapsedMs,
    response: r.response,
    outcome: r.outcome,
    isFirstOfSession: r.isFirstOfSession,
    boxBefore: r.boxBefore,
    boxAfter: r.boxAfter,
  }));
}

export async function trophyViews(conn: DuckDBConnection): Promise<TrophyView[]> {
  const rows = await listTrophies(conn);
  return rows.map((r) => ({
    sessionId: r.sessionId,
    deckId: r.deckId,
    deckName: r.deckName,
    endedAtIso: toIso(r.endedAtMs),
    size: r.jar.length,
    jar: r.jar,
  }));
}
