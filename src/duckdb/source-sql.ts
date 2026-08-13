import { duckDbIdentifier } from '@cotera/client/app/etc/duckdb';

export const DATASET_CUSTOM_QUERY_TABLE = 'dataset';

/** The preview's default source, shown pre-filled in the footer. */
export const DEFAULT_DATASET_QUERY = `SELECT * FROM ${DATASET_CUSTOM_QUERY_TABLE}`;

/**
 * Wraps the current parquet-backed preview table as a CTE named `dataset` so
 * ad-hoc footer queries can select from it. Returns null when the statement is
 * empty or is not a read-only SELECT/WITH.
 */
const resolveCustomSelectSql = (
  customSelectSql: string,
  tableName: string
): { sql: string } | { error: string } | null => {
  const trimmed = customSelectSql.trim().replace(/;+\s*$/, '');
  if (trimmed === '') {
    return null;
  }
  const upper = trimmed.toUpperCase();
  const cte = `${duckDbIdentifier(
    DATASET_CUSTOM_QUERY_TABLE
  )} AS (SELECT * FROM ${duckDbIdentifier(tableName)})`;
  if (upper.startsWith('WITH ')) {
    return { sql: `WITH ${cte}, ${trimmed.slice('WITH '.length)}` };
  }
  if (upper.startsWith('SELECT')) {
    return { sql: `WITH ${cte} ${trimmed}` };
  }
  return { error: 'Only SELECT statements are supported' };
};

/**
 * True when the preview reads the materialized table more or less directly,
 * so its order column is still in the projection.
 *
 * An arbitrary user query may select any shape at all — `SELECT name FROM
 * dataset` drops the order column entirely — so anything beyond the default is
 * left unordered rather than referencing a column that may not be there.
 */
export const carriesPreviewOrder = (customSelectSql: string): boolean => {
  const trimmed = customSelectSql.trim().replace(/;+\s*$/, '');
  return (
    trimmed === '' ||
    trimmed.toUpperCase() === DEFAULT_DATASET_QUERY.toUpperCase()
  );
};

class DatasetPreviewQueryError extends Error {}

/**
 * The subquery every preview read (rows, counts, stats) selects from: either
 * the materialized preview table or the user's ad-hoc statement, with the
 * layer stack's projections wrapped around it.
 *
 * Wrapping is `DuckDbLayerStack.wrapSource`'s job rather than this function's,
 * and it wraps rather than appends: that makes each layer's values columns of a
 * subquery, which is what lets the untouched WHERE/ORDER BY built from the
 * grid's own sorts and filters address them. A WHERE cannot reference a SELECT
 * alias; it can reference a subquery's column.
 */
export const datasetPreviewSourceSql = (
  tableName: string,
  customSelectSql: string,
  wrapSource: (baseSql: string) => string = (baseSql) => baseSql
): string => {
  const resolved = resolveCustomSelectSql(customSelectSql, tableName);
  if (resolved !== null && 'error' in resolved) {
    throw new DatasetPreviewQueryError(resolved.error);
  }
  const base =
    resolved === null
      ? `(SELECT * FROM ${duckDbIdentifier(tableName)})`
      : `(${resolved.sql})`;
  return wrapSource(base);
};
