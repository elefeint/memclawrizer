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
- 2026-07-08 [coordinator] Change #1 APPROVED and applied: `AnswerResult`
  gains optional `answerMediaUrl?: string | null` — answer-side audio
  (spoken syllable) played during feedback/grab for both outcomes.
  Deliberately NOT on CardView (would leak the answer before the attempt).
  Additive; older backends simply never set it.
- 2026-07-10 [coordinator] Change #2 APPROVED and applied: `DeckSettings`
  gains required `maxBox1ForNew` (default 10 via DEFAULT_MAX_BOX1_FOR_NEW).
  New-card introduction is gated by box-1 capacity (leitner.buildSessionQueue,
  two-pass). Plumbed by the coordinator through packs (optional
  `max_box1_for_new`; v1/v2 packs without it get the default), queries
  (defaults for legacy rows), settings UI third field, generators, and mock.
  Also: kana audio regenerated at open_jtalk -r 0.5 with 60 ms lead-in and
  looser tail trim (clips 0.25–0.61 s, median 0.39 s — was 0.14–0.26 s,
  "too short to catch").

- 2026-07-12 [coordinator] Change #5 APPLIED (coordinator-built, no agent):
  `DeckSettings` gains required `retrievalAllowanceMs` (default 2200 via
  DEFAULT_RETRIEVAL_ALLOWANCE_MS — the old hardcoded 1200 + Elena's extra
  second). Calibration math now uses the deck's allowance (main + mock);
  pack setting `retrieval_allowance_ms` optional; Settings UI 4th field
  ("thinking room"); generators author piano 2200 / kana 3500; decks
  regenerated. Also FEEDBACK_MS 2800 -> 3300 (+500 ms answer visibility).

