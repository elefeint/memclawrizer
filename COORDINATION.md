# Agent coordination

Ownership map and rules: see CLAUDE.md ("Agent team & file ownership").
Contract: `src/shared/api.ts` (+ normalize.ts, testids.ts) — frozen; change
requests go in the section below.

## Backend agent — milestones
- [x] Phase 0 (done by coordinator): scaffold, db.ts + migration v1, contract, packaging proof
- [x] B1 DB hardening: migration-runner edge cases, refuse-newer coverage, queries layout
- [x] B2 leitner.ts + matching integration (pure, injected now/RNG) + exhaustive unit tests
- [x] B3 packs.ts (fflate zip + bare dir, validation, format_version gate, upsert
      preserving card_state, orphan flagging, export) + test/fixtures/mini.deckpack + broken variants
- [x] B4 sessions.ts + ipc.ts + real preload + mem:// BLOB streaming; verify real
      `npm start` renders mem:// images; re-verify `npm run package`
- [x] B5 generators: scripts/gen-kana.ts, scripts/gen-piano.ts + golden tests +
      committed decks/*.deckpack

## Frontend agent — milestones
- [ ] F1 drill-machine.ts (pure state machine) + unit tests over
      correct/wrong/timeout/re-queue-slip/abort/perfect-seal
- [ ] F2 drill screen: claw rail timer (tick accel last 25%), prize pit
      (weighted emoji pool), honeycomb jar, prompt branches, feedback
      (answer + mnemonic), Esc abort, WebAudio tick/ding/seal-chime, testids
- [ ] F3 home screen: deck list (due/new counts, box mini-bar, drill/drill-by-tag/
      import/export), trophy shelf
- [ ] F4 stats screen: box histogram, due forecast, response-time trend,
      per-card table, filterable attempt log

## Integration (coordinator drives; needs B4+B5+F2+F3)
- [ ] Real `npm start`: import kana deckpack, play a full session
- [ ] test/e2e/smoke.spec.ts (Playwright-Electron) against the PACKAGED app
- [ ] `npm run package` + `npm run make` on Linux
- [ ] Elena runs docs/verify.md feel checklist

## Contract change requests
(append here: what / why / which types; coordinator approves; additive only)

## Dependency requests
(Frontend appends here; Backend installs and commits)

## Status notes
- 2026-07-05 [coordinator] Phase 0 in progress.
- 2026-07-05 [backend] B1–B4 done, tests green (81), lint clean. Session
  semantics match mock-api spec (verified by mirrored tests against real
  DuckDB). Dev + packaged runs verified: "real api" badge, deck list over IPC,
  mem:// image loads. Notes for integration: MEMCLAW_USERDATA env overrides
  the profile dir (needed for Playwright smoke + parallel dev runs — DuckDB is
  single-writer, a running mock-mode app locks the real DB); MEMCLAW_VERIFY=1
  makes the app dump badge/deck-rows/mem-probe and quit; scripts/import-pack.ts
  seeds a DB from a pack. Next: B5 generators (gen-kana, gen-piano, golden
  tests, decks/).
- 2026-07-05 [backend] B5 done — ALL backend milestones complete. 99 tests
  green, lint clean. decks/: kana-hiragana + kana-katakana (104 cards each),
  piano-treble (15) + piano-bass (17), regenerated idempotently by
  `npm run gen:decks`, golden-tested byte-for-byte and import-tested through
  packs.ts. Live-verified: kana + treble decks listed over the real api.
  Caveat for the feel checklist: the clef glyphs are stylized paths, not
  engraved SMuFL — if Elena wants prettier clefs, only the two path constants
  in scripts/gen-piano.ts need replacing (then `npm run gen:decks` refreshes
  the goldens).
