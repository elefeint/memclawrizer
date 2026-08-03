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

/**
 * Mnemonics (2026-08). The hint is shown at the moment of failure — the
 * "logical attachment" channel DESIGN.md calls one of the two memory pillars,
 * and it sat empty for these decks until now.
 *
 * Only the 46 base kana are hand-written, and per script: あ and ア look
 * nothing alike, so they cannot share a shape mnemonic. The other 58 are
 * DERIVED from structure (see hintFor), which is the better lesson anyway —
 * dakuten voices its base, handakuten turns it into p, a small ya/yu/yo fuses
 * onto the i-column kana. Three rules instead of 58 facts.
 *
 * Confusable pairs carry an explicit contrast, because that is where the
 * failures actually happen: し/じ, さ/ち, ぬ/め, る/ろ, ね/れ/わ, は/ほ, and
 * katakana's notorious シ/ツ and ソ/ン.
 */
const HINTS: Record<string, { hira: string; kata: string }> = {
  a: { hira: "a capital A with a curl — ah", kata: "a capital A missing its leg — ah" },
  i: { hira: "two leaning strokes, the two i's of ii", kata: "two strokes propped together — i" },
  u: { hira: "a face with a big nose, mouth rounded: oo", kata: "a roof with a chimney — u (ワ wa has no chimney)" },
  e: { hira: "an exotic bird swooping — eh", kata: "the girder shape 工 — eh" },
  o: { hira: "あ a with an extra tail flicked out — oh", kata: "a cross with a kick — oh" },
  ka: { hira: "a kite on a string — ka", kata: "か ka with the loop cut off — same kite" },
  ki: { hira: "a key with two teeth — ki", kata: "き ki straightened out — same key" },
  ku: { hira: "a cuckoo's open beak — ku", kata: "a beak — ku (タ ta is this plus a bar)" },
  ke: { hira: "a keg tipped on its side — ke", kata: "a keg, squared off — ke" },
  ko: { hira: "two short cords lying parallel — ko", kata: "a box left open on one side — ko (ロ ro is closed)" },
  sa: { hira: "さ sa curves LEFT; ち chi is its mirror, curving right", kata: "three strokes like a fork — sa" },
  shi: {
    hira: "a fishing hook: SHE hooks a fish. Add ゛ and it voices to じ ji",
    kata: "three strokes sweeping UP from the left — shi (ツ tsu comes DOWN from the top)",
  },
  su: { hira: "a swirl on a stick — sipping through a straw", kata: "a slide going down — su" },
  se: { hira: "a mouth opening to say seh", kata: "せ se squared off — same mouth" },
  so: {
    hira: "a zigzag of stitches — sewing",
    kata: "two strokes, the short one stabbing DOWN — so (ン n sweeps UP)",
  },
  ta: { hira: "a cross and a hook: ta-da!", kata: "ク ku with a bar added — ta" },
  chi: { hira: "the mirror of さ sa: ち chi curves RIGHT", kata: "ち chi straightened out — same shape" },
  tsu: {
    hira: "a wave curling over — tsunami",
    kata: "three strokes falling DOWN from the top — tsu (シ shi sweeps UP)",
  },
  te: { hira: "a hand reaching out — te really does mean hand", kata: "て te wearing a hat — same hand" },
  to: { hira: "a toe with a nail stuck in it — to", kata: "a T with a dot — to" },
  na: { hira: "a nun kneeling beside a cross — na", kata: "a cross leaning — na" },
  ni: { hira: "two strokes = 二, the number 2, which IS ni", kata: "two lines = 二 = 2 = ni, same as に" },
  nu: { hira: "noodles twirled into a loop — nu (め me has no loop)", kata: "ス su with a slash — nu (メ me is a bare X)" },
  ne: { hira: "a cat's curled tail — neko (れ re has no curl)", kata: "a cross with strokes trailing — ne" },
  no: { hira: "one clean swirl, a NO-entry sign", kata: "a single stroke — no" },
  ha: { hira: "H with a flag — ha (゛ makes ba, ゜ makes pa)", kata: "two strokes standing apart — ha" },
  hi: { hira: "a wide grinning smile — hee!", kata: "a person sitting down — hi" },
  fu: { hira: "Mount Fuji with clouds beside it — fu", kata: "one bent stroke — fu" },
  he: {
    hira: "a low hill — he. The one kana katakana copies exactly",
    kata: "identical to hiragana へ — the same low hill",
  },
  ho: { hira: "は ha with one extra bar — ho ho ho", kata: "a cross on two feet — ho" },
  ma: { hira: "mama's two arms and a swirl — ma", kata: "a checkmark with a tail — ma" },
  mi: { hira: "the number 3 turned on its side — mi (mittsu)", kata: "three strokes = 三 = 3 = mi" },
  mu: { hira: "a cow's face lowing — muu", kata: "a small tucked corner — mu" },
  me: { hira: "an eye — me really does mean eye (no loop, unlike ぬ nu)", kata: "a bare X — me (ヌ nu has a lid on it)" },
  mo: { hira: "a hook catching MOre fish", kata: "も mo straightened out — mo" },
  ya: { hira: "a yacht with its sail up — ya", kata: "や ya simplified — same yacht" },
  yu: { hira: "a fish, unique in shape — yu", kata: "a U tipped on its side — yu" },
  yo: { hira: "a yo-yo hanging from its string", kata: "three bars, an E reversed — yo" },
  ra: { hira: "a rabbit ear above a swoop — ra", kata: "a flag on a pole — ra" },
  ri: { hira: "two reeds side by side — ri", kata: "り ri straightened — the same two reeds" },
  ru: { hira: "the loop at the end is the tell — ru (ろ ro has none)", kata: "two legs walking — ru" },
  re: { hira: "ね ne with the tail straightened — re", kata: "one checkmark — re" },
  ro: { hira: "る ru with the loop untied — ro", kata: "a fully closed box — ro (コ ko is open)" },
  wa: { hira: "the ね/れ family, but with a round belly — wa", kata: "ウ u with the chimney knocked off — wa" },
  wo: { hira: "a person tossing an object — the object marker, said o", kata: "the object marker, said o — rare in the wild" },
  n: { hira: "the only lone consonant — one squiggle, n", kata: "two strokes, the short one sweeping UP — n (ソ so stabs DOWN)" },
  // The two rare duplicates: same sound as じ / ず, different glyph.
  di: {
    hira: "ち chi + ゛ — voiced to ji, but じ is the everyday ji; this one is rare",
    kata: "チ chi + ゛ — sounds like ji; ジ is the everyday one",
  },
  du: {
    hira: "つ tsu + ゛ — voiced to zu, but ず is the everyday zu; this one is rare",
    kata: "ツ tsu + ゛ — sounds like zu; ズ is the everyday one",
  },
};

