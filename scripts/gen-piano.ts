/**
 * Starter decks: written piano notation → note names, as programmatic SVG
 * staff images. One deck per clef: treble C4–C6 (15 naturals), bass C2–E4
 * (17 naturals). Tags: in-staff / ledger-above / ledger-below (+ clef), so
 * drilling can start with in-staff notes only. Answers accept both "c4" and
 * "c" — octave numbers can be ignored while learning.
 *
 * Geometry: 5 staff lines 12px apart; each diatonic step is 6px. Ledger
 * lines are drawn at every line position between the staff and the note.
 * The clefs are simplified embedded paths (stylized, not engraved SMuFL).
 *
 * Deterministic output (stable ordering, fixed zip mtime); golden test in
 * test/unit/generators.golden.test.ts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildDeckJson, zipPack, PackJsonCard } from '../src/main/packs';
import type { GeneratedPack } from './gen-kana';

const W = 220;
const H = 168;
const STAFF_X1 = 16;
const STAFF_X2 = 204;
const LINE_GAP = 12;
const TOP_LINE_Y = 60; // five lines: 60, 72, 84, 96, 108
const BOTTOM_LINE_Y = TOP_LINE_Y + 4 * LINE_GAP;
const STEP = LINE_GAP / 2; // one diatonic step (line ↔ space)
const NOTE_X = 150;

const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'] as const;

/** Diatonic index: c0=0, d0=1, ... b0=6, c1=7, ... */
function diatonicIndex(letter: string, octave: number): number {
  return octave * 7 + LETTERS.indexOf(letter as (typeof LETTERS)[number]);
}

interface Clef {
  name: 'treble' | 'bass';
  /** Note sitting ON the bottom staff line (treble: e4, bass: g2). */
  bottomLine: { letter: string; octave: number };
  /** Simplified clef glyph, drawn once per image. */
  svg: string;
}

// Engraved clef outlines extracted from Bravura (© Steinberg Media
// Technologies, SIL Open Font License 1.1, github.com/steinbergmedia/bravura),
// glyphs gClef U+E050 and fClef U+E062 at fontSize 48 (SMuFL: 1 em = 4 staff
// spaces; LINE_GAP 12 → 48). SMuFL registration puts the glyph origin on its
// reference line, so the paths are baked at x=30 with the G line at y=96
// (treble) and the F line at y=72 (bass) — no transforms needed.
const TREBLE_CLEF_SVG = `<path fill="black" d="M48 76.1C48 75.5 48 75.5 48.3 75.2C53.5 70.3 57.5 64.2 57.5 56.9C57.5 52.7 56.3 48.6 54.3 45.7C53.6 44.6 52.4 43.3 51.8 43.3C51.2 43.3 49.7 44.5 48.7 45.6C45.2 49.5 44 55.5 44 60.5C44 63.3 44.4 66.4 44.7 68.4C44.8 69 44.8 69.1 44.3 69.6C37.3 75.3 30 82.1 30 91.8C30 100.2 35.7 108.1 47.5 108.1C48.6 108.1 49.8 108 50.8 107.8C51.3 107.7 51.4 107.7 51.5 108.2C52.1 111.5 52.8 115.6 52.8 117.9C52.8 125 48 125.9 45.2 125.9C42.6 125.9 41.3 125.1 41.3 124.5C41.3 124.1 41.8 124 42.9 123.6C44.4 123.2 46.1 121.9 46.1 119.1C46.1 116.5 44.4 114.2 41.5 114.2C38.3 114.2 36.3 116.8 36.3 119.8C36.3 122.9 38.2 127.6 45.5 127.6C48.7 127.6 54.9 126.1 54.9 118C54.9 115.2 54 110.7 53.5 107.7C53.4 107.1 53.5 107.2 54.1 106.9C59 105 62.2 100.9 62.2 95.5C62.2 89.3 57.7 83.9 50.6 83.9C49.4 83.9 49.4 83.9 49.2 83M52.6 50.7C54.1 50.7 55.4 52 55.4 54.7C55.4 60 50.9 64.3 47.1 67.6C46.8 67.9 46.6 67.9 46.5 67.2C46.3 66 46.2 64.4 46.2 62.8C46.2 55.3 49.6 50.7 52.6 50.7M47.3 83.4C47.5 84.3 47.5 84.3 46.6 84.6C42.4 86 39.6 89.8 39.6 93.9C39.6 98.2 41.9 101.3 45.2 102.4C45.6 102.5 46.1 102.7 46.5 102.7C46.8 102.7 47 102.4 47 102.1C47 101.8 46.7 101.7 46.3 101.5C44.3 100.7 42.9 98.6 42.9 96.4C42.9 93.6 44.7 91.6 47.7 90.8C48.4 90.6 48.5 90.6 48.6 91.2L51 105.5C51.1 106 51.1 106 50.4 106.1C49.6 106.3 48.6 106.4 47.7 106.4C39.3 106.4 33.8 101.7 33.8 95C33.8 92.2 34.3 88.4 38.3 83.9C41.2 80.7 43.4 78.9 45.6 77.1C46.1 76.7 46.2 76.8 46.3 77.3M50.6 91.1C50.5 90.5 50.6 90.3 51.2 90.4C55.1 90.7 58.3 94 58.3 98.2C58.3 101.2 56.4 103.7 53.8 105C53.2 105.3 53.1 105.3 53 104.7"/>`;

