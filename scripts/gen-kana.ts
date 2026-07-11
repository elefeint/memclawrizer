/**
 * Starter decks: hiragana → romaji and katakana → romaji.
 * 46 base kana + voiced/semi-voiced rows + yōon digraphs = 104 cards each.
 * Answers are Hepburn first plus common romanization variants (shi/si,
 * tsu/tu, fu/hu, ji/zi, sha/sya, ...). Tags: script + row (+ voiced/
 * semi-voiced/yoon) so drilling can start with a single row.
 *
 * Output is deterministic (stable card order, fixed zip mtime): rerunning
 * `npm run gen:decks` with unchanged tables produces byte-identical packs.
 * Golden test: test/unit/generators.golden.test.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildDeckJson, zipPack, PackJsonCard } from '../src/main/packs';

export interface KanaEntry {
  /** Stable card id suffix; usually the primary romaji (nihon-shiki where
   * Hepburn collides: di=ぢ, du=づ). */
  id: string;
  /** Hiragana glyph; katakana derived by the fixed U+60 codepoint shift. */
  hira: string;
  /** Accepted answers, Hepburn first. */
  answers: string[];
  /** Row tag + optional flags (voiced, semi-voiced, yoon). */
  tags: string[];
}

const K = (id: string, hira: string, answers: string[], tags: string[]): KanaEntry => ({
  id, hira, answers, tags,
});

