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

// Stylized G-clef: a vertical sweep through the staff with a spiral that
// wraps the G line (y=96), plus the tail below.
const TREBLE_CLEF_SVG = `<g stroke="black" fill="none" stroke-width="3" stroke-linecap="round">
    <path d="M 46 132 C 40 122 40 112 47 106 C 56 98 66 90 64 76 C 62 64 54 58 50 66 C 44 78 50 100 52 118 C 54 134 52 142 46 146 C 41 149 34 146 34 140 C 34 135 38 132 42 133"/>
    <path d="M 47 106 C 38 112 36 122 43 128 C 50 134 60 130 60 121 C 60 113 52 108 47 110" fill="none"/>
  </g>`;

// Stylized F-clef: a filled dot on the F line (y=72), a curve sweeping down,
// and the two dots to the right of the F line.
const BASS_CLEF_SVG = `<g fill="black" stroke="none">
    <circle cx="34" cy="72" r="4.5"/>
    <path d="M 34 72 C 34 60 46 56 54 62 C 63 69 61 84 52 95 C 46 102 38 107 32 110 C 40 105 48 99 53 91 C 59 81 59 70 52 66 C 45 62 37 65 34 72 Z"/>
    <circle cx="66" cy="66" r="3"/>
    <circle cx="66" cy="78" r="3"/>
  </g>`;

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
    settings: { baseTimerMs: 7000, newCardsPerSession: 5 },
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
