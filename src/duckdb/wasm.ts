import type { DuckDbQuery, DuckDbQueryResult } from './types';

/**
 * The shape of duckdb-wasm this adapter touches, declared structurally.
 *
 * `@duckdb/duckdb-wasm` is an optional peer, so importing its types
 * unconditionally would make the whole package fail to typecheck for a
 * consumer who never installs it.
 */
type AsyncDuckDBLike = {
  connect(): Promise<{
    query(sql: string): Promise<DuckDbQueryResult>;
    close?(): Promise<void>;
  }>;
};

export type CreateDuckDbWasmQueryOptions = {
  /**
   * Open one connection and keep it, rather than one per statement.
   *
   * On by default because it is faster and because a temp table or a `SET`
   * survives between calls. Turn it off when the database is shared with
   * something else that assumes it owns the connection — and note that with it
   * off, connection-scoped state is invisible to the next query, which is the
   * reason layers are told to keep nothing there.
   */
  reuseConnection?: boolean;
};

/**
 * Wraps a duckdb-wasm database as a {@link DuckDbQuery}.
 *
 * The convenience for the common case, and deliberately the only thing this
 * library does with duckdb-wasm. Instantiating the database — picking a
 * bundle, hosting the worker, deciding whether `SharedArrayBuffer` is
 * available — stays the host's, because those answers differ per deployment
 * and are wrong to guess.
 *
 * ```ts
 * const query = createDuckDbWasmQuery(db);
 * const source = createDuckDbDataSource({ query, from, columns });
 * ```
 */
export function createDuckDbWasmQuery(
  db: AsyncDuckDBLike,
  { reuseConnection = true }: CreateDuckDbWasmQueryOptions = {}
): DuckDbQuery {
  // Awaited lazily and kept, so `connect()` happens once on the first query
  // rather than at construction — which is usually inside a `useMemo`.
  let shared: Promise<Awaited<ReturnType<AsyncDuckDBLike['connect']>>> | null =
    null;

  return async (sql: string): Promise<DuckDbQueryResult> => {
    if (reuseConnection) {
      shared ??= db.connect();
      const connection = await shared;
      return connection.query(sql);
    }
    const connection = await db.connect();
    try {
      return await connection.query(sql);
    } finally {
      await connection.close?.();
    }
  };
}