/** Exported for gen-kana-audio.ts (one ogg per unique entry id). */
export const TABLE: KanaEntry[] = [
  // -- gojūon (46) --
  K('a', 'あ', ['a'], ['a-row']),
  K('i', 'い', ['i'], ['a-row']),
  K('u', 'う', ['u'], ['a-row']),
  K('e', 'え', ['e'], ['a-row']),
  K('o', 'お', ['o'], ['a-row']),
  K('ka', 'か', ['ka'], ['k-row']),
  K('ki', 'き', ['ki'], ['k-row']),
  K('ku', 'く', ['ku'], ['k-row']),
  K('ke', 'け', ['ke'], ['k-row']),
  K('ko', 'こ', ['ko'], ['k-row']),
  K('sa', 'さ', ['sa'], ['s-row']),
  K('shi', 'し', ['shi', 'si'], ['s-row']),
  K('su', 'す', ['su'], ['s-row']),
  K('se', 'せ', ['se'], ['s-row']),
  K('so', 'そ', ['so'], ['s-row']),
  K('ta', 'た', ['ta'], ['t-row']),
  K('chi', 'ち', ['chi', 'ti'], ['t-row']),
  K('tsu', 'つ', ['tsu', 'tu'], ['t-row']),
  K('te', 'て', ['te'], ['t-row']),
  K('to', 'と', ['to'], ['t-row']),
  K('na', 'な', ['na'], ['n-row']),
  K('ni', 'に', ['ni'], ['n-row']),
  K('nu', 'ぬ', ['nu'], ['n-row']),
  K('ne', 'ね', ['ne'], ['n-row']),
  K('no', 'の', ['no'], ['n-row']),
  K('ha', 'は', ['ha'], ['h-row']),
  K('hi', 'ひ', ['hi'], ['h-row']),
  K('fu', 'ふ', ['fu', 'hu'], ['h-row']),
  K('he', 'へ', ['he'], ['h-row']),
  K('ho', 'ほ', ['ho'], ['h-row']),
  K('ma', 'ま', ['ma'], ['m-row']),
  K('mi', 'み', ['mi'], ['m-row']),
  K('mu', 'む', ['mu'], ['m-row']),
  K('me', 'め', ['me'], ['m-row']),
  K('mo', 'も', ['mo'], ['m-row']),
  K('ya', 'や', ['ya'], ['y-row']),
  K('yu', 'ゆ', ['yu'], ['y-row']),
  K('yo', 'よ', ['yo'], ['y-row']),
  K('ra', 'ら', ['ra'], ['r-row']),
  K('ri', 'り', ['ri'], ['r-row']),
  K('ru', 'る', ['ru'], ['r-row']),
  K('re', 'れ', ['re'], ['r-row']),
  K('ro', 'ろ', ['ro'], ['r-row']),
  K('wa', 'わ', ['wa'], ['w-row']),
  K('wo', 'を', ['wo', 'o'], ['w-row']),
  K('n', 'ん', ['n'], ['special']),
  // -- voiced (dakuten) --
  K('ga', 'が', ['ga'], ['g-row', 'voiced']),
  K('gi', 'ぎ', ['gi'], ['g-row', 'voiced']),
  K('gu', 'ぐ', ['gu'], ['g-row', 'voiced']),
  K('ge', 'げ', ['ge'], ['g-row', 'voiced']),
  K('go', 'ご', ['go'], ['g-row', 'voiced']),
  K('za', 'ざ', ['za'], ['z-row', 'voiced']),
  K('ji', 'じ', ['ji', 'zi'], ['z-row', 'voiced']),
  K('zu', 'ず', ['zu'], ['z-row', 'voiced']),
  K('ze', 'ぜ', ['ze'], ['z-row', 'voiced']),
  K('zo', 'ぞ', ['zo'], ['z-row', 'voiced']),
  K('da', 'だ', ['da'], ['d-row', 'voiced']),
  K('di', 'ぢ', ['ji', 'di', 'dji'], ['d-row', 'voiced']),
  K('du', 'づ', ['zu', 'du', 'dzu'], ['d-row', 'voiced']),
  K('de', 'で', ['de'], ['d-row', 'voiced']),
  K('do', 'ど', ['do'], ['d-row', 'voiced']),
  K('ba', 'ば', ['ba'], ['b-row', 'voiced']),
  K('bi', 'び', ['bi'], ['b-row', 'voiced']),
  K('bu', 'ぶ', ['bu'], ['b-row', 'voiced']),
  K('be', 'べ', ['be'], ['b-row', 'voiced']),
  K('bo', 'ぼ', ['bo'], ['b-row', 'voiced']),
  // -- semi-voiced (handakuten) --
  K('pa', 'ぱ', ['pa'], ['p-row', 'semi-voiced']),
  K('pi', 'ぴ', ['pi'], ['p-row', 'semi-voiced']),
  K('pu', 'ぷ', ['pu'], ['p-row', 'semi-voiced']),
  K('pe', 'ぺ', ['pe'], ['p-row', 'semi-voiced']),
  K('po', 'ぽ', ['po'], ['p-row', 'semi-voiced']),
  // -- yōon digraphs --
  K('kya', 'きゃ', ['kya'], ['k-row', 'yoon']),
  K('kyu', 'きゅ', ['kyu'], ['k-row', 'yoon']),
  K('kyo', 'きょ', ['kyo'], ['k-row', 'yoon']),
  K('sha', 'しゃ', ['sha', 'sya'], ['s-row', 'yoon']),
  K('shu', 'しゅ', ['shu', 'syu'], ['s-row', 'yoon']),
  K('sho', 'しょ', ['sho', 'syo'], ['s-row', 'yoon']),
  K('cha', 'ちゃ', ['cha', 'tya'], ['t-row', 'yoon']),
  K('chu', 'ちゅ', ['chu', 'tyu'], ['t-row', 'yoon']),
  K('cho', 'ちょ', ['cho', 'tyo'], ['t-row', 'yoon']),
  K('nya', 'にゃ', ['nya'], ['n-row', 'yoon']),
  K('nyu', 'にゅ', ['nyu'], ['n-row', 'yoon']),
  K('nyo', 'にょ', ['nyo'], ['n-row', 'yoon']),
  K('hya', 'ひゃ', ['hya'], ['h-row', 'yoon']),
  K('hyu', 'ひゅ', ['hyu'], ['h-row', 'yoon']),
  K('hyo', 'ひょ', ['hyo'], ['h-row', 'yoon']),
  K('mya', 'みゃ', ['mya'], ['m-row', 'yoon']),
  K('myu', 'みゅ', ['myu'], ['m-row', 'yoon']),
  K('myo', 'みょ', ['myo'], ['m-row', 'yoon']),
  K('rya', 'りゃ', ['rya'], ['r-row', 'yoon']),
  K('ryu', 'りゅ', ['ryu'], ['r-row', 'yoon']),
  K('ryo', 'りょ', ['ryo'], ['r-row', 'yoon']),
  K('gya', 'ぎゃ', ['gya'], ['g-row', 'voiced', 'yoon']),
  K('gyu', 'ぎゅ', ['gyu'], ['g-row', 'voiced', 'yoon']),
  K('gyo', 'ぎょ', ['gyo'], ['g-row', 'voiced', 'yoon']),
  K('ja', 'じゃ', ['ja', 'jya', 'zya'], ['z-row', 'voiced', 'yoon']),
  K('ju', 'じゅ', ['ju', 'jyu', 'zyu'], ['z-row', 'voiced', 'yoon']),
  K('jo', 'じょ', ['jo', 'jyo', 'zyo'], ['z-row', 'voiced', 'yoon']),
  K('bya', 'びゃ', ['bya'], ['b-row', 'voiced', 'yoon']),
  K('byu', 'びゅ', ['byu'], ['b-row', 'voiced', 'yoon']),
  K('byo', 'びょ', ['byo'], ['b-row', 'voiced', 'yoon']),
  K('pya', 'ぴゃ', ['pya'], ['p-row', 'semi-voiced', 'yoon']),
  K('pyu', 'ぴゅ', ['pyu'], ['p-row', 'semi-voiced', 'yoon']),
  K('pyo', 'ぴょ', ['pyo'], ['p-row', 'semi-voiced', 'yoon']),
];

