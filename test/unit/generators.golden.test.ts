/**
 * Golden tests for the deck generators: regenerate and byte-diff against the
 * committed decks/*.deckpack, so any accidental change to the romaji tables
 * or the SVG math shows up as a failing diff (reviewed by eye once, then
 * refreshed with `npm run gen:decks`). Also proves every generated pack
 * imports cleanly through the normal packs.ts path.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { genKanaPacks } from '../../scripts/gen-kana';
import { genPianoPacks } from '../../scripts/gen-piano';
import { openDatabase } from '../../src/main/db';
import { importPack, readPack } from '../../src/main/packs';
import { listCards } from '../../src/main/queries';

const DECKS_DIR = path.resolve(__dirname, '../../decks');
const ALL = [...genKanaPacks(), ...genPianoPacks()];

describe('generator goldens', () => {
  it.each(ALL.map((p) => [p.filename, p] as const))(
    'decks/%s matches a fresh regeneration byte-for-byte',
    (filename, pack) => {
      const committed = readFileSync(path.join(DECKS_DIR, filename));
      expect(
        Buffer.compare(committed, Buffer.from(pack.bytes)),
        `decks/${filename} is stale — regenerate with \`npm run gen:decks\` and review the diff`,
      ).toBe(0);
    },
  );

  it('generation is deterministic run-to-run', () => {
    const again = [...genKanaPacks(), ...genPianoPacks()];
    for (let i = 0; i < ALL.length; i++) {
      expect(Buffer.compare(Buffer.from(ALL[i].bytes), Buffer.from(again[i].bytes))).toBe(0);
    }
  });

  it.each(ALL.map((p) => [p.filename] as const))(
    '%s imports cleanly through packs.ts',
    async (filename) => {
      const db = await openDatabase(':memory:');
      const result = await importPack(db.conn, path.join(DECKS_DIR, filename), new Date());
      expect(result.cardsAdded).toBeGreaterThan(0);
      expect(result.orphanedCardIds).toEqual([]);
    },
  );
});

describe('kana decks', () => {
  const hiraPack = readPack(path.join(DECKS_DIR, 'kana-hiragana.deckpack'));
  const kataPack = readPack(path.join(DECKS_DIR, 'kana-katakana.deckpack'));
  const hira = hiraPack.deck;
  const kata = kataPack.deck;

  it('embed answer-side audio on every card, shared across syllabaries (format v2)', () => {
    for (const pack of [hiraPack, kataPack]) {
      expect(pack.deck.formatVersion).toBe(2);
      for (const card of pack.deck.cards) {
        expect(card.answerMediaPath, card.id).toMatch(/^media\/.+\.ogg$/);
        const ogg = pack.media.get(card.answerMediaPath as string);
        expect(ogg, `${card.id} audio bytes`).toBeDefined();
        expect(Buffer.from((ogg as Uint8Array).slice(0, 4)).toString('latin1')).toBe('OggS');
      }
      expect(pack.media.size).toBe(104); // one ogg per mora
    }
    // Same recording for both syllabaries: hira-shi and kata-shi share bytes.
    expect(Array.from(hiraPack.media.get('media/shi.ogg') ?? [])).toEqual(
      Array.from(kataPack.media.get('media/shi.ogg') ?? []),
    );
  });

  it('cover 46 base + 25 voiced/semi-voiced + 33 yōon = 104 cards per script', () => {
    for (const deck of [hira, kata]) {
      expect(deck.cards).toHaveLength(104);
      expect(deck.cards.filter((c) => c.tags.includes('yoon'))).toHaveLength(33);
      expect(deck.cards.filter((c) => c.tags.includes('semi-voiced'))).toHaveLength(8); // 5 + pya/pyu/pyo
    }
    expect(hira.settings).toEqual({ baseTimerMs: 5000, newCardsPerSession: 5 });
  });

  it('accept common romanization variants alongside Hepburn', () => {
    const byId = new Map(hira.cards.map((c) => [c.id, c]));
    expect(byId.get('hira-shi')?.answers).toEqual(['shi', 'si']);
    expect(byId.get('hira-tsu')?.answers).toEqual(['tsu', 'tu']);
    expect(byId.get('hira-fu')?.answers).toEqual(['fu', 'hu']);
    expect(byId.get('hira-ji')?.answers).toEqual(['ji', 'zi']);
    expect(byId.get('hira-sha')?.answers).toEqual(['sha', 'sya']);
    expect(byId.get('hira-ja')?.answers).toEqual(['ja', 'jya', 'zya']);
    expect(byId.get('hira-wo')?.answers).toEqual(['wo', 'o']);
  });

  it('katakana glyphs are the shifted twins of the hiragana ones', () => {
    const kShi = kata.cards.find((c) => c.id === 'kata-shi');
    expect(kShi?.promptText).toBe('シ');
    const kKya = kata.cards.find((c) => c.id === 'kata-kya');
    expect(kKya?.promptText).toBe('キャ');
    expect(kata.cards.every((c) => c.tags.includes('katakana'))).toBe(true);
  });

  it('tags rows so progressive drilling works', () => {
    expect(hira.cards.filter((c) => c.tags.includes('k-row')).map((c) => c.id)).toEqual([
      'hira-ka', 'hira-ki', 'hira-ku', 'hira-ke', 'hira-ko',
      'hira-kya', 'hira-kyu', 'hira-kyo',
    ]);
  });
});

describe('piano decks', () => {
  const treble = readPack(path.join(DECKS_DIR, 'piano-treble.deckpack'));
  const bass = readPack(path.join(DECKS_DIR, 'piano-bass.deckpack'));

  it('cover the DESIGN ranges: treble C4–C6 (15), bass C2–E4 (17), all with SVG media', () => {
    expect(treble.deck.cards).toHaveLength(15);
    expect(bass.deck.cards).toHaveLength(17);
    for (const pack of [treble, bass]) {
      for (const card of pack.deck.cards) {
        expect(card.promptType).toBe('image');
        const svg = pack.media.get(card.mediaPath as string);
        expect(svg, `${card.id} media`).toBeDefined();
        expect(Buffer.from(svg as Uint8Array).toString('utf8')).toContain('<svg');
      }
    }
    expect(treble.deck.settings).toEqual({ baseTimerMs: 7000, newCardsPerSession: 5 });
  });

  it('accepts both octave-numbered and bare note names', () => {
    const c4 = treble.deck.cards.find((c) => c.id === 'treble-c4');
    expect(c4?.answers).toEqual(['c4', 'c']);
  });

  it('tags staff position for progressive drilling', () => {
    const tag = (deck: typeof treble, id: string) =>
      deck.deck.cards.find((c) => c.id === id)?.tags;
    expect(tag(treble, 'treble-c4')).toEqual(['treble', 'ledger-below']);
    expect(tag(treble, 'treble-e4')).toEqual(['treble', 'in-staff']); // bottom line
    expect(tag(treble, 'treble-f5')).toEqual(['treble', 'in-staff']); // top line
    expect(tag(treble, 'treble-g5')).toEqual(['treble', 'ledger-above']);
    expect(tag(treble, 'treble-c6')).toEqual(['treble', 'ledger-above']);
    expect(tag(bass, 'bass-c2')).toEqual(['bass', 'ledger-below']);
    expect(tag(bass, 'bass-g2')).toEqual(['bass', 'in-staff']); // bottom line
    expect(tag(bass, 'bass-c4')).toEqual(['bass', 'ledger-above']); // middle C above bass staff
  });

  it('draws the right ledger lines (spot checks on the SVG text)', () => {
    const svgOf = (pack: typeof treble, id: string) =>
      Buffer.from(pack.media.get(`media/${id}.svg`) as Uint8Array).toString('utf8');
    const ledgers = (svg: string) => svg.match(/x1="136"[^/]*y1="(\d+)"/g) ?? [];

    // Middle C on treble: exactly one ledger line, through the note.
    expect(ledgers(svgOf(treble, 'treble-c4'))).toHaveLength(1);
    // C6: two ledger lines above.
    expect(ledgers(svgOf(treble, 'treble-c6'))).toHaveLength(2);
    // D4 hangs below the treble staff but needs no ledger line.
    expect(ledgers(svgOf(treble, 'treble-d4'))).toHaveLength(0);
    // In-staff notes never get ledger lines.
    expect(ledgers(svgOf(treble, 'treble-b4'))).toHaveLength(0);
    // Bass C2: two ledger lines below.
    expect(ledgers(svgOf(bass, 'bass-c2'))).toHaveLength(2);
    // Middle C on bass: one ledger above.
    expect(ledgers(svgOf(bass, 'bass-c4'))).toHaveLength(1);
  });

  it('imports into the drill: 104-card kana deck and both clefs coexist', async () => {
    const db = await openDatabase(':memory:');
    for (const f of ['kana-hiragana.deckpack', 'piano-treble.deckpack', 'piano-bass.deckpack']) {
      await importPack(db.conn, path.join(DECKS_DIR, f), new Date());
    }
    expect(await listCards(db.conn, 'kana-hiragana-v1')).toHaveLength(104);
    expect(await listCards(db.conn, 'piano-treble-v1')).toHaveLength(15);
    expect(await listCards(db.conn, 'piano-bass-v1')).toHaveLength(17);
  });
});
