/**
 * .deckpack import/export (DESIGN.md "Deck pack format").
 *
 * A pack is a zip (or a bare directory) containing deck.json plus a media/
 * folder. Import upserts by (deck_id, card_id) and never touches card_state —
 * existing cards keep their Leitner progress, new cards simply have no state
 * row ("new"). Card ids present in the DB but missing from the pack are
 * returned as orphans; the caller decides what to do about them.
 *
 * format_version gates the importer the same way schema_version gates the DB:
 * newer app reads old packs, old app refuses new packs.
 *
 * No Electron imports — testable under plain Node.
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import type { DuckDBConnection } from '@duckdb/node-api';
import type { DeckSettings, ImportResult, PromptType } from '../shared/api';
import { DEFAULT_MAX_BOX1_FOR_NEW } from '../shared/api';
import { normalizeAnswer } from '../shared/normalize';
import {
  deleteUnreferencedMedia,
  findActiveDeckByPackId,
  getDeck,
  getMedia,
  listCards,
  upsertCard,
  upsertDeck,
  upsertMedia,
} from './queries';

export const PACK_FORMAT_VERSION = 2;

/**
 * Fixed zip mtime so identical content always produces identical bytes.
 * Constructed from LOCAL date components: fflate encodes DOS time from the
 * local calendar, so this yields the same bytes in every timezone (an ISO/UTC
 * date would not — and DOS time cannot represent anything before 1980).
 */
export const ZIP_EPOCH = new Date(1990, 0, 1, 0, 0, 0);

export class PackError extends Error {}

// ---------------------------------------------------------------------------
// Validation (helpful, path-annotated errors)

export interface PackCard {
  id: string;
  promptType: PromptType;
  promptText: string | null;
  /** Path inside the pack, e.g. 'media/treble-c4.svg'. */
  mediaPath: string | null;
  /** Format v2: audio played during post-attempt feedback, e.g. 'media/shi.ogg'. */
  answerMediaPath: string | null;
  answers: string[];
  hint: string | null;
  tags: string[];
}

export interface ParsedPack {
  formatVersion: number;
  id: string;
  name: string;
  description: string | null;
  settings: DeckSettings;
  cards: PackCard[];
}

function fail(where: string, message: string): never {
  throw new PackError(`deck.json: ${where} ${message}`);
}

function reqString(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(where, 'must be a non-empty string');
  return v;
}

function optString(v: unknown, where: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') fail(where, 'must be a string when present');
  return v;
}

function reqPositiveInt(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    fail(where, 'must be a positive number');
  }
  return Math.round(v);
}

function parseCard(raw: unknown, where: string): PackCard {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(where, 'must be an object');
  }
  const c = raw as Record<string, unknown>;
  const id = reqString(c.id, `${where}.id`);

  const prompt = c.prompt;
  if (typeof prompt !== 'object' || prompt === null || Array.isArray(prompt)) {
    fail(`${where}.prompt`, 'must be an object like { "type": "text", "text": "..." }');
  }
  const p = prompt as Record<string, unknown>;
  const type = p.type;
  if (type !== 'text' && type !== 'image' && type !== 'audio') {
    fail(`${where}.prompt.type`, `must be "text", "image" or "audio" (got ${JSON.stringify(type)})`);
  }
  let promptText: string | null = null;
  let mediaPath: string | null = null;
  if (type === 'text') {
    promptText = reqString(p.text, `${where}.prompt.text`);
  } else {
    mediaPath = reqString(p.media, `${where}.prompt.media`);
  }

  if (!Array.isArray(c.answers) || c.answers.length === 0) {
    fail(`${where}.answers`, 'must be a non-empty array of accepted answer strings');
  }
  const answers = c.answers.map((a, i) => {
    const s = normalizeAnswer(reqString(a, `${where}.answers[${i}]`));
    if (s.length === 0) fail(`${where}.answers[${i}]`, 'must not be blank');
    return s;
  });

  // Format v2: optional answer-side audio (played during feedback, both
  // outcomes). Must be an audio file; existence is checked when the pack's
  // media is collected.
  const answerMediaPath = optString(c.answer_media, `${where}.answer_media`);
  if (answerMediaPath !== null && !AUDIO_EXTS.has(path.extname(answerMediaPath).toLowerCase())) {
    fail(
      `${where}.answer_media`,
      `must be an audio file (${[...AUDIO_EXTS].join(', ')}); got ${JSON.stringify(answerMediaPath)}`,
    );
  }

  const tags =
    c.tags === undefined
      ? []
      : Array.isArray(c.tags)
        ? c.tags.map((t, i) => reqString(t, `${where}.tags[${i}]`))
        : fail(`${where}.tags`, 'must be an array of strings when present');

  return {
    id,
    promptType: type,
    promptText,
    mediaPath,
    answerMediaPath,
    answers: [...new Set(answers)],
    hint: optString(c.hint, `${where}.hint`),
    tags,
  };
}

