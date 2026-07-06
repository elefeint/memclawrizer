/**
 * Playwright config for the Electron smoke test ONLY (test/e2e). Unit and DB
 * tests live under Vitest (`npm test`); this suite is the packaging-time gate
 * (`npm run test:e2e`) and expects `npm run package` to have produced
 * out/memclawrizer-linux-x64 first.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // One packaged-app instance at a time; DuckDB is single-writer anyway.
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
});
