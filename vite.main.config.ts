import { defineConfig } from 'vite';

// The main process is emitted as CommonJS by the Forge Vite plugin.
// @duckdb/node-api must stay external: it loads a native .node addon via
// require() at runtime and cannot be bundled. It ships as a production
// dependency inside node_modules (natives unpacked by AutoUnpackNativesPlugin).
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['@duckdb/node-api', '@duckdb/node-bindings'],
    },
  },
});