/** Parses and validates deck.json text. Throws PackError with a helpful path. */
export function parsePackJson(text: string): ParsedPack {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new PackError(`deck.json is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PackError('deck.json: top level must be an object');
  }
  const d = raw as Record<string, unknown>;

  // Version gate FIRST: a newer pack may have fields we can't validate.
  const fv = d.format_version;
  if (typeof fv !== 'number' || !Number.isInteger(fv) || fv < 1) {
    fail('format_version', 'must be a positive integer');
  }
  if (fv > PACK_FORMAT_VERSION) {
    throw new PackError(
      `This pack uses format_version ${fv}, but this build of memclawrizer only ` +
        `knows version ${PACK_FORMAT_VERSION}. Update the app to import it.`,
    );
  }

  const settingsRaw = d.settings;
  if (typeof settingsRaw !== 'object' || settingsRaw === null || Array.isArray(settingsRaw)) {
    fail('settings', 'must be an object with base_timer_ms and new_cards_per_session');
  }
  const s = settingsRaw as Record<string, unknown>;
  const settings: DeckSettings = {
    baseTimerMs: reqPositiveInt(s.base_timer_ms, 'settings.base_timer_ms'),
    newCardsPerSession: reqPositiveInt(s.new_cards_per_session, 'settings.new_cards_per_session'),
    // Optional (added 2026-07-10); packs without it get the default gate.
    maxBox1ForNew:
      s.max_box1_for_new === undefined
        ? DEFAULT_MAX_BOX1_FOR_NEW
        : reqPositiveInt(s.max_box1_for_new, 'settings.max_box1_for_new'),
  };

  if (!Array.isArray(d.cards)) fail('cards', 'must be an array');
  const cards = d.cards.map((c, i) => parseCard(c, `cards[${i}]`));
  const seen = new Set<string>();
  for (let i = 0; i < cards.length; i++) {
    if (seen.has(cards[i].id)) fail(`cards[${i}].id`, `duplicates card id "${cards[i].id}"`);
    seen.add(cards[i].id);
  }

  return {
    formatVersion: fv,
    id: reqString(d.id, 'id'),
    name: reqString(d.name, 'name'),
    description: optString(d.description, 'description'),
    settings,
    cards,
  };
}

// ---------------------------------------------------------------------------
// Reading a pack from disk (zip file or bare directory)

/** Extensions accepted for answer_media (audio only, by design). */
const AUDIO_EXTS = new Set(['.ogg', '.oga', '.mp3', '.wav']);

const MIME_BY_EXT: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
};

export function mimeForMediaPath(mediaPath: string): string {
  const mime = MIME_BY_EXT[path.extname(mediaPath).toLowerCase()];
  if (mime === undefined) {
    throw new PackError(`unsupported media file type: ${mediaPath}`);
  }
  return mime;
}

export interface LoadedPack {
  deck: ParsedPack;
  /** Referenced media only, keyed by path inside the pack. */
  media: Map<string, Uint8Array>;
}

/** Loads and fully validates a pack from a .deckpack zip or a directory. */
export function readPack(packPath: string): LoadedPack {
  const isDir = statSync(packPath).isDirectory();
  return isDir ? readPackDir(packPath) : readPackZip(packPath);
}

function collectMedia(
  deck: ParsedPack,
  readEntry: (mediaPath: string) => Uint8Array | null,
): Map<string, Uint8Array> {
  const media = new Map<string, Uint8Array>();
  for (const card of deck.cards) {
    for (const mediaPath of [card.mediaPath, card.answerMediaPath]) {
      if (mediaPath === null || media.has(mediaPath)) continue;
      mimeForMediaPath(mediaPath); // validates the extension
      const bytes = readEntry(mediaPath);
      if (bytes === null) {
        throw new PackError(
          `card "${card.id}" references ${mediaPath}, but the pack has no such file`,
        );
      }
      media.set(mediaPath, bytes);
    }
  }
  return media;
}

function readPackZip(filePath: string): LoadedPack {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(readFileSync(filePath));
  } catch (e) {
    throw new PackError(`${path.basename(filePath)} is not a readable zip: ${(e as Error).message}`);
  }
  const deckJson = entries['deck.json'];
  if (deckJson === undefined) {
    throw new PackError(`${path.basename(filePath)} has no deck.json at its root`);
  }
  const deck = parsePackJson(Buffer.from(deckJson).toString('utf8'));
  const media = collectMedia(deck, (p) => entries[p] ?? null);
  return { deck, media };
}

function readPackDir(dirPath: string): LoadedPack {
  let deckJsonText: string;
  try {
    deckJsonText = readFileSync(path.join(dirPath, 'deck.json'), 'utf8');
  } catch {
    throw new PackError(`${dirPath} has no readable deck.json`);
  }
  const deck = parsePackJson(deckJsonText);
  const media = collectMedia(deck, (p) => {
    // Media paths come from deck.json — refuse anything escaping the pack dir.
    const resolved = path.resolve(dirPath, p);
    if (!resolved.startsWith(path.resolve(dirPath) + path.sep)) return null;
    try {
      return readFileSync(resolved);
    } catch {
      return null;
    }
  });
  return { deck, media };
}

// ---------------------------------------------------------------------------
// Import

export function mediaIdFor(deckId: string, mediaPath: string): string {
  return `${deckId}/${mediaPath}`;
}

/**
 * Imports a pack (zip file or directory) into the DB, upserting the deck and
 * cards, replacing media, and preserving card_state for existing card ids.
 * Runs in a transaction. Returns the contract ImportResult.
 */
export async function importPack(
  conn: DuckDBConnection,
  packPath: string,
  now: Date,
): Promise<ImportResult> {
  const { deck, media } = readPack(packPath);

  // Deck lifecycle (v3): the pack's id is a matching key, not the storage
  // key. Upsert into the ACTIVE deck carrying this pack_id; if none exists
  // (including when only ARCHIVED decks carry it — their history is frozen),
  // mint a fresh internal id and start from scratch.
  const target = await findActiveDeckByPackId(conn, deck.id);
  let internalId: string;
  if (target !== null) {
    internalId = target.id;
  } else {
    internalId = deck.id;
    for (let n = 2; (await getDeck(conn, internalId)) !== null; n++) {
      internalId = `${deck.id}#${n}`;
    }
  }

  const existingIds = new Set((await listCards(conn, internalId)).map((c) => c.id));
  const packIds = new Set(deck.cards.map((c) => c.id));
  const orphanedCardIds = [...existingIds].filter((id) => !packIds.has(id)).sort();
  let cardsAdded = 0;
  let cardsUpdated = 0;

  await conn.run('BEGIN TRANSACTION');
  try {
    await upsertDeck(conn, {
      id: internalId,
      packId: deck.id,
      name: deck.name,
      description: deck.description,
      settings: deck.settings,
      formatVersion: deck.formatVersion,
      importedAtMs: now.getTime(),
      archivedAtMs: null,
    });
    for (const [mediaPath, bytes] of media) {
      await upsertMedia(conn, {
        id: mediaIdFor(internalId, mediaPath),
        deckId: internalId,
        mime: mimeForMediaPath(mediaPath),
        bytes,
      });
    }
    for (const card of deck.cards) {
      await upsertCard(conn, {
        deckId: internalId,
        id: card.id,
        promptType: card.promptType,
        promptText: card.promptText,
        mediaId: card.mediaPath === null ? null : mediaIdFor(internalId, card.mediaPath),
        answerMediaId:
          card.answerMediaPath === null ? null : mediaIdFor(internalId, card.answerMediaPath),
        answers: card.answers,
        hint: card.hint,
        tags: card.tags,
        active: true,
      });
      if (existingIds.has(card.id)) cardsUpdated++;
      else cardsAdded++;
    }
    await deleteUnreferencedMedia(conn, internalId);
    await conn.run('COMMIT');
  } catch (e) {
    await conn.run('ROLLBACK');
    throw e;
  }

  return { deckId: internalId, name: deck.name, cardsAdded, cardsUpdated, orphanedCardIds };
}

