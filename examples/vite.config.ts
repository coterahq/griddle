import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The examples app has its own Vite config, and unlike `vitest.config.ts` it
 * does use `@vitejs/plugin-react` — Vitest resolves a nested copy of Vite, so
 * a plugin built against the top-level one is a structurally different
 * `Plugin` type there. Here there is only one Vite.
 *
 * `base` is relative so the same build serves from the dev server root. The
 * Pages workflow overrides it with `--base=/griddle/`, because a project site
 * is served from `/<repo>/` and Vite bakes that into every asset URL.
 *
 * That base is also why `examples/src/asset.ts` and `examples/src/duckdb.ts`
 * resolve their URLs against `location.href`. Anything handed to a worker or
 * to DuckDB has to be absolute: a `blob:` worker resolves relative URLs
 * against the blob, not the document, so a relative path works locally and
 * 404s only once the site is deployed under a path.
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
