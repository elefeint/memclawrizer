---
name: deckpack
description: Create a new training deck (.deckpack) for memclawrizer — use when asked to make/generate a deck, flashcards, or training material for the drill trainer (e.g. "make me a deck for French numbers", "add a katakana words deck").
---

# Creating a memclawrizer deck pack

A deck is either a **bare directory** (`deck.json` + `media/`) or a **zip with
the `.deckpack` extension** containing the same. Both import identically; the
directory form needs no tooling and is fine for one-off decks. Zip only for
distribution or committing to `decks/`.

## deck.json — exact shape (importer: `src/main/packs.ts`)

```json
{
  "format_version": 1,
  "id": "french-numbers-v1",
  "name": "French — numbers 0–100",
  "description": "Digits shown, type the French word.",
  "settings": { "base_timer_ms": 6000, "new_cards_per_session": 5 },
  "cards": [
    {
      "id": "fr-17",
      "prompt": { "type": "text", "text": "17" },
      "answers": ["dix-sept", "dix sept", "dixsept"],
      "hint": "ten-seven, the teens switch pattern at 17",
      "tags": ["teens"]
    },
    {
      "id": "fr-note-c4",
      "prompt": { "type": "image", "media": "media/c4.svg" },
      "answers": ["c4", "c"],
      "tags": ["image-example"]
    }
  ]
}
```

Field rules (validated strictly on import; errors name the offending path):

- `format_version` — must be exactly `1`.
- `id` / card `id`s — **stable author-chosen strings, never change them**:
  re-import upserts by `(deck id, card id)` and preserves Leitner progress for
  matching ids. Renaming an id = progress lost + orphan reported. Suffix the
  deck id with `-v1` style only if you intend a genuinely separate deck.
- `settings` — snake_case keys, both required: `base_timer_ms`,
  `new_cards_per_session` (5 is the sane default; the user can tune both
  in-app later, so don't agonize).
- `prompt.type` — `text` | `image` | `audio`. `text` needs `prompt.text`;
  `image`/`audio` need `prompt.media` as a relative path like `media/x.svg`
  that exists in the pack. SVG preferred for images (rendered on a white
  padded card, max ~32vh). Audio (`.ogg`/`.mp3`) auto-plays once with a
  replay button.
- `answers` — matching is **exact after normalization** (trim, lowercase,
  collapse internal whitespace; see `src/shared/normalize.ts`). No fuzzy
  matching ever. So enumerate every acceptable variant: romanization variants
  (shi/si), spellings with/without hyphens or spaces, with/without octave
  numbers, etc. Answers must be fast to type — the whole game is a claw on a
  timer.
- `hint` — optional but **write one whenever a logical hook exists**: it is
  shown at the moment of failure, and logical attachment at failure time is
  one of the two memory channels this app is built on (the other is the
  timer). A good hint connects the fact to something already known, not a
  restatement ("ten-seven" for dix-sept, "she has a fishing hook" for し).
- `tags` — power drill-by-tag subsets on the home screen. Tag generously and
  orthogonally (row/category, difficulty, script/clef) so the user can start
  small and expand.

## Timer sizing

`base_timer_ms`: ~5000 for text→text recall, ~7000 for reading an image.
Leitner boxes multiply it (box 1: 1.5× down to box 5: 0.7×) — set the base
for how a *new* card should feel: tight but typeable.

## Two build paths

1. **Handcrafted (≤ a few dozen static cards):** write `deck.json` (+
   `media/`) in a directory anywhere. Done — the directory imports as-is.
2. **Generated (systematic/large decks, or anything committed to `decks/`):**
   write `scripts/gen-<name>.ts` modeled on `scripts/gen-kana.ts` (text) or
   `scripts/gen-piano.ts` (programmatic SVG media). Use `buildDeckJson` and
   `zipPack` from `src/main/packs` — `zipPack` produces deterministic bytes
   (stable ordering, fixed timestamps), which committed decks must be. Run
   via `npx tsx scripts/gen-<name>.ts`. If the deck is committed to
   `decks/`, add a golden test mirroring the existing ones so drift fails CI,
   and wire the script into the `gen:decks` npm script.

## Validate before handing over (always)

```bash
npx tsx scripts/import-pack.ts <pack-or-dir> /tmp/deck-test.duckdb
```

Prints `N added, M updated` on success; a validation error names the bad
field. Then, ideally, import in the running app (home → Import) and drill one
card. Broken-pack examples for reference live in `test/fixtures/`
(`broken-*.deckpack`).

## Design sensibilities (from the app's design, DESIGN.md)

- Prompts show ONE thing, big and centered. No compound cards.
- Never put scores/percentages in content; the app's reward language is
  prizes and jars.
- Reverse decks (e.g. romaji → kana via IME) are just another pack — make a
  separate deck with its own ids rather than doubling cards in one deck.
