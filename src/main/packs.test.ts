/**
 * Pack import/export against committed fixtures and real in-memory DuckDB.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase, Db } from './db';
import {
  parsePackJson,
  readPack,
  importPack,
  exportPack,
  mimeForMediaPath,
  PackError,
  PACK_FORMAT_VERSION,
} from './packs';
import {
  archiveDeck,
  getCardState,
  getDeck,
  getMedia,
  listCards,
  listCardStates,
  upsertCardState,
} from './queries';

const FIXTURES = path.resolve(__dirname, '../../test/fixtures');
const MINI = path.join(FIXTURES, 'mini.deckpack');
const NOW = new Date('2026-07-05T09:00:00Z');

function validDeckJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format_version: 1,
    id: 'd',
    name: 'D',
    settings: { base_timer_ms: 5000, new_cards_per_session: 5 },
    cards: [{ id: 'c1', prompt: { type: 'text', text: 'x' }, answers: ['x'] }],
    ...over,
  });
}

describe('parsePackJson', () => {
  it('parses a valid pack and normalizes answers', () => {
    const pack = parsePackJson(
      validDeckJson({
        cards: [
          { id: 'c1', prompt: { type: 'text', text: 'し' }, answers: [' SHI ', 'si', 'shi'] },
        ],
      }),
    );
    expect(pack.id).toBe('d');
    expect(pack.settings).toEqual({ baseTimerMs: 5000, newCardsPerSession: 5, maxBox1ForNew: 10 });
    // normalized and de-duplicated
    expect(pack.cards[0].answers).toEqual(['shi', 'si']);
    expect(pack.cards[0].tags).toEqual([]);
    expect(pack.cards[0].hint).toBeNull();
  });

  it.each([
    ['not json at all', /not valid JSON/],
    ['[1,2]', /top level must be an object/],
    [validDeckJson({ format_version: 'x' }), /format_version must be a positive integer/],
    [validDeckJson({ id: '' }), /id must be a non-empty string/],
    [validDeckJson({ name: undefined }), /name must be a non-empty string/],
    [validDeckJson({ settings: undefined }), /settings must be an object/],
    [
      validDeckJson({ settings: { base_timer_ms: -5, new_cards_per_session: 5 } }),
      /settings\.base_timer_ms must be a positive number/,
    ],
    [validDeckJson({ cards: 'nope' }), /cards must be an array/],
    [validDeckJson({ cards: [{ id: 'c' }] }), /cards\[0\]\.prompt must be an object/],
    [
      validDeckJson({ cards: [{ id: 'c', prompt: { type: 'video' }, answers: ['x'] }] }),
      /cards\[0\]\.prompt\.type must be "text", "image" or "audio"/,
    ],
    [
      validDeckJson({ cards: [{ id: 'c', prompt: { type: 'text' }, answers: ['x'] }] }),
      /cards\[0\]\.prompt\.text/,
    ],
    [
      validDeckJson({ cards: [{ id: 'c', prompt: { type: 'image' }, answers: ['x'] }] }),
      /cards\[0\]\.prompt\.media/,
    ],
    [
      validDeckJson({ cards: [{ id: 'c', prompt: { type: 'text', text: 'x' }, answers: [] }] }),
      /cards\[0\]\.answers must be a non-empty array/,
    ],
    [
      validDeckJson({ cards: [{ id: 'c', prompt: { type: 'text', text: 'x' }, answers: ['  '] }] }),
      /cards\[0\]\.answers\[0\] must not be blank/,
    ],
    [
      validDeckJson({
        cards: [
          { id: 'dup', prompt: { type: 'text', text: 'x' }, answers: ['x'] },
          { id: 'dup', prompt: { type: 'text', text: 'y' }, answers: ['y'] },
        ],
      }),
      /cards\[1\]\.id duplicates card id "dup"/,
    ],
  ])('rejects invalid deck.json with a helpful error (%#)', (json, message) => {
    expect(() => parsePackJson(json)).toThrow(PackError);
    expect(() => parsePackJson(json)).toThrow(message);
  });

  it('accepts both format_version 1 and 2 (v2 = answer-side audio)', () => {
    expect(parsePackJson(validDeckJson({ format_version: 1 })).formatVersion).toBe(1);
    expect(parsePackJson(validDeckJson({ format_version: 2 })).formatVersion).toBe(2);
  });

  it('parses optional answer_media and rejects non-audio paths', () => {
    const card = (answer_media: unknown) => ({
      id: 'c1',
      prompt: { type: 'text', text: 'x' },
      answers: ['x'],
      answer_media,
    });
    const ok = parsePackJson(validDeckJson({ format_version: 2, cards: [card('media/x.ogg')] }));
    expect(ok.cards[0].answerMediaPath).toBe('media/x.ogg');
    const none = parsePackJson(validDeckJson({ cards: [card(undefined)] }));
    expect(none.cards[0].answerMediaPath).toBeNull();
    expect(() =>
      parsePackJson(validDeckJson({ format_version: 2, cards: [card('media/x.svg')] })),
    ).toThrow(/answer_media must be an audio file/);
    expect(() =>
      parsePackJson(validDeckJson({ format_version: 2, cards: [card(42)] })),
    ).toThrow(/answer_media must be a string/);
  });

  it('refuses packs from a newer format_version', () => {
    expect(() => parsePackJson(validDeckJson({ format_version: PACK_FORMAT_VERSION + 1 }))).toThrow(
      /Update the app/,
    );
  });
});

describe('mimeForMediaPath', () => {
  it('maps known extensions and rejects unknown ones', () => {
    expect(mimeForMediaPath('media/a.svg')).toBe('image/svg+xml');
    expect(mimeForMediaPath('media/a.PNG')).toBe('image/png');
    expect(mimeForMediaPath('media/a.ogg')).toBe('audio/ogg');
    expect(() => mimeForMediaPath('media/a.exe')).toThrow(/unsupported media file type/);
  });
});

describe('readPack', () => {
  it('reads the mini zip fixture with its media', () => {
    const { deck, media } = readPack(MINI);
    expect(deck.id).toBe('mini');
    expect(deck.cards.map((c) => c.id)).toEqual(['ka', 'shi', 'dot', 'n']);
    expect(deck.cards[3].hint).toMatch(/lone consonant/);
    const svg = media.get('media/dot.svg');
    expect(svg).toBeDefined();
    expect(Buffer.from(svg as Uint8Array).toString('utf8')).toContain('<svg');
    // The answer-audio card (format v2) brings its ogg along.
    expect(deck.cards[3].answerMediaPath).toBe('media/n.ogg');
    const ogg = media.get('media/n.ogg');
    expect(ogg).toBeDefined();
    expect(Buffer.from((ogg as Uint8Array).slice(0, 4)).toString('latin1')).toBe('OggS');
  });

  it('reads the same pack in bare-directory form', () => {
    const dir = readPack(path.join(FIXTURES, 'mini-dir'));
    const zip = readPack(MINI);
    expect(dir.deck).toEqual(zip.deck);
    expect(Array.from(dir.media.get('media/dot.svg') ?? [])).toEqual(
      Array.from(zip.media.get('media/dot.svg') ?? []),
    );
  });

  it.each([
    ['broken-bad-json.deckpack', /not valid JSON/],
    ['broken-missing-media.deckpack', /card "ghost" references media\/ghost\.svg/],
    ['broken-format-999.deckpack', /format_version 999/],
    ['broken-missing-answer-media.deckpack', /card "mute" references media\/mute\.ogg/],
    ['broken-not-a-zip.deckpack', /not a readable zip/],
    ['broken-no-deck-json.deckpack', /no deck\.json/],
  ])('rejects %s with a helpful error', (fixture, message) => {
    expect(() => readPack(path.join(FIXTURES, fixture))).toThrow(message);
  });
});

describe('importPack', () => {
  let db: Db;
  beforeEach(async () => {
    db = await openDatabase(':memory:');
  });

  it('imports the mini fixture: deck, cards, media, and no card_state rows', async () => {
    const result = await importPack(db.conn, MINI, NOW);
    expect(result).toEqual({
      deckId: 'mini',
      name: 'Mini fixture deck',
      cardsAdded: 4,
      cardsUpdated: 0,
      orphanedCardIds: [],
    });

    const cards = await listCards(db.conn, 'mini');
    expect(cards).toHaveLength(4);
    const dot = cards.find((c) => c.id === 'dot');
    expect(dot?.promptType).toBe('image');
    expect(dot?.mediaId).toBe('mini/media/dot.svg');

    const media = await getMedia(db.conn, 'mini/media/dot.svg');
    expect(media?.mime).toBe('image/svg+xml');

    // Answer audio (format v2) is stored like prompt media and linked.
    const n = cards.find((c) => c.id === 'n');
    expect(n?.answerMediaId).toBe('mini/media/n.ogg');
    const ogg = await getMedia(db.conn, 'mini/media/n.ogg');
    expect(ogg?.mime).toBe('audio/ogg');
    expect(Buffer.from((ogg?.bytes ?? new Uint8Array()).slice(0, 4)).toString('latin1')).toBe('OggS');
    expect(Buffer.from(media?.bytes ?? new Uint8Array()).toString('utf8')).toContain('<svg');

    // New cards are "new": no state rows at all.
    expect(await listCardStates(db.conn, 'mini')).toHaveLength(0);
  });

  it('re-import upserts: preserves card_state for existing ids, reports orphans, adds new cards stateless', async () => {
    await importPack(db.conn, MINI, NOW);
    // Simulate progress on 'shi'.
    await upsertCardState(db.conn, {
      deckId: 'mini',
      cardId: 'shi',
      box: 4,
      dueAtMs: NOW.getTime() + 1000,
      lastSuccessAtMs: NOW.getTime(),
      lastSeenAtMs: NOW.getTime(),
      lifetimeCorrect: 9,
      lifetimeWrong: 2,
    });

    // v2 of the pack: 'shi' updated, 'ka'/'dot'/'n' gone, 'fu' added.
    const dir = mkdtempSync(path.join(tmpdir(), 'memclawrizer-pack-'));
    try {
      const { writeFileSync, mkdirSync } = await import('node:fs');
      mkdirSync(path.join(dir, 'media'), { recursive: true });
      writeFileSync(
        path.join(dir, 'deck.json'),
        JSON.stringify({
          format_version: 1,
          id: 'mini',
          name: 'Mini v2',
          settings: { base_timer_ms: 4000, new_cards_per_session: 3 },
          cards: [
            { id: 'shi', prompt: { type: 'text', text: 'し' }, answers: ['shi', 'si', 'shi2'] },
            { id: 'fu', prompt: { type: 'text', text: 'ふ' }, answers: ['fu', 'hu'] },
          ],
        }),
      );

      const result = await importPack(db.conn, dir, NOW);
      expect(result).toEqual({
        deckId: 'mini',
        name: 'Mini v2',
        cardsAdded: 1,
        cardsUpdated: 1,
        orphanedCardIds: ['dot', 'ka', 'n'],
      });

      // Existing id kept its Leitner state; content updated.
      const state = await getCardState(db.conn, 'mini', 'shi');
      expect(state?.box).toBe(4);
      expect(state?.lifetimeCorrect).toBe(9);
      const cards = await listCards(db.conn, 'mini');
      expect(cards.find((c) => c.id === 'shi')?.answers).toEqual(['shi', 'si', 'shi2']);

      // New card has no state.
      expect(await getCardState(db.conn, 'mini', 'fu')).toBeNull();

      // Orphans are reported but untouched (caller decides).
      expect(cards.map((c) => c.id).sort()).toEqual(['dot', 'fu', 'ka', 'n', 'shi']);
      expect(cards.find((c) => c.id === 'ka')?.active).toBe(true);

      // Media no longer referenced by any card was pruned.
      expect(await getMedia(db.conn, 'mini/media/dot.svg')).not.toBeNull(); // 'dot' card still exists
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prunes media once no card references it anymore', async () => {
    await importPack(db.conn, MINI, NOW);
    const dir = mkdtempSync(path.join(tmpdir(), 'memclawrizer-pack-'));
    try {
      const { writeFileSync } = await import('node:fs');
      // Same deck id, but now every card (including 'dot') is text-only.
      writeFileSync(
        path.join(dir, 'deck.json'),
        JSON.stringify({
          format_version: 1,
          id: 'mini',
          name: 'Mini textified',
          settings: { base_timer_ms: 5000, new_cards_per_session: 5 },
          cards: [{ id: 'dot', prompt: { type: 'text', text: 'dot?' }, answers: ['dot'] }],
        }),
      );
      await importPack(db.conn, dir, NOW);
      expect(await getMedia(db.conn, 'mini/media/dot.svg')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('archived decks are frozen: re-import mints a fresh deck, history untouched', async () => {
    const first = await importPack(db.conn, MINI, NOW);
    expect(first.deckId).toBe('mini');
    // Progress + audit on the original.
    await upsertCardState(db.conn, {
      deckId: 'mini', cardId: 'shi', box: 5, dueAtMs: NOW.getTime(),
      lastSuccessAtMs: NOW.getTime(), lastSeenAtMs: NOW.getTime(),
      lifetimeCorrect: 7, lifetimeWrong: 0,
    });
    await archiveDeck(db.conn, 'mini', NOW.getTime());

    // Re-import "the same" pack → brand-new deck with a minted internal id.
    const second = await importPack(db.conn, MINI, new Date(NOW.getTime() + 1000));
    expect(second).toEqual({
      deckId: 'mini#2',
      name: 'Mini fixture deck',
      cardsAdded: 4,
      cardsUpdated: 0,
      orphanedCardIds: [],
    });
    const fresh = await getDeck(db.conn, 'mini#2');
    expect(fresh?.packId).toBe('mini');
    expect(fresh?.archivedAtMs).toBeNull();
    // Fresh start: no state; media namespaced under the new internal id.
    expect(await listCardStates(db.conn, 'mini#2')).toHaveLength(0);
    expect(await getMedia(db.conn, 'mini#2/media/dot.svg')).not.toBeNull();

    // The archived deck is untouched: still archived, cards/state/media intact.
    const archived = await getDeck(db.conn, 'mini');
    expect(archived?.archivedAtMs).toBe(NOW.getTime());
    expect(await listCards(db.conn, 'mini')).toHaveLength(4);
    expect((await getCardState(db.conn, 'mini', 'shi'))?.box).toBe(5);
    expect(await getMedia(db.conn, 'mini/media/dot.svg')).not.toBeNull();

    // A further re-import upserts the ACTIVE successor, not a third deck.
    const third = await importPack(db.conn, MINI, new Date(NOW.getTime() + 2000));
    expect(third.deckId).toBe('mini#2');
    expect(third.cardsUpdated).toBe(4);
    expect(third.cardsAdded).toBe(0);

    // Export of the successor keeps the author-chosen pack id.
    const dir = mkdtempSync(path.join(tmpdir(), 'memclawrizer-export-'));
    try {
      const out = path.join(dir, 'reexport.deckpack');
      await exportPack(db.conn, 'mini#2', out);
      expect(readPack(out).deck.id).toBe('mini');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('mints #2, #3, ... skipping ids taken by ANY deck, archived included', async () => {
    await importPack(db.conn, MINI, NOW);
    await archiveDeck(db.conn, 'mini', NOW.getTime());
    await importPack(db.conn, MINI, NOW); // → mini#2
    await archiveDeck(db.conn, 'mini#2', NOW.getTime());
    const r = await importPack(db.conn, MINI, NOW); // both taken → mini#3
    expect(r.deckId).toBe('mini#3');
  });

  it('leaves the DB untouched when the pack is invalid', async () => {
    await expect(
      importPack(db.conn, path.join(FIXTURES, 'broken-format-999.deckpack'), NOW),
    ).rejects.toThrow(/format_version 999/);
    const reader = await db.conn.runAndReadAll('SELECT count(*) FROM decks');
    expect(Number(reader.getRows()[0][0])).toBe(0);
  });
});

describe('exportPack', () => {
  it('round-trips: import → export → re-read equals the original content', async () => {
    const db = await openDatabase(':memory:');
    await importPack(db.conn, MINI, NOW);

    const dir = mkdtempSync(path.join(tmpdir(), 'memclawrizer-export-'));
    try {
      const out = path.join(dir, 'mini-export.deckpack');
      await exportPack(db.conn, 'mini', out);

      const original = readPack(MINI);
      const reread = readPack(out);
      expect(reread.deck.id).toBe(original.deck.id);
      expect(reread.deck.name).toBe(original.deck.name);
      expect(reread.deck.settings).toEqual(original.deck.settings);
      // Same cards (export orders by id).
      const byId = (p: typeof original) =>
        [...p.deck.cards].sort((a, b) => a.id.localeCompare(b.id));
      expect(byId(reread)).toEqual(byId(original));
      expect(Array.from(reread.media.get('media/dot.svg') ?? [])).toEqual(
        Array.from(original.media.get('media/dot.svg') ?? []),
      );
      // answer_media (format v2) round-trips: path in deck.json + bytes.
      expect(reread.deck.cards.find((c) => c.id === 'n')?.answerMediaPath).toBe('media/n.ogg');
      expect(Array.from(reread.media.get('media/n.ogg') ?? [])).toEqual(
        Array.from(original.media.get('media/n.ogg') ?? []),
      );

      // Determinism: exporting again produces identical bytes.
      const out2 = path.join(dir, 'mini-export-2.deckpack');
      await exportPack(db.conn, 'mini', out2);
      expect(Buffer.compare(readFileSync(out), readFileSync(out2))).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to export a nonexistent deck', async () => {
    const db = await openDatabase(':memory:');
    await expect(exportPack(db.conn, 'nope', '/tmp/never-written.deckpack')).rejects.toThrow(
      /no deck with id "nope"/,
    );
  });
});