// ---------------------------------------------------------------------------
// Export (content only — progress lives in the DB)

/** Builds the deck.json object for a pack (also used by the generators). */
export interface PackJsonCard {
  id: string;
  prompt: { type: PromptType; text?: string; media?: string };
  answers: string[];
  /** Format v2: relative path to answer-side audio inside the pack. */
  answer_media?: string;
  hint?: string;
  tags?: string[];
}

export function buildDeckJson(deck: {
  id: string;
  name: string;
  description: string | null;
  settings: DeckSettings;
  cards: PackJsonCard[];
}): string {
  return JSON.stringify(
    {
      format_version: PACK_FORMAT_VERSION,
      id: deck.id,
      name: deck.name,
      ...(deck.description !== null ? { description: deck.description } : {}),
      settings: {
        base_timer_ms: deck.settings.baseTimerMs,
        new_cards_per_session: deck.settings.newCardsPerSession,
        max_box1_for_new: deck.settings.maxBox1ForNew,
      },
      cards: deck.cards,
    },
    null,
    2,
  );
}

/** Zips { path → bytes } deterministically (fixed mtime, stable order). */
export function zipPack(files: Map<string, Uint8Array>): Uint8Array {
  const zippable: Zippable = {};
  for (const name of [...files.keys()].sort()) {
    zippable[name] = [files.get(name) as Uint8Array, { mtime: ZIP_EPOCH }];
  }
  return zipSync(zippable, { mtime: ZIP_EPOCH });
}

