import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDbQuery } from '../types';

/**
 * A real DuckDB, for the specs that need one.
 *
 * Node's native binding rather than duckdb-wasm: the wasm build needs a
 * worker and a `SharedArrayBuffer` story that a test runner has no business
 * providing, and the SQL is identical. This is a devDependency only — the
 * published package depends on neither.
 *
 * It runs on Node rather than Bun deliberately. The binding is native N-API,
 * which is exactly where the two runtimes diverge, and `bun run test` invokes
 * vitest on Node for this among other reasons.
 */
export const createTestDuckDb = async (): Promise<{
  query: DuckDbQuery;
  close: () => void;
}> => {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();

  return {
    query: async (sql: string) => {
      const reader = await connection.runAndReadAll(sql);
      // `getRowObjects()` hands back BigInt for counts and `DuckDBDateValue`
      // for temporal columns, which is precisely the shape `fromArrowValue`
      // exists to normalise — so this stays a thin adapter and the
      // normalisation stays under test.
      return { toArray: () => reader.getRowObjects() };
    },
    close: () => {
      connection.closeSync();
      instance.closeSync();
    },
  };
};
