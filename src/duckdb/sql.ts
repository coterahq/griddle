/**
 * Literal and identifier quoting for hand-built DuckDB SQL.
 *
 * `CoteraDuckDB.rawQuery` takes a string, so everything the browser generates —
 * the preview table's operation replay, the automations join, the header stat
 * aggregates — interpolates values rather than binding them. These three are
 * the only sanctioned way to do that, and they lived in duplicate in
 * `dataset.page.tsx` and `dataset-automations.tsx` before this file existed.
 */

/** Single-quoted string literal, with embedded quotes doubled. */
export const duckDbStringLiteral = (value: string): string =>
  `'${value.replaceAll("'", "''")}'`;

/** Double-quoted identifier, with embedded quotes doubled. */
export const duckDbIdentifier = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;

/**
 * A grid cell value as a literal.
 *
 * Non-finite numbers become `NULL` rather than the string `Infinity`, which
 * DuckDB would reject in a numeric column.
 */
export const duckDbValueLiteral = (
  value: string | number | boolean | null
): string => {
  if (value === null) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  return duckDbStringLiteral(value);
};
