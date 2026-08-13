import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The examples app has its own Vite config, and unlike `vitest.config.ts` it
 * does use `@vitejs/plugin-react` — Vitest resolves a nested copy of Vite, so
 * a plugin built against the top-level one is a structurally different
 * `Plugin` type there. Here there is only one Vite.
 *
 * `base` is relative, which is what lets the same build serve from the dev
 * server root and from a GitHub Pages project subpath without a rebuild. L7
 * pins it to `/data-grid/` if the duckdb-wasm worker needs an absolute prefix
 * — its script URL is a `blob:` wrapping `importScripts`, which resolves
 * against the document rather than the module, and that only 404s in
 * production.
 */
export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
