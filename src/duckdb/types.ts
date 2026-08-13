/**
 * The whole of this adapter's dependency on DuckDB.
 *
 * An `apache-arrow` `Table` satisfies this structurally, and so does a
 * `@duckdb/node-api` reader wrapped in three lines. That is the point: taking
 * a 600 kB peer dependency for one type would be a self-inflicted wound, and
 * it would tie the library to one DuckDB distribution when the interesting
 * ones are wasm in a browser, native in Node, and a remote HTTP endpoint that
 * happens to speak the same SQL.
 */
export type DuckDbQueryResult = {
  toArray(): unknown[];
};

/**
 * Runs one statement.
 *
 * **The library does not own DuckDB setup.** Bundle selection, worker hosting,
 * `SharedArrayBuffer` availability and CSP are the host's business and they
 * differ per deployment — GitHub Pages cannot set COOP/COEP, so the same app
 * needs a non-threaded bundle there and a threaded one behind its own server.
 * A library that instantiated the database would have to guess, and would be
 * wrong for somebody on every guess.
 *
 * So: hand over a function. `createDuckDbWasmQuery` is the three-line
 * convenience for the common case.
 */
export type DuckDbQuery = (sql: string) => Promise<DuckDbQueryResult>;
