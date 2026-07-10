/**
 * Rebuilds the committed pack fixtures in this directory. Rerun after
 * changing FIXTURE contents: npx tsx test/fixtures/build-fixtures.ts
 * Output is deterministic (fixed zip mtime, sorted entries), so a rerun
 * with unchanged inputs produces byte-identical files.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { zipPack, ZIP_EPOCH } from '../../src/main/packs';

const HERE = __dirname;
const enc = (s: string) => new TextEncoder().encode(s);

/**
 * Tiny committed ogg for the answer_media card (format v2). Regenerate with:
 *   ~/.local/bin/ffmpeg -y -f lavfi -i "sine=frequency=660:duration=0.2" \
 *     -ac 1 -ar 22050 -c:a libvorbis -fflags +bitexact -flags:a +bitexact \
 *     -map_metadata -1 test/fixtures/assets/answer-n.ogg
 * (bitexact flags → byte-identical re-runs with the same ffmpeg build)
 */
const ANSWER_OGG = readFileSync(path.join(HERE, 'assets', 'answer-n.ogg'));

export const MINI_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
  <rect width="60" height="60" fill="white"/>
  <circle cx="30" cy="30" r="12" fill="black"/>
</svg>
`;

export const MINI_DECK_JSON = JSON.stringify(
  {
    format_version: 2,
    id: 'mini',
    name: 'Mini fixture deck',
    description: 'Four cards: two plain text, one SVG image, one hinted with answer audio.',
    settings: { base_timer_ms: 5000, new_cards_per_session: 5 },
    cards: [
      {
        id: 'ka',
        prompt: { type: 'text', text: 'か' },
        answers: ['ka'],
        tags: ['hiragana', 'k-row'],
      },
      {
        id: 'shi',
        prompt: { type: 'text', text: 'し' },
        answers: ['shi', 'si'],
        tags: ['hiragana', 's-row'],
      },
      {
        id: 'dot',
        prompt: { type: 'image', media: 'media/dot.svg' },
        answers: ['dot'],
        tags: ['image'],
      },
      {
        id: 'n',
        prompt: { type: 'text', text: 'ん' },
        answers: ['n'],
        answer_media: 'media/n.ogg',
        hint: 'the only lone consonant',
        tags: ['hiragana'],
      },
    ],
  },
  null,
  2,
);

export function buildFixtures(): void {
  // The good pack, as zip and as bare directory.
  writeFileSync(
    path.join(HERE, 'mini.deckpack'),
    zipPack(
      new Map([
        ['deck.json', enc(MINI_DECK_JSON)],
        ['media/dot.svg', enc(MINI_SVG)],
        ['media/n.ogg', new Uint8Array(ANSWER_OGG)],
      ]),
    ),
  );
  mkdirSync(path.join(HERE, 'mini-dir', 'media'), { recursive: true });
  writeFileSync(path.join(HERE, 'mini-dir', 'deck.json'), MINI_DECK_JSON);
  writeFileSync(path.join(HERE, 'mini-dir', 'media', 'dot.svg'), MINI_SVG);
  writeFileSync(path.join(HERE, 'mini-dir', 'media', 'n.ogg'), ANSWER_OGG);

  // Broken variants.
  writeFileSync(
    path.join(HERE, 'broken-bad-json.deckpack'),
    zipPack(new Map([['deck.json', enc('{ "format_version": 1, "id": ')]])),
  );

  const missingMedia = JSON.parse(MINI_DECK_JSON);
  missingMedia.id = 'missing-media';
  missingMedia.cards = [
    { id: 'ghost', prompt: { type: 'image', media: 'media/ghost.svg' }, answers: ['x'] },
  ];
  writeFileSync(
    path.join(HERE, 'broken-missing-media.deckpack'),
    zipPack(new Map([['deck.json', enc(JSON.stringify(missingMedia, null, 2))]])),
  );

  const futureVersion = JSON.parse(MINI_DECK_JSON);
  futureVersion.format_version = 999;
  writeFileSync(
    path.join(HERE, 'broken-format-999.deckpack'),
    zipPack(new Map([['deck.json', enc(JSON.stringify(futureVersion, null, 2))]])),
  );

  // v2 card whose answer_media file is missing from the pack.
  const missingAnswerMedia = JSON.parse(MINI_DECK_JSON);
  missingAnswerMedia.id = 'missing-answer-media';
  missingAnswerMedia.cards = [
    {
      id: 'mute',
      prompt: { type: 'text', text: 'ん' },
      answers: ['n'],
      answer_media: 'media/mute.ogg',
    },
  ];
  writeFileSync(
    path.join(HERE, 'broken-missing-answer-media.deckpack'),
    zipPack(new Map([['deck.json', enc(JSON.stringify(missingAnswerMedia, null, 2))]])),
  );

  // Not a zip at all.
  writeFileSync(path.join(HERE, 'broken-not-a-zip.deckpack'), enc('this is not a zip file'));

  // Zip without deck.json.
  writeFileSync(
    path.join(HERE, 'broken-no-deck-json.deckpack'),
    zipSync({ 'readme.txt': enc('nothing to see') }, { mtime: ZIP_EPOCH }),
  );
}

if (require.main === module) {
  buildFixtures();
  console.log(`fixtures written to ${HERE}`);
}