/** Writes a content-only .deckpack for the deck at filePath. */
export async function exportPack(
  conn: DuckDBConnection,
  deckId: string,
  filePath: string,
): Promise<void> {
  const deck = await getDeck(conn, deckId);
  if (deck === null) throw new PackError(`no deck with id "${deckId}"`);
  const cards = await listCards(conn, deckId, { activeOnly: true });

  const files = new Map<string, Uint8Array>();

  // media id is '<deck_id>/<path in pack>'; returns the in-pack path.
  const collect = async (cardId: string, mediaId: string): Promise<string> => {
    const mediaPath = mediaId.startsWith(`${deckId}/`)
      ? mediaId.slice(deckId.length + 1)
      : mediaId;
    if (!files.has(mediaPath)) {
      const m = await getMedia(conn, mediaId);
      if (m === null) throw new PackError(`card "${cardId}" references missing media ${mediaId}`);
      files.set(mediaPath, m.bytes);
    }
    return mediaPath;
  };

  const jsonCards: PackJsonCard[] = [];
  for (const card of cards) {
    const mediaPath = card.mediaId === null ? undefined : await collect(card.id, card.mediaId);
    const answerMediaPath =
      card.answerMediaId === null ? undefined : await collect(card.id, card.answerMediaId);
    jsonCards.push({
      id: card.id,
      prompt:
        card.promptType === 'text'
          ? { type: 'text', text: card.promptText ?? '' }
          : { type: card.promptType as PromptType, media: mediaPath },
      answers: card.answers,
      ...(answerMediaPath !== undefined ? { answer_media: answerMediaPath } : {}),
      ...(card.hint !== null ? { hint: card.hint } : {}),
      ...(card.tags.length > 0 ? { tags: card.tags } : {}),
    });
  }

  const deckJson = buildDeckJson({
    // Round-trips preserve the author-chosen id, not the internal one (v3).
    id: deck.packId,
    name: deck.name,
    description: deck.description,
    settings: deck.settings,
    cards: jsonCards,
  });
  files.set('deck.json', new TextEncoder().encode(deckJson));
  writeFileSync(filePath, zipPack(files));
}
