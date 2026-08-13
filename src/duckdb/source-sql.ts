import { duckDbIdentifier } from './sql';

/** The name a custom statement selects from. */
export const DUCKDB_CUSTOM_QUERY_ALIAS = 'source';

export class DuckDbQueryError extends Error {}

/**
 * Wraps a base source as a CTE so an ad-hoc statement can select from it.
 * Returns null when the statement is empty.
 *
 * The `SELECT`/`WITH` guard is not a security boundary — the caller owns the
 * database and can run whatever it likes through `query` directly. It is there
 * so a text box wired to this cannot silently `DROP TABLE` the thing the grid
 * is reading, which is a different and much more likely accident.
 */
const resolveCustomSelectSql = (
  customSelectSql: string,
  baseSql: string,
  alias: string
): { sql: string } | { error: string } | null => {
  const trimmed = customSelectSql.trim().replace(/;+\s*$/, '');
  if (trimmed === '') {
    return null;
  }
  const upper = trimmed.toUpperCase();
  const cte = `${duckDbIdentifier(alias)} AS (SELECT * FROM ${baseSql})`;
  if (upper.startsWith('WITH ')) {
    return { sql: `WITH ${cte}, ${trimmed.slice('WITH '.length)}` };
  }
  if (upper.startsWith('SELECT')) {
    return { sql: `WITH ${cte} ${trimmed}` };
  }
  return { error: 'Only SELECT statements are supported' };
};

export type BuildSourceSqlInput = {
  /** Table name, `read_parquet(…)` call, or any expression valid after FROM. */
  readonly from: string;
  /** An ad-hoc read-only statement selecting from {@link DUCKDB_CUSTOM_QUERY_ALIAS}. */
  readonly customSelectSql?: string;
  /** Usually `SqlLayerStack.wrapSource`. */
  readonly wrapSource?: (baseSql: string) => string;
  readonly alias?: string;
};

/**
 * The subquery every read — rows, counts, stats — selects from.
 *
 * Layer wrapping is `SqlLayerStack.wrapSource`'s job rather than this
 * function's, and it *wraps* rather than appends: that makes each layer's
 * values columns of a subquery, which is what lets the untouched
 * `WHERE`/`ORDER BY` built from the grid's own sorts and filters address them.
 * A `WHERE` cannot reference a `SELECT` alias; it can reference a subquery's
 * column. That one property is what makes sorting by a joined column work
 * across sources instead of only appearing to.
 */
export const buildSourceSql = ({
  from,
  customSelectSql = '',
  wrapSource = (baseSql) => baseSql,
  alias = DUCKDB_CUSTOM_QUERY_ALIAS,
}: BuildSourceSqlInput): string => {
  const base = `(SELECT * FROM ${from})`;
  const resolved = resolveCustomSelectSql(customSelectSql, base, alias);
  if (resolved !== null && 'error' in resolved) {
    throw new DuckDbQueryError(resolved.error);
  }
  return wrapSource(resolved === null ? base : `(${resolved.sql})`);
};