const BASS_CLEF_SVG = `<path fill="black" d="M42.1 59.4C33.7 59.4 30 65.5 30 70.1C30 74 32 77.3 35.9 77.3C38.9 77.3 41 75.2 41 72.2C41 69.1 38.7 67.2 36.4 67.2C35.1 67.2 34.6 67.5 34 67.5C33.4 67.5 33.2 67.2 33.2 66.7C33.2 64.8 36.1 61.2 41 61.2C46.1 61.2 48.3 66.2 48.3 73.8C48.3 87.2 41.7 94.7 30.5 101C30 101.3 29.8 101.5 29.8 101.9C29.8 102.2 30 102.5 30.4 102.5C30.6 102.5 30.9 102.4 31.2 102.2C43 96.5 55.5 87.9 55.5 73.3C55.5 65 50.4 59.4 42.1 59.4M60.2 63.4C58.7 63.4 57.6 64.5 57.6 66C57.6 67.5 58.7 68.6 60.2 68.6C61.7 68.6 62.8 67.5 62.8 66C62.8 64.5 61.7 63.4 60.2 63.4M60.2 75.4C58.8 75.4 57.6 76.5 57.6 78C57.6 79.5 58.8 80.6 60.2 80.6C61.7 80.6 62.8 79.5 62.8 78C62.8 76.5 61.7 75.4 60.2 75.4"/>`;

const CLEFS: Clef[] = [
  { name: 'treble', bottomLine: { letter: 'e', octave: 4 }, svg: TREBLE_CLEF_SVG },
  { name: 'bass', bottomLine: { letter: 'g', octave: 2 }, svg: BASS_CLEF_SVG },
];

function noteY(clef: Clef, letter: string, octave: number): number {
  const steps = diatonicIndex(letter, octave) - diatonicIndex(clef.bottomLine.letter, clef.bottomLine.octave);
  return BOTTOM_LINE_Y - steps * STEP;
}

function ledgerYs(y: number): number[] {
  const ys: number[] = [];
  for (let ly = BOTTOM_LINE_Y + LINE_GAP; ly <= y; ly += LINE_GAP) ys.push(ly); // below
  for (let ly = TOP_LINE_Y - LINE_GAP; ly >= y; ly -= LINE_GAP) ys.push(ly); // above
  return ys;
}

function positionTag(y: number): string {
  if (y < TOP_LINE_Y) return 'ledger-above';
  if (y > BOTTOM_LINE_Y) return 'ledger-below';
  return 'in-staff';
}

