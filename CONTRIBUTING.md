# Contributing / building from source

Electron + TypeScript + DuckDB. Design rationale lives in **DESIGN.md**;
decisions are logged in **docs/decisions.md** (lightweight ADRs — read before
relitigating anything).

## Run

    npm install
    npm start

Import a deck from `decks/` on the home screen and drill. On Ubuntu 24.04,
`npm start` may abort on the SUID sandbox helper — see the dev-machine note in
docs/decisions.md ADR-0004.

Installers: `npm run make` (deb/rpm on Linux, Squirrel on Windows, zip on
macOS). Tagged pushes (`v*`) build all three platforms in CI and attach them
to a GitHub release.

## Develop

    npm test            # unit + DB tests (real in-memory DuckDB, no SQL mocks)
    npm run start:mock  # renderer against a deterministic mock backend
    npm run test:e2e    # Playwright smoke test against the packaged app
    npm run lint
    npx tsc --noEmit

The testing pyramid is deliberately bottom-heavy: pure logic (Leitner,
matching, drill state machine) takes injected clocks/RNG and is tested
exhaustively; the Electron glue is thin and covered by the one smoke test.
All four gates above should be green before a PR.

Architecture in one breath: the main process owns the database and all file
I/O; the renderer is UI-only behind a typed contextBridge contract
(`src/shared/api.ts`); media streams over a custom `mem://` protocol; schema
migrations are hand-rolled (`src/main/db.ts`).

## Decks

Starter decks are generated: `npm run gen:decks` (kana tables + programmatic
staff SVGs) — output is committed and golden-tested byte-for-byte. Kana audio
is a one-time authoring step (`npx tsx scripts/gen-kana-audio.ts`, needs
open-jtalk + ffmpeg); the resulting `.ogg`s are committed so builds and CI
never need a TTS. Deck format details: DESIGN.md and
`.claude/skills/deckpack/SKILL.md`.
