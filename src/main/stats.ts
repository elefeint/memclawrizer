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
  HallOfFame,
  TrophyView,
} from '../shared/api';
import { buildSessionQueue } from './leitner';
import type { CardRow, CardStateRow } from './queries';
import {
  latestCalibrationEndMs,
  timestampToMs,
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

// ---------------------------------------------------------------------------
// Hall of Fame (contract #6) — global aggregates, counts only (the
// no-percentages rule). Calibration rows/sessions are excluded everywhere.

/** Local calendar-day key, mirroring B9's setHours(0,0,0,0) semantics
 * (DST-correct; timestamps are stored UTC). */
function localDayKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function records(conn: DuckDBConnection): Promise<HallOfFame> {
  // Deck scores: every deck, archived included, ranked by sealed jars.
  const deckRows = await conn.runAndReadAll(
    `SELECT d.id, d.name, d.archived_at IS NOT NULL,
            (SELECT count(*) FROM sessions s
              WHERE s.deck_id = d.id AND s.perfect
                AND coalesce(s.kind, 'drill') = 'drill'),
            (SELECT count(*) FROM card_state cs
              WHERE cs.deck_id = d.id AND cs.box = 5),
            (SELECT count(*) FROM attempts a
              WHERE a.deck_id = d.id AND a.outcome != 'calibration')
     FROM decks d
     ORDER BY 4 DESC, d.name, d.id`,
  );
  const deckScores = deckRows.getRows().map((r) => ({
    deckId: String(r[0]),
    deckName: String(r[1]),
    archived: Boolean(r[2]),
    sealedJars: Number(r[3]),
    masteredCards: Number(r[4]),
    lifetimeAttempts: Number(r[5]),
  }));

  // Fastest correct FIRST attempt ever (outcome='correct' excludes
  // calibration rows by itself; is_first keeps retries out).
  const fastestRows = await conn.runAndReadAll(
    `SELECT coalesce(d.name, a.deck_id), c.prompt_text, c.prompt_type,
            a.elapsed_ms, a.shown_at
     FROM attempts a
     LEFT JOIN decks d ON d.id = a.deck_id
     LEFT JOIN cards c ON c.deck_id = a.deck_id AND c.id = a.card_id
     WHERE a.outcome = 'correct' AND a.is_first_of_session
     ORDER BY a.elapsed_ms ASC, a.id ASC LIMIT 1`,
  );
  const fr = fastestRows.getRows();
  const fastestCorrect =
    fr.length === 0
      ? null
      : {
          deckName: String(fr[0][0]),
          promptPreview:
            fr[0][1] !== null
              ? String(fr[0][1])
              : fr[0][2] !== null
                ? `[${String(fr[0][2])}]`
                : '[gone]',
          elapsedMs: Number(fr[0][3]),
          dateIso: toIso(timestampToMs(fr[0][4])),
        };

  // Largest perfect drill session (few rows; max + tiebreaks in JS).
  const perfectRows = await conn.runAndReadAll(
    `SELECT coalesce(d.name, s.deck_id), s.jar, s.ended_at
     FROM sessions s LEFT JOIN decks d ON d.id = s.deck_id
     WHERE s.perfect AND coalesce(s.kind, 'drill') = 'drill'
       AND s.jar IS NOT NULL AND s.ended_at IS NOT NULL`,
  );
  let largestPerfectSession: HallOfFame['largestPerfectSession'] = null;
  for (const r of perfectRows.getRows()) {
    const size = (JSON.parse(String(r[1])) as unknown[]).length;
    const endedMs = timestampToMs(r[2]);
    if (
      largestPerfectSession === null ||
      size > largestPerfectSession.size ||
      (size === largestPerfectSession.size &&
        endedMs > Date.parse(largestPerfectSession.dateIso))
    ) {
      largestPerfectSession = { deckName: String(r[0]), size, dateIso: toIso(endedMs) };
    }
  }

  // Local-day aggregates from a light timestamp projection (personal-scale
  // table); day keys computed in JS exactly like B9's local midnight.
  const tsRows = await conn.runAndReadAll(
    `SELECT shown_at FROM attempts WHERE outcome != 'calibration'`,
  );
  const perDay = new Map<string, number>();
  for (const r of tsRows.getRows()) {
    const key = localDayKey(timestampToMs(r[0]));
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  let busiestDay: HallOfFame['busiestDay'] = null;
  for (const [dateIso, attempts] of [...perDay.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (busiestDay === null || attempts > busiestDay.attempts) {
      busiestDay = { dateIso, attempts };
    }
  }

  return {
    deckScores,
    fastestCorrect,
    largestPerfectSession,
    busiestDay,
    daysPracticed: perDay.size,
    totalAttempts: tsRows.getRows().length,
  };
}