const HIRA_TO_KATA_SHIFT = 0x60; // U+3041.. → U+30A1..

function toKatakana(hira: string): string {
  return [...hira]
    .map((ch) => String.fromCodePoint((ch.codePointAt(0) as number) + HIRA_TO_KATA_SHIFT))
    .join('');
}

export interface GeneratedPack {
  filename: string;
  bytes: Uint8Array;
}

/**
 * Answer-side audio (format v2): committed oggs authored ONCE by
 * scripts/gen-kana-audio.ts. When scripts/audio/kana/ has <id>.ogg files they
 * are embedded (hiragana and katakana share the same recordings); when the
 * directory is absent or empty the decks generate exactly as before, silent.
 */
const AUDIO_DIR = path.resolve(__dirname, 'audio', 'kana');

function audioFor(id: string): Uint8Array | null {
  const p = path.join(AUDIO_DIR, `${id}.ogg`);
  return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
}

function kanaDeck(script: 'hiragana' | 'katakana'): GeneratedPack {
  const files = new Map<string, Uint8Array>();
  const cards: PackJsonCard[] = TABLE.map((e) => {
    const audio = audioFor(e.id);
    const mediaPath = `media/${e.id}.ogg`;
    if (audio !== null) files.set(mediaPath, audio);
    return {
      id: `${script === 'hiragana' ? 'hira' : 'kata'}-${e.id}`,
      prompt: { type: 'text', text: script === 'hiragana' ? e.hira : toKatakana(e.hira) },
      answers: e.answers,
      ...(audio !== null ? { answer_media: mediaPath } : {}),
      tags: [script, ...e.tags],
    };
  });
  const deckJson = buildDeckJson({
    id: `kana-${script}-v1`,
    name: `Japanese — ${script} → romaji`,
    description:
      `All ${script} (46 base + voiced/semi-voiced + yōon digraphs) to be answered ` +
      'in romaji. Hepburn plus common variants accepted.',
    settings: { baseTimerMs: 5000, newCardsPerSession: 5, maxBox1ForNew: 10 },
    cards,
  });
  files.set('deck.json', new TextEncoder().encode(deckJson));
  return { filename: `kana-${script}.deckpack`, bytes: zipPack(files) };
}

export function genKanaPacks(): GeneratedPack[] {
  return [kanaDeck('hiragana'), kanaDeck('katakana')];
}

if (require.main === module) {
  const outDir = path.resolve(__dirname, '..', 'decks');
  mkdirSync(outDir, { recursive: true });
  for (const pack of genKanaPacks()) {
    writeFileSync(path.join(outDir, pack.filename), pack.bytes);
    console.log(`[gen-kana] wrote decks/${pack.filename} (${pack.bytes.length} bytes)`);
  }
}
