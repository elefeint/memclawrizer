# Decision log (lightweight ADRs, newest first)

Convention (adopted from ayamt): record decisions here first, then reflect them
in CLAUDE.md. Statuses: accepted / superseded / proposed.

## ADR-0004 — Tooling deviations from ayamt — accepted (2026-07-05)
ayamt's scaffold pins TypeScript ~4.5.4 (template default, ancient);
memclawrizer uses TS ^5 with `strict: true`. tsconfig uses `module: ESNext`
for editor/vitest accuracy — the *emitted* main and preload bundles are still
CommonJS via the Forge Vite plugin defaults, per ADR-0001.

Packaging the DuckDB native addon needed three coordinated pieces (each
verified by launching the packaged app; missing any one is a runtime crash):
1. `vite.main.config.ts` externalizes `@duckdb/node-api` + `@duckdb/node-bindings`
   (native addons cannot be bundled by Vite/Rollup);
2. a `packageAfterCopy` hook in forge.config.ts copies `node_modules/@duckdb`
   into the app (the Vite plugin packages only the bundled .vite output —
   externalized modules are otherwise silently omitted → "Cannot find module");
3. `packagerConfig.asar.unpack: '**/node_modules/@duckdb/**'` keeps the whole
   scope outside the asar. plugin-auto-unpack-natives was tried and REJECTED:
   its `**/*.node` pattern unpacks duckdb.node but not libduckdb.so, which the
   addon dlopens from its own directory → "cannot open shared object file".

Dev-machine note (not an app decision): Ubuntu 24.04 restricts unprivileged
user namespaces, so Electron's SUID sandbox helper aborts on `npm start` from
a plain checkout. One-time fix (as root): chown root:root + chmod 4755 on
node_modules/electron/dist/chrome-sandbox, or set
ELECTRON_DISABLE_SANDBOX=1 for dev runs only. Packaged deb/rpm installs set
the helper's permissions correctly on their own.

## ADR-0003 — Two-agent build with a frozen contract — accepted (2026-07-05)
Backend and Frontend agents work in parallel git worktrees with exclusive file
ownership (map in CLAUDE.md). `src/shared/**` is the frozen window.api
contract; the renderer talks only to `src/renderer/api.ts`, which falls back to
a deterministic mock (`mock-api.ts`) whenever the real bridge is absent, so the
Frontend never waits for the Backend. Only Backend edits package.json.
Coordination happens in COORDINATION.md; the coordinator session arbitrates
contract changes and drives integration.

## ADR-0002 — Hand-rolled migrations — accepted (2026-07-05)
Adopted from ayamt ADR-0015: single-row `schema_version` table + ordered array
of TS migration functions run in a transaction on open (src/main/db.ts). Newer
app migrates older files; older app refuses newer files; new files run every
migration in order. No down-migrations. The same versioning idea gates
`.deckpack` files via `format_version`.

## ADR-0001 — Stack and module system — accepted (2026-07-05)
Electron Forge (Vite + TypeScript template), TypeScript end-to-end. Main and
preload are emitted as CommonJS (native addon loads via require; robust preload
under sandbox — ayamt ADR-0005 adopted); renderer is ESM via Vite. DuckDB via
official `@duckdb/node-api`, main process only; renderer is UI-only behind
contextBridge (contextIsolation on, nodeIntegration off). Runtime deps are
exactly: @duckdb/node-api, fflate, electron-squirrel-startup. The DB auto-opens
from userData (not a document; unlike ayamt) — content portability is the
.deckpack format. Full app design: DESIGN.md.
