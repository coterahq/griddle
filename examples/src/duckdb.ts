import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { createDuckDbWasmQuery } from '../../src/duckdb';
import type { DuckDbQuery } from '../../src/duckdb';

/**
 * Booting duckdb-wasm, which the library deliberately does not do for you.
 *
 * This file is why: every decision here is a property of *this deployment*,
 * and a library that made them would be wrong for somebody on every one.
 *
 * ## No CDN
 *
 * `getJsDelivrBundles()` is the documented quick start and it fetches the
 * wasm and the worker from jsdelivr at page load. That would make the demo
 * depend on a third-party origin at runtime, break under any CSP worth
 * having, and stop working offline. The `?url` imports below let Vite emit
 * both into `dist/assets` and hash them, so the whole thing is served from
 * one origin.
 *
 * ## No threaded bundle
 *
 * The `coi` bundle needs `SharedArrayBuffer`, which needs
 * `crossOriginIsolated`, which needs COOP/COEP response headers. GitHub Pages
 * cannot set headers. Leaving `coi` out of the map entirely means
 * `selectBundle` can only choose between `mvp` and `eh`, so the fallback is
 * structural rather than something to hope for at runtime.
 */
const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
};

let started: Promise<duckdb.AsyncDuckDB> | null = null;

const boot = async (): Promise<duckdb.AsyncDuckDB> => {
  const bundle = await duckdb.selectBundle(BUNDLES);
  if (bundle.mainWorker === null || bundle.mainWorker === undefined) {
    throw new Error('duckdb-wasm: no worker in the selected bundle');
  }

  /*
   * The trap, and it is bigger than it first looks.
   *
   * The worker is a `blob:` URL wrapping `importScripts(…)`, and *everything*
   * the worker then fetches resolves against the blob rather than against the
   * document. Vite's `?url` imports are relative, so both the worker script
   * and the wasm module have to be made absolute here — the wasm is the one
   * that is easy to miss, because it is passed to `instantiate` on this side
   * and fetched on the other.
   *
   * Getting either wrong hangs on "Booting DuckDB…" with a 404 in a worker
   * console nobody is looking at. Under a dev server rooted at `/` the
   * relative URLs happen to work, so this fails only in production — which is
   * exactly how it was found here.
   */
  const absolute = (url: string): string =>
    new URL(url, window.location.href).href;

  const workerUrl = URL.createObjectURL(
    new Blob(
      [`importScripts(${JSON.stringify(absolute(bundle.mainWorker))});`],
      {
        type: 'text/javascript',
      }
    )
  );

  const worker = new Worker(workerUrl);
  const database = new duckdb.AsyncDuckDB(
    new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING),
    worker
  );
  await database.instantiate(
    absolute(bundle.mainModule),
    bundle.pthreadWorker === null || bundle.pthreadWorker === undefined
      ? bundle.pthreadWorker
      : absolute(bundle.pthreadWorker)
  );
  URL.revokeObjectURL(workerUrl);
  return database;
};

/** One database for the whole page; booting it twice costs seconds. */
export const duckDb = (): Promise<duckdb.AsyncDuckDB> => {
  started ??= boot();
  return started;
};

export const duckDbQuery = async (): Promise<DuckDbQuery> =>
  createDuckDbWasmQuery(await duckDb());

/** Whether the threaded bundle could ever have been used. Shown in the UI. */
export const isolationState = (): string =>
  window.crossOriginIsolated
    ? 'crossOriginIsolated — threads available'
    : 'not crossOriginIsolated — non-threaded bundle (expected on Pages)';