## Queued (2026-08, pre-1.0)
- [ ] B11 [backend]: one trophy chance per day (DESIGN.md "One trophy chance
      per day"). sessions.start already computes `drilledToday` via
      hasDrillSessionSince — carry it as the session's trophyEligible; at
      session end only seal (perfect=true + jar persisted) when eligible.
      Later same-day sessions record attempts/boxes as usual but never seal.
      SessionStart gains `trophyEligible: boolean` (contract #7, additive).
      Tests: first session of the day seals; a perfect SECOND session the same
      day does not; next local day seals again; calibration doesn't consume it.
- [ ] F11 [frontend]: honour trophyEligible — ghost/outlined jar + quiet
      "practice round — today's jar is already decided" line when false; no
      seal ceremony, no chime; the empty-back-to-pit ending stays as-is.
- [ ] Kana hints (coordinator, pending Elena's go-ahead): gen-kana.ts writes
      hints — voiced/semi-voiced systematically (dakuten = base kana, voiced),
      base kana as shape mnemonics for Elena to veto. Regenerate + goldens.
- [ ] Practice-day streak (pending Elena's global-vs-per-deck call): global
      consecutive-days counter + ~30-day dot strip in the home header;
      attendance not perfection; no schema change (attempts.shown_at).

## New milestones (2026-08): arcade drill button + global Hall of Fame
- [x] B10 [backend]: implement stats.records() per contract #6 (HallOfFame in
      shared/api.ts) — SQL aggregates in stats.ts/queries.ts: deckScores
      (sealed jars = perfect drill sessions per deck incl. archived, box-5
      counts, lifetime attempts), fastestCorrect (correct first-attempt min
      elapsed_ms with deck/prompt/date), largestPerfectSession, busiestDay
      (local day, attempt count), daysPracticed, totalAttempts. Calibration
      rows/sessions excluded everywhere. ipc handler statsRecords (preload
      pre-wired). Real-DuckDB tests incl. exclusion proofs + empty-DB nulls.
- [x] F10 [frontend]: (a) arcade DRILL button per DESIGN.md UI item 1 —
      mounted recessed well, convex accent dome, gloss, sink-on-press,
      unlit+disabled when dueCount==0 && newCount==0, taller rows, gear stays
      quiet, per-row Stats button REMOVED; (b) global Hall of Fame screen per
      UI item 3 — dark CRT panel in both themes, high-score deck table
      (score = sealed jars), records section, deck-picker feeding the
      existing charts/tables (archived decks included; Archived section's
      Stats link deep-links); header entry replaces per-row Stats; mock
      records stub is yours to flesh. CDP screenshots both themes.

## New milestones (2026-07-12): once-a-day new cards + settings screen
- [x] B9 [backend]: bug fix — session.start introduces new cards only when NO
      drill session (kind='drill') for this deck started earlier the same
      LOCAL calendar day (calibration sessions don't count); same-day
      sessions get newCardsPerSession=0 effectively. Injected-now tests:
      same-day second session no new; next-day new again; tag-filtered and
      full-deck sessions share the per-deck day gate.
- [x] F9 [frontend]: settings move out of the inline disclosure to a
      dedicated deck-settings screen (timer, new/session, box-1 gate,
      thinking room, Save, Recalibrate, Archive) reached via a gear icon at
      the RIGHT edge of each active deck row; Back button returns to the
      overview. Mock mirrors the B9 same-day rule (in-memory last-drill-day
      per deck). Tests + CDP both themes.

## New milestones (2026-07-11): timer calibration (DESIGN.md "Timer calibration")
- [x] B8 [backend]: schema v4 (sessions.kind TEXT DEFAULT 'drill'); calibration
      ipc (start samples ~10 cards' canonical answers with injected rng;
      submit logs attempts rows outcome='calibration' box_before=box_after,
      session kind='calibration', computes floor/suggestion per DESIGN math,
      applies baseTimerMs to settings, stamps calibration; abort discards);
      deckSummaries.calibratedAtIso = latest calibration session end (replace
      stub in stats.ts); stats medians + trophies queries exclude
      calibration rows/sessions; migration + gates.
- [x] F8 [frontend]: calibration screen (no claw/timer/sounds; "type what you
      see" trials, Enter submits, mistyped trial repeats, progress dots);
      auto-runs when Drill is clicked on a deck with calibratedAtIso null,
      then flows into the drill (tag selection carried through); result
      announcement ("floor 1.4s → timer set to 2.5s"); Recalibrate button in
      deck Settings; skippable (skip = proceed to drill, re-offered next
      time); mock already implements the math — extend/tests/CDP both themes.

## New milestones (2026-07-10): archivable decks (DESIGN.md "Deck lifecycle")
- [x] B7 [backend]: schema v3 (decks.pack_id backfilled = id, decks.archived_at
      NULL); queries expose both + archive/unarchive updates; import matches
      ACTIVE deck by pack_id, else creates a new deck (internal id minted
      <pack_id>#2… on collision; most-recently-imported wins if several
      active share a pack_id); export writes pack_id as the pack's id;
      session.start on an archived deck rejects; deckSummaries fills real
      packId/archivedAtIso (replace coordinator stubs in stats.ts); ipc
      handlers for decks:archive/decks:unarchive; migration + import + e2e
      gates.
- [x] F7 [frontend]: home splits active list from a collapsed "Archived"
      section (name, card count, archived date, Unarchive button, Stats
      link); Archive action inside each deck's Settings details (not a
      bare top-level button — misclick-resistant); archived decks keep
      trophies on the shelf; mock flows already stubbed by coordinator —
      flesh out + tests + CDP verification both themes.

## New milestones (2026-07-08): answer-side audio (pack format v2)
- [x] B6 [backend]: PACK_FORMAT_VERSION=2 accepting v1+v2; optional card
      `answer_media` (audio, path-validated); DB migration v2 adds
      `cards.answer_media_id`; import/export round-trip; sessions set
      `answerMediaUrl` on every AnswerResult for cards that have it;
      `scripts/gen-kana-audio.ts` one-time authoring script (TTS/downloads,
      NOT a build dep) writing committed `scripts/audio/kana/*.ogg`;
      `gen-kana.ts` embeds them when present (both syllabaries share files);
      goldens updated; v1-fixture migration test.
- [x] F6 [frontend]: drill-machine emits a `playAnswerAudio(url)` effect on
      RESULT when `answerMediaUrl` present (both outcomes, during
      feedback/grab); DOM layer plays via <audio> element (mem:// fetch()
      fails by scheme — element loading only); mock gains a data:-URI wav on
      one card; unit tests for the effect; CDP-verify audible path exists.

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
- 2026-07-08 [frontend] Denominational trophy shelf done (DESIGN.md "The
  trophy shelf at scale"). Pure derivation in src/renderer/shelf.ts
  (deriveShelf + consolidationEvent, 22 unit tests incl. 0/9/10/11/99/100/
  101/113, multi-deck, oldest-ten stability); per-deck odometer rows in
  home.ts; denomination vessel + embossed 10/100 numerals (drawn geometry)
  added to jar-mini.svg; playConsolidationChime in audio.ts (exclusive to
  the ceremony). Ceremony detection = same-session per-deck count diff
  across home renders, module-level baseline, unpersisted by design.
  mock-api.ts seeds 9 piano trophies (one perfect run = ceremony) + 113
  for a trophies-only 'mock-legacy' row (hundred + ten + 3 singles).
  Verified over CDP in both themes: seeded shelf, mid-ceremony pour,
  consolidated after-state, hundred-jar. 139 tests + lint green.
- 2026-07-09 [frontend] F6 done. playAnswerAudio(url) is emitted as the
  FIRST effect of the grab/slip/feedback phase for both outcomes, retries
  included; DOM plays through one reused <audio> element (new src stops the
  previous clip; no tick/ding ducking by design; paused+cleared on
  unmount). Mock builds 0.15s WAV data URIs in code — し 440Hz / か 660Hz /
  mock-hard 880Hz, ん deliberately null. CDP-verified with an instrumented
  HTMLMediaElement.play hook (screenshots can't hear): exactly one play per
  resolution with the right per-card src (correct, wrong, and retry), zero
  plays for ん's timeout, single element reused. 143 tests + lint green.
  NOTE for integration: real backend must emit answerMediaUrl on session
  answers for kana cards once B6 audio lands — renderer is ready either way
  (absent/null = silent, per contract).
- 2026-07-10 [backend] B6 done. Pack format v2 (v1 still accepted), DB
  migration v2 (cards.answer_media_id), sessions attach answerMediaUrl on
  every AnswerResult (both outcomes, retries) for cards with answer_media.
  Audio synthesis RAN: open_jtalk (nitech_jp_atr503_m001) + bitexact ffmpeg
  post-processing; 104 committed oggs in scripts/audio/kana/ (808K,
  re-runs byte-identical; n sanity-checked, not degenerate). Kana decks
  regenerated with embedded audio (~400K each); goldens extended. Gates:
  145 unit/DB tests + lint green; packaged app migrated a COPY of the real
  profile DB v1→v2 (267 attempts, 20 sessions, 3 trophies intact); e2e
  smoke passes against the new package. For F6: answerMediaUrl is a
  mem:// URL — <audio> element only, fetch() fails by scheme.
- 2026-07-11 [backend] B7 done. Schema v3 (pack_id backfilled = id,
  archived_at); import matches the ACTIVE deck by pack_id (most recently
  imported wins) and otherwise mints <pack_id>#2/#3... — archived decks'
  history is frozen; export emits pack_id so round-trips keep the author id;
  session.start on archived decks throws "... is archived — unarchive it to
  drill"; deckSummaries fills real packId/archivedAtIso (stubs replaced);
  decks:archive/decks:unarchive handled. Gates: 157 unit/DB tests + tsc +
  lint green; packaged app migrated a COPY of the real profile v2→v3 (330
  attempts, 23 sessions, 4 trophies intact, pack_id backfilled on all 5
  decks); e2e smoke passes. Note for F7: decks.list still returns archived
  decks (archivedAtIso non-null) — filter for the active list, render the
  rest in the Archived section.
- 2026-07-11 [frontend] F7 done. Home splits on archivedAtIso: active rows
  unchanged; archived decks in a collapsed "Archived (n)" <details> below
  the list (name, count, archived date, Unarchive, Stats — no Drill).
  Archive button sits inside each deck's Settings disclosure, pushed right
  of Save (misclick-resistant, no confirm — reversible). Status line
  announces both directions; the section element persists across refreshes
  so its open state survives unarchiving. Mock extended: session.start on
  an archived deck now REJECTS (mirrors B7) — integration note: mock and
  real backend should agree on this. New elements use plain classes
  (.archived-section/.archived-row/.archive-button/.unarchive-button/
  .archived-list) — testids.ts untouched (frozen); smoke test could want
  an 'archived-section' testid later. Verified over CDP against start:mock
  in BOTH themes (26 scripted assertions + 10 screenshots): archive kana
  from Settings → appears under Archived → archive piano too → its 9
  seeded shelf trophies unaffected (shelf reads stats.trophies() only, no
  deck-list cross-filter — mock-legacy already proves it) → "no active
  decks" message → unarchive both → status lines correct. 155 tests
  (+2 archiving specs in mock-api.test.ts) + tsc + lint green.
- 2026-07-11 [backend] B8 done. Schema v4 (sessions.kind, NULL=drill);
  calibration.ts mirrors the mock math exactly (floor = median of
  copy-matched trials, (floor+1200)/1.5 to 100ms in [1500,10000], applied
  only with >=3 correct); trials audit-logged (outcome='calibration',
  timer_ms=0, box frozen, zero card_state writes); calibratedAtIso = latest
  APPLIED run (ended_at set only then; aborted/insufficient runs keep
  ended_at NULL by design); drill medians and trophies proven pollution-free;
  attempt log filterable by outcome='calibration'. Gates: 171 tests + tsc +
  lint; packaged app migrated real-profile COPY v3→v4 (330 attempts, 23
  drill sessions, 4 trophies intact); e2e smoke green.
- 2026-07-11 [frontend] F8 done. screens/calibrate.ts (calm: no claw/timer/
  sounds; big answer text, Enter submits, elapsed = performance.now() from
  display to Enter; mistype re-queues to the END and every attempt goes in
  the submit batch; progress dots; Esc = abort + proceed unchanged). Pure
  queue logic in calibration-queue.ts (unit-tested). Home routes Drill and
  Drill-by-tag through the warm-up when calibratedAtIso is null (drill
  intent incl. tags carried through); result line holds CALIBRATE_RESULT_MS
  (timings.ts, 2600) then the drill starts on the fresh settings.
  "Recalibrate timer" in each Settings block returns home announcing via
  the status line (nav.home/mountHome gained an optional announce arg).
  Mock: per-instance deck copies (settings mutations no longer leak across
  createMockApi() instances — was module-level) + 4 calibration spec tests
  (clean-median floor, suggestion math incl. the 1700 example, <3-clean
  not-applied branch, abort discards; session.start returns the new
  timerMs). CDP-verified BOTH themes + a skip run (22 assertions, 11
  screenshots): timer pickup asserted via the claw's travel transition —
  `transform <ms>ms linear` on .claw — equal to the suggested ms parsed
  from the result line (5000 → 1800 in the run), persisted on the next
  drill, no re-prompt once calibrated; recalibrating 1-card mock-piano
  exercises the too-few-clean-trials branch end-to-end. New classes (no
  testids, frozen): .calibrate, .calibrate-text/-input/-dots/-note/-result,
  .recalibrate-button. Integration note: renderer expects backend
  calibration.start to sample ANSWER texts and submit to apply settings +
  stamp calibratedAt exactly like the mock. 167 tests + tsc + lint green.
- 2026-07-12 [backend] B9 done. session.start checks for an earlier
  kind='drill' session for the deck since LOCAL midnight (injected now,
  setHours(0,0,0,0); check runs before this session's own insert;
  calibration doesn't count) and if found builds the queue with an
  effective newCardsPerSession=0 — stored settings and leitner.ts
  untouched. queries.hasDrillSessionSince helper. 5 injected-now tests:
  same-day gating (incl. late evening), next-local-day reset, calibration
  exempt, tag/full sessions share the per-deck gate, summaries unaffected.
  184 tests + tsc + lint green; e2e smoke green against a fresh package.
  Note: an empty first session (nothing due, nothing new) also consumes the
  day — consistent with "repeat sessions don't expand", flag if unwanted.
- 2026-07-13 [frontend] F9 done. screens/deck-settings.ts behind a gear
  icon button at each active row's right edge (inline SVG path, aria-label
  "deck settings", quiet-until-hover; archived rows unchanged, no gear).
  The screen carries all four fields with their tooltips + Save +
  Recalibrate timer + Archive deck; Back (top-left, focused on mount) and
  Escape return home; Save/Archive return home announcing through
  mountHome's announce arg. Inline Settings <details> and its CSS removed
  from the deck row. Nav gained deckSettings(deckId). Mock mirrors B9:
  per-deck introduced-set + last-drill-day (LOCAL calendar day, injectable
  via optional MockApiHooks.today); due cards always drill, new cards only
  on the day's first drill start capped by newCardsPerSession; calibration
  exempt; 3 spec tests (same-day repeat, next-day resume, per-deck gate,
  calibration exemption). CDP-verified BOTH themes (20 assertions, 12
  screenshots): gear opens populated screen, Save persists across reopen +
  announces, Back/Escape return, Recalibrate flows warm-up→home with
  result + context line gains the calibrated date, Archive lands in the
  Archived section (gearless) + announces. New classes (testids frozen):
  .gear-button, .settings-screen/-header/-heading/-context/-form/-field/
  -actions, .back-button. 187 tests + tsc + lint green.
- 2026-08-02 [backend] B10 done. stats.records(): deckScores (all decks
  incl. archived, sealed jars = perfect drill sessions, box-5 counts,
  non-calibration lifetime attempts; sorted jars desc then name/id),
  fastestCorrect (correct first-attempt min elapsed with deck/prompt/full
  ISO date), largestPerfectSession (max jar length, most-recent tiebreak),
  busiestDay + daysPracticed + totalAttempts on LOCAL calendar days (JS
  day keys mirroring B9's setHours(0,0,0,0), DST-correct). Calibration
  excluded from every figure — proven by an interleaved 10ms calibration
  run that would otherwise win fastest/busiest. Empty-DB nulls/zeros
  tested. ipc statsRecords wired. 189 tests + tsc + lint green; e2e smoke
  green on a fresh package. Note for F10: busiestDay.dateIso is a local
  'YYYY-MM-DD'; fastestCorrect/largestPerfectSession dateIso are full ISO
  timestamps — format in the renderer.
- 2026-08-02 [frontend] F10 done, both halves.
  (a) The deck row's Drill is a 54px convex dome mounted in a recessed well
  (76px min row height): gloss upper-left, drop shadow, 3px sink + shadow
  collapse on :active. Unlit (dimmed/desaturated/disabled, title "nothing
  due right now") when dueCount === 0 && newCount === 0 — which also keeps
  an empty session from consuming B9's once-a-day introduction. Per-row
  Stats REMOVED; the gear is unchanged. The ALL-CAPS label is
  `font-variant-caps: all-small-caps`, deliberately NOT text-transform, so
  the accessible name stays exactly "Drill" (Playwright folds
  text-transform into accname — the smoke test's
  getByRole('button', { name: 'Drill', exact: true }) is safe).
  (b) screens/hall-of-fame.ts is one GLOBAL screen routed as
  nav.hallOfFame(deckId?) (Nav.stats is gone; renderer.ts no longer mounts a
  per-deck stats screen). Header entry beside Import; the Archived section's
  Stats deep-links with its deck preselected; Escape/← decks return home.
  Dark CRT panel in BOTH themes — it re-points --fg/--muted/--accent/
  --cabinet/--bg/--chart-* at phosphor values, which is why the reused charts
  and tables needed no restyling. screens/stats.ts is now
  screens/deck-detail.ts exporting mountDeckDetail(host, deckId) (no header,
  no screen identity) plus fmtDate/fmtDateTime/fmtMs.
  Pure layer: hall-of-fame-data.ts — competition ranking (ties share a rank,
  next rank skips), arcade ordinals, parseDateIso (bare 'YYYY-MM-DD' read as
  LOCAL midnight per the B10 note; full timestamps as instants), recordTiles
  through injected formatters (null-safe on an empty DB), deckOptions +
  initialDeckId. 14 unit tests. Mock records() now derives from the mock's
  own state (jars/attempts move as you play, archived flag included) + a
  third deck 'mock-done' (0 due / 0 new) so the unlit button is exercisable;
  3 mock spec tests. 206 tests + tsc + lint green.
  CDP-verified BOTH themes in one run (44 assertions, 10 screenshots):
  lit + unlit rows, a real Input.dispatchMouseEvent press showing
  matrix(1,0,0,1,0,3), all three CRT sections, ranks 1ST/2ND/3RD/3RD with
  the leader highlighted, five record tiles incl. day-key vs timestamp
  formatting, picker switching (detail replaced, not stacked), archive →
  Archived section → Stats deep link (archived deck preselected and marked).
  Notes for integration: the screen reuses the frozen `stats-screen` testid —
  a 'hall-of-fame' testid (and 'drill-button') would be welcome if testids.ts
  ever thaws. The empty-database branches (no decks, all records null) are
  unit-tested only; they need a fresh profile to see in-app.
