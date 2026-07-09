# memclawrizer — design

A standalone desktop drill trainer built around **time pressure**. Elena retains
arbitrary information only when it is (1) logically attached to something already
known, or (2) learned under stress/time pressure. The pacing mechanic comes from a
~1995 vocabulary game (which used a gun sweeping across the screen with a kitchen
timer): here, an **arcade claw** travels left → right while the timer ticks. Answer
in time and the claw drops down and grabs a random interesting item from the prize
pit at the bottom of the screen; miss and the timer dings loudly and the card comes
back again.

First two training sets: **written piano notation → note names** (images) and
**Japanese syllabaries → romaji** (text). Content is pluggable via an import/export
pack format; prompts can be text, image, or (later) audio.

## Stack

Identical to `~/code/ayamt` — Electron Forge (Vite + TypeScript template),
TypeScript end-to-end, main/preload as CJS, renderer ESM via Vite. Main process
owns all file I/O and the DuckDB database (`@duckdb/node-api`); renderer is
UI-only behind contextBridge with contextIsolation on, nodeIntegration off.
Hand-rolled migrations (schema_version + ordered TS functions in a transaction on
open). Minimal dependencies; targets Linux + Windows.

Deliberate deviations from ayamt:

- **DB is not a "document" you point the app at.** Training state is per-machine,
  per-person, and the app should open instantly into "what's due today". The DB
  lives at `app.getPath('userData')/memorizer.duckdb` and opens automatically.
  Portability of *content* is handled by the deck pack format; portability of
  *progress* is "copy the .duckdb file". (A Settings override for the DB path is
  cheap to add later if sync via Syncthing/etc. is ever wanted; only then does
  ayamt's copy-local/lock-file dance become relevant.)
- **One small new dependency:** `fflate` (pure-JS, zero-dep, ~8 KB) to read/write
  zip-based deck packs. Node has no built-in zip; hand-rolling one violates the
  "own the behavior where it matters" ethos in the wrong direction. Import also
  accepts an unzipped directory, so packs can be authored without any tooling.

## Core game loop

A **drill session** on one deck:

1. Main process computes the session queue: all cards due per Leitner schedule
   (box 1 always due), plus up to N never-seen cards ("new cards per session",
   deck setting, default 5), shuffled.
2. Renderer shows one card at a time: prompt centered (kana glyph, staff image,
   or audio play button), a text input below, and the **timer sweep** — an arcade
   claw travelling left → right along a rail across the top of the screen, above a
   prize pit of random interesting items (emoji/SVG trinkets) along the bottom.
   The claw's position IS the timer: when it reaches the right edge, time is up.
3. Audio via WebAudio (synthesized in the renderer, no asset files): a kitchen-timer
   tick that accelerates in the final ~25% of the countdown, and a loud **ding**
   on timeout. Volume slider in settings, but the default is intentionally
   intrusive — the stress is the feature.
4. Enter submits. Outcomes:
   - **correct** (matched within time): the claw stops, drops, grabs a random item
     from the pit, and hoists it — a ~1s animation that doubles as the success
     acknowledgment — then carries it to the **jar** in the upper right (see
     "Perfection mechanics" below) and drops it into that card's slot.
     On a *re-queued* card (already failed once this session) the claw still grabs,
     but the prize slips from the claw on the way up — classic claw-machine
     heartbreak. The retry is acknowledged, but the slot keeps what the first
     attempt earned.
   - **wrong**: show the expected answer *together with the card's hint/mnemonic*
     for a few seconds (this is the "logical attachment" channel — the mnemonic
     appears exactly at the moment of failure), then re-queue the card 3–7
     positions later in the same session.
   - **timeout**: ding, treated as wrong (response recorded as whatever was typed).
5. A card leaves the session only by being answered correctly. Session ends when
   the queue is empty or the user quits (partial progress is still recorded).

## Perfection mechanics (the jar)

The upper right of the drill screen holds a glass **jar** drawn with exactly one
slot per card in the session queue (hex-packed honeycomb — reads as a single shape,
not a list). Every slot always gets filled, but *what* fills it is decided by the
card's **first attempt** — the same event that moves Leitner boxes:

- first attempt correct-in-time → the claw's prize goes in that slot;
- first attempt wrong/timeout → a dull gray **pebble** drops in instead.

So the jar always reaches visual closure, but imperfection is embedded in the
artifact: one pebble among the trinkets is impossible to unsee, and no number or
percentage is ever shown. (Numbers are the enemy here — "90%" invites the reading
*that's still an A−*. A pebble invites the reading *that slot should have been a
prize*, which is loss-framing, and losses loom larger than equivalent gains.)

**Session end is categorical, not graded:**

- **Perfect session** (every first attempt correct-in-time): the jar **seals** —
  lid screws on with a satisfying animation and a chime that plays at no other
  moment in the app — gets a label (deck, date, card count), and moves to a
  permanent **trophy shelf** on the home screen.
- **Imperfect session**: at session end the jar quietly empties back into the
  claw machine — the prizes tumble down and settle among the other trinkets in
  the pit (back into circulation, grabbable again tomorrow); pebbles fall too but
  sink out of sight so the pit stays clean. No shattering, no theatrical tip-over —
  the framing is "nothing was kept", not "you lost something". The Leitner state
  and audit log keep all the real progress, of course; what's absent is only the
  trophy.

The shelf therefore contains *only* perfection. That's the categorical difference
between 90% and 100%: not a bigger reward, but the existence of an artifact at all.

Deliberately **no instant "retry for the perfect jar"** button: the due queue is
spent, so the next real chance is tomorrow's session. Scarcity of attempts is part
of what makes a sealed jar worth having, and the unfinished feeling after a
one-pebble session is exactly the tension that brings you back.

Rejected: perfect-session *streaks* (Duolingo-style). Streak breakage punishes a
single bad day with the loss of weeks of accumulated status, which turns the app
into a source of dread; individually sealed jars accumulate monotonically and a bad
day costs only that day's jar.

### The trophy shelf at scale (denominational consolidation)

Unbounded flat accumulation dilutes meaning (the 40th identical jar means less
than the 4th — hedonic adaptation) and turns the shelf into noise. Instead the
shelf uses **place-value consolidation**, per deck (Elena's idea: jars become
positional, like an abacus of perfection):

- Each deck gets its own shelf row. Within a row, sealed jars accumulate as
  **singles** (up to nine loose); the **tenth** consolidates all ten into a
  **ten-jar**; ten ten-jars consolidate into a **hundred-jar**. Read left to
  right: hundreds, tens, then loose singles — an odometer of perfection.
- A ten-jar is a jar **of** jars: the ten miniature silhouettes remain visible
  inside the larger vessel. Consolidation must read as *promotion*, never
  confiscation (specific jars are specific memories — endowment); the hover
  label enumerates the contained sessions from the data.
- The denomination numeral (10, 100) is embossed on the glass. This does not
  violate the no-numbers rule: the taboo number is accuracy percentage;
  counts of perfection are already labeled (card counts, dates).
- The **tenth seal escalates**: when a new trophy completes a group of ten, a
  one-time consolidation ceremony plays (the ten pour/slide into the larger
  vessel) with a deeper variant of the seal chime — a rare, slow-cadence peak
  on top of the per-session one. Still no streak mechanics: consolidation
  only ever adds; a bad day costs nothing.
- Every perfect session counts equally toward consolidation regardless of
  card count (the currency stays pure; jar labels carry the size nuance). A
  minimum-cards threshold is a possible future deck setting if tiny sessions
  ever feel like farming.
- Implementation: **pure renderer derivation** over `stats.trophies()` —
  group by deck, sort chronologically, chunk by tens. No schema change, no
  contract change. The ceremony is not persisted: if the app closes before it
  plays, the next shelf render simply shows the consolidated state.

**Timer duration** = deck's `base_timer_ms` × per-box multiplier (box 1: 1.5×,
box 2: 1.25×, box 3: 1.0×, box 4: 0.85×, box 5: 0.7×). Higher boxes get tighter
timers — mastery is speed, not just recall. Defaults: 7000 ms base for piano,
5000 ms for kana; per-deck setting.

