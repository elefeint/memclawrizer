import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'],
    environment: 'node',
    // The DuckDB native addon is not reliable under worker_threads; forks are.
    pool: 'forks',
    // Real-DB imports of the audio-bearing kana decks (~1 MB, 104 BLOBs)
    // legitimately exceed the 5 s default.
    testTimeout: 20000,
  },
});