export function staffSvg(clef: Clef, letter: string, octave: number): string {
  const y = noteY(clef, letter, octave);
  const lines = [0, 1, 2, 3, 4]
    .map((i) => TOP_LINE_Y + i * LINE_GAP)
    .map((ly) => `<line x1="${STAFF_X1}" y1="${ly}" x2="${STAFF_X2}" y2="${ly}" stroke="black" stroke-width="1.5"/>`)
    .join('\n  ');
  const ledgers = ledgerYs(y)
    .map((ly) => `<line x1="${NOTE_X - 14}" y1="${ly}" x2="${NOTE_X + 14}" y2="${ly}" stroke="black" stroke-width="1.5"/>`)
    .join('\n  ');
  // Stem: down (left side) when the note is above the middle line, else up.
  const middleY = TOP_LINE_Y + 2 * LINE_GAP;
  const stem =
    y < middleY
      ? `<line x1="${NOTE_X - 9}" y1="${y}" x2="${NOTE_X - 9}" y2="${y + 42}" stroke="black" stroke-width="1.5"/>`
      : `<line x1="${NOTE_X + 9}" y1="${y}" x2="${NOTE_X + 9}" y2="${y - 42}" stroke="black" stroke-width="1.5"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="white"/>
  ${lines}
  ${clef.svg}
  ${ledgers}
  <ellipse cx="${NOTE_X}" cy="${y}" rx="9.5" ry="6.5" fill="black" transform="rotate(-14 ${NOTE_X} ${y})"/>
  ${stem}
</svg>
`;
}

/** Naturals from (letterFrom, octaveFrom) to (letterTo, octaveTo) inclusive. */
function noteRange(
  from: { letter: string; octave: number },
  to: { letter: string; octave: number },
): { letter: string; octave: number }[] {
  const notes: { letter: string; octave: number }[] = [];
  for (let i = diatonicIndex(from.letter, from.octave); i <= diatonicIndex(to.letter, to.octave); i++) {
    notes.push({ letter: LETTERS[i % 7], octave: Math.floor(i / 7) });
  }
  return notes;
}

const RANGES = {
  treble: { from: { letter: 'c', octave: 4 }, to: { letter: 'c', octave: 6 } },
  bass: { from: { letter: 'c', octave: 2 }, to: { letter: 'e', octave: 4 } },
} as const;

function pianoDeck(clef: Clef): GeneratedPack {
  const range = RANGES[clef.name];
  const files = new Map<string, Uint8Array>();
  const cards: PackJsonCard[] = [];
  for (const { letter, octave } of noteRange(range.from, range.to)) {
    const id = `${clef.name}-${letter}${octave}`;
    const mediaPath = `media/${id}.svg`;
    files.set(mediaPath, new TextEncoder().encode(staffSvg(clef, letter, octave)));
    cards.push({
      id,
      prompt: { type: 'image', media: mediaPath },
      answers: [`${letter}${octave}`, letter],
      tags: [clef.name, positionTag(noteY(clef, letter, octave))],
    });
  }
  const deckJson = buildDeckJson({
    id: `piano-${clef.name}-v1`,
    name: `Piano — ${clef.name} clef`,
    description:
      `Single notes on the ${clef.name} staff, ` +
      `${range.from.letter.toUpperCase()}${range.from.octave}–` +
      `${range.to.letter.toUpperCase()}${range.to.octave}. ` +
      'Answer with the note name; the octave number is optional.',
    settings: { baseTimerMs: 7000, newCardsPerSession: 5, maxBox1ForNew: 10 },
    cards,
  });
  files.set('deck.json', new TextEncoder().encode(deckJson));
  return { filename: `piano-${clef.name}.deckpack`, bytes: zipPack(files) };
}

export function genPianoPacks(): GeneratedPack[] {
  return CLEFS.map(pianoDeck);
}

if (require.main === module) {
  const outDir = path.resolve(__dirname, '..', 'decks');
  mkdirSync(outDir, { recursive: true });
  for (const pack of genPianoPacks()) {
    writeFileSync(path.join(outDir, pack.filename), pack.bytes);
    console.log(`[gen-piano] wrote decks/${pack.filename} (${pack.bytes.length} bytes)`);
  }
}
