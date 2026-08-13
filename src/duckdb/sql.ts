/**
 * Literal and identifier quoting for hand-built DuckDB SQL.
 *
 * The injected query function takes a string, so everything this adapter
 * generates — the page read, the header stat aggregates, a layer's join —
 * interpolates values rather than binding them. These three are the only
 * sanctioned way to do that.
 *
 * Every value that reaches SQL goes through one of them. A caller building a
 * `project` layer by hand must too: the fragments it returns are concatenated
 * into the query verbatim.
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
