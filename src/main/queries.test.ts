/**
 * Query-layer tests against real in-memory DuckDB (no SQL mocks).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, Db } from './db';
import {
  upsertDeck,
  getDeck,
  listDecks,
  updateDeckSettings,
  removeDeck,
  upsertCard,
  listCards,
  upsertMedia,
  getMedia,
  deleteUnreferencedMedia,
  upsertCardState,
  listCardStates,
  getCardState,
  insertSession,
  endSession,
  listTrophies,
  insertAttempt,
  listAttempts,
  DeckRow,
  CardRow,
} from './queries';

const T0 = Date.UTC(2026, 6, 5, 9, 0, 0); // 2026-07-05T09:00:00Z

const deck = (over: Partial<DeckRow> = {}): DeckRow => ({
  id: 'd1',
  name: 'Deck one',
  description: 'desc',
  settings: { baseTimerMs: 5000, newCardsPerSession: 5 },
  formatVersion: 1,
  importedAtMs: T0,
  ...over,
});

const card = (over: Partial<CardRow> = {}): CardRow => ({
  deckId: 'd1',
  id: 'c1',
  promptType: 'text',
  promptText: 'し',
  mediaId: null,
  answerMediaId: null,
  answers: ['shi', 'si'],
  hint: 'she has a fishing hook',
  tags: ['hiragana', 's-row'],
  active: true,
  ...over,
});

describe('queries', () => {
  let db: Db;
  beforeEach(async () => {
    db = await openDatabase(':memory:');
  });

  it('round-trips a deck, updates on conflict, and lists in stable order', async () => {
    await upsertDeck(db.conn, deck());
    await upsertDeck(db.conn, deck({ id: 'd2', name: 'Another', description: null }));

    const got = await getDeck(db.conn, 'd1');
    expect(got).toEqual(deck());
    expect(await getDeck(db.conn, 'nope')).toBeNull();

    // Upsert with same id replaces fields, no duplicate row.
    await upsertDeck(db.conn, deck({ name: 'Renamed', importedAtMs: T0 + 1000 }));
    const all = await listDecks(db.conn);
    expect(all.map((d) => d.name)).toEqual(['Another', 'Renamed']);
    expect(all[1].importedAtMs).toBe(T0 + 1000);
  });

  it('updates deck settings in place', async () => {
    await upsertDeck(db.conn, deck());
    await updateDeckSettings(db.conn, 'd1', { baseTimerMs: 1234, newCardsPerSession: 2 });
    expect((await getDeck(db.conn, 'd1'))?.settings).toEqual({
      baseTimerMs: 1234,
      newCardsPerSession: 2,
    });
  });

  it('round-trips cards with JSON answers/tags and upserts by (deck_id, id)', async () => {
    await upsertDeck(db.conn, deck());
    await upsertCard(db.conn, card());
    await upsertCard(db.conn, card({ id: 'c2', answers: ['ka'], hint: null, tags: [] }));

    let cards = await listCards(db.conn, 'd1');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toEqual(card());

    await upsertCard(db.conn, card({ answers: ['shi'], active: false }));
    cards = await listCards(db.conn, 'd1');
    expect(cards).toHaveLength(2);
    expect(cards[0].answers).toEqual(['shi']);
    expect(cards[0].active).toBe(false);

    expect(await listCards(db.conn, 'd1', { activeOnly: true })).toHaveLength(1);
  });

  it('round-trips media BLOBs byte-for-byte and prunes unreferenced media', async () => {
    await upsertDeck(db.conn, deck());
    const bytes = new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x00, 0xff, 0x80]);
    await upsertMedia(db.conn, { id: 'd1/media/a.svg', deckId: 'd1', mime: 'image/svg+xml', bytes });
    await upsertMedia(db.conn, {
      id: 'd1/media/orphan.svg',
      deckId: 'd1',
      mime: 'image/svg+xml',
      bytes: new Uint8Array([1, 2, 3]),
    });
    await upsertCard(db.conn, card({ promptType: 'image', promptText: null, mediaId: 'd1/media/a.svg' }));

    const got = await getMedia(db.conn, 'd1/media/a.svg');
    expect(got?.mime).toBe('image/svg+xml');
    expect(Array.from(got?.bytes ?? [])).toEqual(Array.from(bytes));

    await deleteUnreferencedMedia(db.conn, 'd1');
    expect(await getMedia(db.conn, 'd1/media/a.svg')).not.toBeNull();
    expect(await getMedia(db.conn, 'd1/media/orphan.svg')).toBeNull();
  });

  it('round-trips card_state including NULL timestamps', async () => {
    await upsertCardState(db.conn, {
      deckId: 'd1',
      cardId: 'c1',
      box: 1,
      dueAtMs: null,
      lastSuccessAtMs: null,
      lastSeenAtMs: null,
      lifetimeCorrect: 0,
      lifetimeWrong: 0,
    });
    expect(await getCardState(db.conn, 'd1', 'c1')).toMatchObject({
      box: 1,
      dueAtMs: null,
      lastSuccessAtMs: null,
    });

    await upsertCardState(db.conn, {
      deckId: 'd1',
      cardId: 'c1',
      box: 2,
      dueAtMs: T0 + 86_400_000,
      lastSuccessAtMs: T0,
      lastSeenAtMs: T0,
      lifetimeCorrect: 1,
      lifetimeWrong: 0,
    });
    const states = await listCardStates(db.conn, 'd1');
    expect(states).toHaveLength(1);
    expect(states[0].box).toBe(2);
    expect(states[0].dueAtMs).toBe(T0 + 86_400_000);
    expect(states[0].lastSuccessAtMs).toBe(T0);
  });

  it('records sessions; only perfect sessions keep their jar and appear as trophies', async () => {
    await upsertDeck(db.conn, deck());
    await insertSession(db.conn, {
      id: 's-perfect',
      deckId: 'd1',
      startedAtMs: T0,
      tagFilter: ['hiragana'],
      settings: { baseTimerMs: 5000, newCardsPerSession: 5 },
    });
    await insertSession(db.conn, {
      id: 's-imperfect',
      deckId: 'd1',
      startedAtMs: T0 + 1000,
      tagFilter: null,
      settings: { baseTimerMs: 5000, newCardsPerSession: 5 },
    });
    await endSession(db.conn, 's-perfect', T0 + 60_000, true, ['🦆', '🎲']);
    await endSession(db.conn, 's-imperfect', T0 + 120_000, false, ['🦆', null]);

    const trophies = await listTrophies(db.conn);
    expect(trophies).toHaveLength(1);
    expect(trophies[0]).toEqual({
      sessionId: 's-perfect',
      deckId: 'd1',
      deckName: 'Deck one',
      endedAtMs: T0 + 60_000,
      jar: ['🦆', '🎲'],
    });
  });

  it('inserts attempts with sequence ids and filters the audit log', async () => {
    const base = {
      sessionId: 's1',
      deckId: 'd1',
      timerMs: 5000,
      elapsedMs: 2000,
      response: 'shi',
      isFirstOfSession: true,
      boxBefore: 1,
      boxAfter: 2,
    } as const;
    await insertAttempt(db.conn, { ...base, cardId: 'c1', shownAtMs: T0, outcome: 'correct' });
    await insertAttempt(db.conn, {
      ...base,
      cardId: 'c2',
      shownAtMs: T0 + 10_000,
      outcome: 'wrong',
      isFirstOfSession: false,
      boxAfter: 1,
    });
    await insertAttempt(db.conn, {
      ...base,
      cardId: 'c1',
      deckId: 'other',
      shownAtMs: T0 + 20_000,
      outcome: 'timeout',
    });

    const all = await listAttempts(db.conn);
    expect(all).toHaveLength(3);
    expect(all[0].id).toBeGreaterThan(all[1].id); // newest first

    expect(await listAttempts(db.conn, { deckId: 'd1' })).toHaveLength(2);
    expect(await listAttempts(db.conn, { cardId: 'c1' })).toHaveLength(2);
    expect(await listAttempts(db.conn, { outcome: 'wrong' })).toHaveLength(1);
    expect(await listAttempts(db.conn, { sinceMs: T0 + 10_000 })).toHaveLength(2);
    expect(await listAttempts(db.conn, { deckId: 'd1', outcome: 'correct' })).toHaveLength(1);
    expect(await listAttempts(db.conn, { limit: 1 })).toHaveLength(1);

    const wrong = (await listAttempts(db.conn, { outcome: 'wrong' }))[0];
    expect(wrong).toMatchObject({
      cardId: 'c2',
      shownAtMs: T0 + 10_000,
      response: 'shi',
      isFirstOfSession: false,
      boxBefore: 1,
      boxAfter: 1,
    });
  });

  it('removes a deck without touching the audit log', async () => {
    await upsertDeck(db.conn, deck());
    await upsertCard(db.conn, card());
    await upsertMedia(db.conn, {
      id: 'd1/m',
      deckId: 'd1',
      mime: 'image/svg+xml',
      bytes: new Uint8Array([1]),
    });
    await upsertCardState(db.conn, {
      deckId: 'd1',
      cardId: 'c1',
      box: 3,
      dueAtMs: T0,
      lastSuccessAtMs: T0,
      lastSeenAtMs: T0,
      lifetimeCorrect: 5,
      lifetimeWrong: 1,
    });
    await insertAttempt(db.conn, {
      sessionId: 's1',
      deckId: 'd1',
      cardId: 'c1',
      shownAtMs: T0,
      timerMs: 5000,
      elapsedMs: 1000,
      response: 'shi',
      outcome: 'correct',
      isFirstOfSession: true,
      boxBefore: 1,
      boxAfter: 2,
    });

    await removeDeck(db.conn, 'd1');
    expect(await getDeck(db.conn, 'd1')).toBeNull();
    expect(await listCards(db.conn, 'd1')).toHaveLength(0);
    expect(await getMedia(db.conn, 'd1/m')).toBeNull();
    expect(await getCardState(db.conn, 'd1', 'c1')).toBeNull();
    expect(await listAttempts(db.conn, { deckId: 'd1' })).toHaveLength(1); // audit kept
  });
});
