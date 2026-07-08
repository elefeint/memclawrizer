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
- [x] F1 drill-machine.ts (pure state machine) + unit tests over
      correct/wrong/timeout/re-queue-slip/abort/perfect-seal
- [x] F2 drill screen: claw rail timer (tick accel last 25%), prize pit
      (weighted emoji pool), honeycomb jar, prompt branches, feedback
      (answer + mnemonic), Esc abort, WebAudio tick/ding/seal-chime, testids
- [x] F3 home screen: deck list (due/new counts, box mini-bar, drill/drill-by-tag/
      import/export), trophy shelf
- [x] F4 stats screen: box histogram, due forecast, response-time trend,
      per-card table, filterable attempt log

## Integration (coordinator drives; needs B4+B5+F2+F3)
- [ ] Real `npm start`: import kana deckpack, play a full session
- [x] test/e2e/smoke.spec.ts (Playwright-Electron) against the PACKAGED app
- [x] `npm run package` + `npm run make` on Linux (deb built; rpm needs
      rpmbuild installed — not present on this machine; zip maker is
      darwin-scoped in forge.config.ts)
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
- 2026-07-05 [frontend] F1 done (drill-machine + 18 unit tests). F2 done (drill
  screen, WebAudio, router; verified by playing imperfect/perfect/abort mock
  sessions over CDP against `start:mock`). F3 in progress: home.ts rewritten
  (deck rows with box mini-bar, tag picker, export, settings; trophy shelf) —
  compiles + tests green, CSS for the new home elements NOT yet written, not
  yet verified in-app. Next: home CSS, lint pass, verify under start:mock,
  commit F3, then F4 stats screen.
  NOTE for integration: `npm run lint` cannot run inside agent worktrees
  (ESLint 8 cascades to the parent checkout's .eslintrc.json through
  `.claude/worktrees/` and default-ignores dot-dirs); equivalent gate used:
  `npx eslint --no-eslintrc -c .eslintrc.json --resolve-plugins-relative-to . --ext .ts,.tsx .`
  Works fine from a normal checkout; adding `"root": true` to .eslintrc.json
  (root config, not frontend-owned) would fix worktrees for everyone.
  [coordinator: backend already added "root": true in B1 — fixed on main.]
- 2026-07-05 [backend] B5 done — ALL backend milestones complete. 99 tests
  green, lint clean. decks/: kana-hiragana + kana-katakana (104 cards each),
  piano-treble (15) + piano-bass (17), regenerated idempotently by
  `npm run gen:decks`, golden-tested byte-for-byte and import-tested through
  packs.ts. Live-verified: kana + treble decks listed over the real api.
  Caveat for the feel checklist: the clef glyphs are stylized paths, not
  engraved SMuFL — if Elena wants prettier clefs, only the two path constants
  in scripts/gen-piano.ts need replacing (then `npm run gen:decks` refreshes
  the goldens).
- 2026-07-05 [frontend] F3 and F4 done and verified over CDP against
  `start:mock` (home widgets incl. tag-picker drill entry, settings save,
  import/export status lines, trophy after perfect run; stats charts render
  light+dark with working tooltips, filter row re-queries the attempt log).
  All four frontend milestones complete; 22 tests green. The mock's
  stats.attempts ignores AttemptFilter (returns a fixed row), so filter
  *semantics* are only exercisable against the real backend at integration.
  No contract changes, no new dependencies.
- 2026-07-05 [backend] I1 done. @playwright/test installed (no browser
  download needed — drives the packaged Electron binary directly).
  test/e2e/smoke.spec.ts: seeds a temp-profile DB with mini.deckpack via the
  normal import path, launches out/memclawrizer-linux-x64/memclawrizer
  --no-sandbox with MEMCLAW_USERDATA, plays a full drill (adaptive answers —
  the queue is shuffled server-side): one deliberate wrong + feedback check,
  re-queue verified, mem:// image asserted via img.naturalWidth, jar = 3
  prizes + 1 pebble, imperfect end, empty trophy shelf; then reopens the DB
  and asserts 5 attempts rows (outcomes + is_first flags + no box move on
  retry) and sessions.perfect=false with ended_at set. `npm run test:e2e`
  passes in ~18s. REQUIRED FUSE CHANGE: EnableNodeCliInspectArguments now
  true (ADR-0005) — Playwright hangs otherwise; RunAsNode stays false.
  `npm run make` produces the deb; rpm blocked on missing rpmbuild binary
  (machine, not code); zip maker is darwin-only by config.
- 2026-07-07 [frontend] Graphics upgrade Assets A-E done
  (docs/graphics-requirements.md; Asset F is the coordinator's). Five sliced
  inline SVGs under src/renderer/assets/ (1.4-5.9KB each) + svg-assets.ts
  injection helper (?raw import, per-group data-viewbox slicing); wired into
  drill (layered jar back/slots/front/rim + lid + label plate, articulated
  claw with finger close/open at declared pivots, scaleY cable stretch,
  wheel spin during travel, final-25% accent lamp, drawn pebble, pit set
  dressing) and home (mini-jar trophies on a wood shelf strip).
  Screenshot-verified per animation phase (grab/slip/pebble/seal/empty) in
  BOTH themes over CDP against start:mock; travel locked 60fps (worst frame
  16.8ms in the dark run). data-testids and jar-slot .prize/.pebble classes
  untouched, but please re-run `npm run test:e2e` against a fresh package
  before release (not runnable from this worktree). 117 tests + lint green.