## Leitner scheduling

Five boxes. Intervals before a card is due again after a success:

| box | due after |
|-----|-----------|
| 1   | always due |
| 2   | 1 day |
| 3   | 3 days |
| 4   | 7 days |
| 5   | 30 days |

- New cards start in box 1.
- **Only the first attempt on a card within a session moves its box** (re-queued
  retries are practice and are logged, but don't count for scheduling — otherwise
  every session would end with everything "promoted").
- First attempt correct-in-time → promote one box, set `last_success_at`,
  `due_at = now + interval(new box)`.
- First attempt wrong or timeout → back to **box 1** (classic Leitner; a
  `demotion_mode` deck setting can switch to "down one box" later if the reset
  feels too punishing).

`card_state` keeps `last_success_at` explicitly (requested), plus `due_at` so
"what's due" is a single indexed comparison.

## Audit log

Every attempt — including in-session retries — is one row in `attempts`:
card, session, when it was shown, allowed timer, **elapsed ms** (measured in the
renderer with `performance.now()`; equals timer on timeout), the literal typed
response, outcome (`correct` / `wrong` / `timeout`), and box before/after.
Nothing is ever deleted; stats are SQL over this table (DuckDB's home turf).

## Content model & matching

A **card** is `prompt → accepted answers`:

- `prompt`: `{ type: "text" | "image" | "audio", text?, media? }`. Text renders
  large and centered; image renders from stored media (SVG or PNG); audio renders
  a replay button and auto-plays once.
- `answers`: array of accepted strings. Matching normalizes both sides: trim,
  lowercase, collapse internal whitespace. No fuzzy matching — the claw either
  grabs the prize or it doesn't; "almost" is wrong.
- Multiple answers cover romanization variants (し → `shi`, `si`) and notation
  choices (middle C → `c4`, `c`). The deck author decides what's acceptable;
  the engine stays dumb.
- `hint`: optional mnemonic shown on failure (see game loop).
- `tags`: array; sessions can filter by tag (drill only katakana, only bass clef,
  only ledger-line notes). This is how progressive introduction works without any
  extra "lesson" machinery.

## Deck pack format (import/export)

A `.deckpack` file is a zip (or a plain directory) containing:

```
deck.json
media/
  treble-c4.svg
  ...
```

`deck.json`:

```json
{
  "format_version": 1,
  "id": "piano-treble-v1",
  "name": "Piano — treble clef",
  "description": "Single notes on the treble staff, C4–C6",
  "settings": { "base_timer_ms": 7000, "new_cards_per_session": 5 },
  "cards": [
    {
      "id": "treble-c4",
      "prompt": { "type": "image", "media": "media/treble-c4.svg" },
      "answers": ["c4", "c"],
      "hint": "one ledger line below the staff — middle C",
      "tags": ["treble", "ledger-below"]
    },
    {
      "id": "kana-shi",
      "prompt": { "type": "text", "text": "し" },
      "answers": ["shi", "si"],
      "hint": "she has a fishing hook",
      "tags": ["hiragana", "s-row"]
    }
  ]
}
```

- Deck `id` and card `id`s are author-chosen stable strings; **re-importing a pack
  with the same deck id upserts**: existing card ids keep their Leitner state and
  history, new ids start in box 1, card ids present in the DB but missing from the
  pack are flagged and the user chooses deactivate/keep. So decks can be corrected
  and extended without losing progress.
- Export writes the same format back out (content only — progress lives in the DB;
  an "include state" export can be added later if ever needed).
- `format_version` gates the importer the same way schema_version gates the DB:
  newer app reads old packs; old app refuses new packs.
- **Format v2 (2026-07-08): answer-side audio.** A card may carry
  `"answer_media": "media/shi.ogg"` — an audio file played during the
  feedback/grab phase after the attempt, for BOTH outcomes (hearing the
  syllable at the moment of feedback attaches sound to symbol exactly when
  memory is most receptive — same principle as the mnemonic-at-failure).
  Importer accepts v1 and v2; v2 adds `cards.answer_media_id` via DB
  migration v2. Exposed to the renderer as `AnswerResult.answerMediaUrl`
  (never in `CardView` — audible answers must not leak before the attempt).
  Kana audio is committed under `scripts/audio/kana/` and embedded by
  `gen-kana.ts`; synthesis/downloading is a one-time authoring step
  (`scripts/gen-kana-audio.ts`), never a build dependency, so goldens and CI
  stay deterministic.
- Media type is inferred from file extension/MIME; audio prompts need zero new
  engine work when they arrive — a card with an `.ogg` in `media/` just works
  (renderer already branches on prompt type).

## DuckDB schema (v1)

```sql
CREATE TABLE schema_version(version INTEGER NOT NULL);

CREATE TABLE decks(
  id TEXT PRIMARY KEY,             -- pack id
  name TEXT NOT NULL,
  description TEXT,
  settings JSON NOT NULL,          -- base_timer_ms, new_cards_per_session, ...
  format_version INTEGER NOT NULL,
  imported_at TIMESTAMP NOT NULL
);

CREATE TABLE media(
  id TEXT PRIMARY KEY,             -- '<deck_id>/<path in pack>'
  deck_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL
);

CREATE TABLE cards(
  deck_id TEXT NOT NULL,
  id TEXT NOT NULL,                -- pack card id
  prompt_type TEXT NOT NULL,       -- text | image | audio
  prompt_text TEXT,
  media_id TEXT,
  answers JSON NOT NULL,           -- array of accepted strings (pre-normalized on import)
  hint TEXT,
  tags JSON NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (deck_id, id)
);

CREATE TABLE card_state(
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  box SMALLINT NOT NULL,           -- 1..5
  due_at TIMESTAMP,                -- NULL = new, never drilled
  last_success_at TIMESTAMP,
  last_seen_at TIMESTAMP,
  lifetime_correct INTEGER NOT NULL DEFAULT 0,
  lifetime_wrong INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (deck_id, card_id)
);

CREATE TABLE sessions(
  id TEXT PRIMARY KEY,             -- uuid
  deck_id TEXT NOT NULL,
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP,
  tag_filter JSON,
  settings JSON NOT NULL,          -- timer values in effect, frozen at start
  perfect BOOLEAN,                 -- NULL until ended; drives the trophy shelf
  jar JSON                         -- prize per slot; kept only for perfect sessions
);

CREATE SEQUENCE attempt_seq;
CREATE TABLE attempts(
  id BIGINT PRIMARY KEY DEFAULT nextval('attempt_seq'),
  session_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  shown_at TIMESTAMP NOT NULL,
  timer_ms INTEGER NOT NULL,       -- time allowed
  elapsed_ms INTEGER NOT NULL,     -- time taken (= timer_ms on timeout)
  response TEXT NOT NULL,          -- literal typed text, may be ''
  outcome TEXT NOT NULL,           -- correct | wrong | timeout
  is_first_of_session BOOLEAN NOT NULL,  -- only these move boxes
  box_before SMALLINT NOT NULL,
  box_after SMALLINT NOT NULL
);
```

## Process split & IPC

Main process modules (plain TS, unit-testable without Electron):

- `db.ts` — open, migrate, close; all SQL lives here or in `queries/`.
- `leitner.ts` — pure functions: `buildSessionQueue(states, settings, tagFilter, now)`,
  `applyOutcome(state, outcome, isFirstOfSession, now)`. No I/O.
- `packs.ts` — import/export of `.deckpack` (fflate + JSON validation).
- `ipc.ts` — thin ipcMain handlers wiring the above.

Preload (`contextBridge`) exposes a typed `window.api`:

```ts
decks:   { list(), import(filePath), export(deckId, filePath), remove(deckId),
           updateSettings(deckId, settings) }
session: { start(deckId, { tags? }) -> { sessionId, queueLength, first: CardView },
           answer(sessionId, { cardId, response, elapsedMs, timedOut })
             -> { outcome, expected?, hint?, next: CardView | null, remaining },
           abort(sessionId) }
stats:   { deckSummary(deckId), cardHistory(deckId, cardId), attemptLog(filter) }
```

The session queue lives in main (single source of truth; renderer can't lose it on
a reload). Renderer owns the timer UI and measures elapsed time; main clamps
`elapsedMs` to `timer_ms` and records.

**Media delivery:** main registers a custom protocol `mem://media/<id>` via
`protocol.handle`, streaming the BLOB with the right MIME. The renderer just uses
`<img src="mem://media/...">` / `<audio src=...>` — no IPC round-trip, no blob-URL
bookkeeping, works for images and audio alike.

## UI (three screens, no framework — DOM + TS like ayamt)

1. **Home / deck list** — each deck: name, cards due now, new cards remaining,
   box-distribution mini-bar, [Drill] [Drill by tag…] [Export]. Global [Import].
   Below the decks: the **trophy shelf** — sealed jars from perfect sessions,
   newest first, hover for label (deck, date, size).
2. **Drill** — the game. Claw sprite travelling its rail, prize pit below, the
   session jar upper right, prompt, input, remaining count, failure feedback
   (answer + mnemonic). Esc aborts (the jar empties back into the pit). The prize pit draws from a
   built-in pool of a few hundred emoji trinkets (weighted so oddities are rare —
   a small variable-reward hook); the pool is a plain TS array, trivially
   extensible.
3. **Stats** — per deck: box histogram, due forecast, response-time trend
   (median elapsed_ms per day); per card: box, last success, attempts sparkline;
   raw attempt log table (filter by deck/card/outcome/date).

## Starter decks (generated, shipped as .deckpacks)

- `scripts/gen-kana.ts` — hiragana + katakana as one deck each: 46 base kana,
  voiced/semi-voiced (が/ぱ), and yōon digraphs (きゃ…), tagged by script and row.
  Answers include Hepburn plus common variants (shi/si, tsu/tu, fu/hu, ji/zi…).
  Pure text, no media.
- `scripts/gen-piano.ts` — programmatic SVG generation (~100 lines: 5 staff lines,
  embedded clef path, notehead ellipse, ledger lines). One deck per clef,
  treble C4–C6 and bass C2–E4, tagged `in-staff` / `ledger-above` / `ledger-below`
  so drilling can start with in-staff notes only. Answers: `["c4", "c"]` style —
  letter alone accepted so octave numbers can be ignored while learning.

Generators run at dev time and commit the resulting `.deckpack`s; the app itself
has no special knowledge of these decks — they go through the normal importer.

## Migrations & versioning

Copied from ayamt: `schema_version` table + ordered array of migration functions
run in a transaction on open; newer app migrates older DB files, older app refuses
newer files. Pack `format_version` handled the same way in `packs.ts`.

## Testing strategy

The pyramid is deliberately bottom-heavy: everything that decides *what happens*
(scheduling, matching, state transitions) is pure TS with no I/O, tested exhaustively;
the Electron glue is kept too thin to hide bugs and covered by one smoke test.

**Design-for-test rules (these are architecture, not test code):**

- `leitner.ts`, answer matching, and pack validation take **injected `now` and RNG**
  (queue shuffle, prize pick) — never `Date.now()`/`Math.random()` directly. Every
  scheduling test is deterministic; "30 days later" is an argument, not a sleep.
- The drill flow in the renderer is a **pure state machine module**
  (`drill-machine.ts`: state + event → new state + effects list); the DOM/animation
  layer just renders states and fires events. The machine is unit-tested; the DOM
  binding is not.
- Main-process modules import cleanly under plain Node (no `electron` import outside
  `main.ts`/`ipc.ts`), so tests need no Electron at all.

**Layers:**

1. **Unit tests (the bulk)** — Vitest (one dev-dep; it reuses the Vite config already
   in the stack — `node:test` + tsx was the zero-dep alternative but adds a loader
   dep anyway and worse DX). Covers: box transitions incl. first-attempt-only rule;
   queue building (due math, new-card cap, tag filter); answer normalization
   (romaji variants, case/whitespace); pack JSON validation against malformed
   fixtures; elapsed-ms clamping and timeout attribution; the drill state machine
   (correct/wrong/timeout/re-queue/abort paths).
2. **DB tests against real DuckDB** — no SQL mocking; `@duckdb/node-api` opens
   `:memory:` databases, so these stay fast. Covers: fresh-file migration to latest;
   migration from each historical version (keep a tiny fixture DB per released
   schema version); newer-file refusal; import-upsert preserving `card_state`;
   attempt insertion; the due-cards query. If the native addon misbehaves in
   Vitest's worker pool, set `pool: 'forks'` for this suite.
3. **Generator golden tests** — `gen-kana`/`gen-piano` output is committed;
   tests regenerate and diff, so an accidental change to the SVG math or romaji
   table shows up as a failing diff, reviewed by eye once.
4. **One Playwright-Electron smoke test** (run before packaging, not on every save):
   launch the packaged app with a temp userData dir, import the fixture pack, run a
   2-card drill with a generous timer, answer one right and one wrong, assert the
   prize tray/re-queue behavior and that `attempts` rows landed in the DB. Its job
   is to catch wiring rot (preload bridge, `mem://` protocol, native addon packaging),
   not game logic.
5. **Manual checklist for feel** (in `docs/verify.md`): tick acceleration and ding
   volume, claw animation timing, audio-prompt playback, keyboard-only flow. These
   can't be meaningfully asserted; they're verified by playing a session.

**Fixtures:** one tiny committed `.deckpack` (text + image + audio card, plus
deliberately broken variants: bad JSON, missing media, unknown `format_version`)
under `test/fixtures/`.

`npm test` runs layers 1–3 in watch-able seconds; the smoke test is `npm run test:e2e`.

## Build order (suggested)

1. Scaffold from Forge Vite+TS template (mirror ayamt configs), DB open/migrate.
2. `leitner.ts` pure logic + unit tests (queue building, box transitions).
3. Pack importer + kana generator → real deck in the DB.
4. Drill screen with timer, WebAudio tick/ding, attempt recording.
5. Home screen with due counts; stats screen last.
6. Piano SVG generator + deck.

## Open questions (defaults chosen, easy to change)

- Failure → box 1 (classic) vs down-one-box: **defaulting to classic reset**;
  it maximizes the stress/repetition that works for Elena, and `demotion_mode`
  is a one-line setting if it's too brutal for 5-box piano material.
- Whether octave numbers should be required for piano answers: **not required**
  in the starter decks (both accepted); tighten by editing the pack later.
- Kana input: typing romaji is the drill (recognition). A reverse deck
  (romaji → type kana with an IME) is just another pack, no engine change.