const SMALL_YOON: Record<string, string> = { ゃ: 'ya', ゅ: 'yu', ょ: 'yo' };

const HIRA_TO_KATA_SHIFT = 0x60; // U+3041.. → U+30A1..

function toKatakana(hira: string): string {
  return [...hira]
    .map((ch) => String.fromCodePoint((ch.codePointAt(0) as number) + HIRA_TO_KATA_SHIFT))
    .join('');
}

const ROMAJI_BY_HIRA = new Map(TABLE.map((e) => [e.hira, e.answers[0]]));

/**
 * The hint for one card. Hand-written for the 46 base kana (HINTS); derived
 * from structure for everything else, exploiting the fact that the kana block
 * is laid out so that a voiced kana sits one codepoint after its base and a
 * semi-voiced one two after (か U+304B → が U+304C; は U+306F → ば U+3070 →
 * ぱ U+3071). Yōon simply decompose: きゃ is き plus a small ゃ.
 */
function hintFor(entry: KanaEntry, script: 'hiragana' | 'katakana'): string | null {
  const written = HINTS[entry.id];
  if (written) return script === 'hiragana' ? written.hira : written.kata;

  const show = (hira: string) => (script === 'hiragana' ? hira : toKatakana(hira));
  const romaji = entry.answers[0];

  if (entry.tags.includes('yoon')) {
    const [baseGlyph, small] = [...entry.hira];
    const baseRomaji = ROMAJI_BY_HIRA.get(baseGlyph);
    if (baseRomaji === undefined) return null;
    return (
      `${show(baseGlyph)} ${baseRomaji} + small ${show(small)} ${SMALL_YOON[small]} — ` +
      `run them together: ${romaji}`
    );
  }

  const cp = entry.hira.codePointAt(0) as number;
  if (entry.tags.includes('voiced')) {
    const base = String.fromCodePoint(cp - 1);
    const baseRomaji = ROMAJI_BY_HIRA.get(base);
    if (baseRomaji === undefined) return null;
    return `${show(base)} ${baseRomaji} + ゛ (two dots) — voice it: ${romaji}`;
  }
  if (entry.tags.includes('semi-voiced')) {
    const base = String.fromCodePoint(cp - 2);
    const baseRomaji = ROMAJI_BY_HIRA.get(base);
    if (baseRomaji === undefined) return null;
    return `${show(base)} ${baseRomaji} + ゜ (small circle) — ${romaji}`;
  }
  return null;
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
    const hint = hintFor(e, script);
    const mediaPath = `media/${e.id}.ogg`;
    if (audio !== null) files.set(mediaPath, audio);
    return {
      id: `${script === 'hiragana' ? 'hira' : 'kata'}-${e.id}`,
      prompt: { type: 'text', text: script === 'hiragana' ? e.hira : toKatakana(e.hira) },
      answers: e.answers,
      ...(hint !== null ? { hint } : {}),
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
    settings: { baseTimerMs: 5000, newCardsPerSession: 5, maxBox1ForNew: 10, retrievalAllowanceMs: 3500 },
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
