import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'],
    environment: 'node',
    // The DuckDB native addon is not reliable under worker_threads; forks are.
    pool: 'forks',
  },
});
