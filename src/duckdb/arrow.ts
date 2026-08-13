/**
 * Arrow values as plain JS.
 *
 * A query result's `toArray()` hands back Arrow-backed rows whose values are
 * not all JS primitives: `count(*)` is a BIGINT and arrives as a `BigInt`,
 * timestamps arrive as structured values. Everything that reads a query result
 * — the page loader, the header stats, the live cell repaint — has to
 * normalise them the same way, or the same column changes JS type depending on
 * which path last wrote it.
 *
 * A JSON round-trip cannot do this: `JSON.stringify` throws "Do not know how to
 * serialize a BigInt", which is what used to take out both the header stats and
 * the live re-read and made a workflow run appear to change nothing.
 */

/** What a normalised cell can be. Matches the grid's own cell value type. */
export type DuckDbCellValue = string | number | boolean | null;

/**
 * One Arrow value.
 *
 * BIGINT becomes a real number rather than a string, so the grid can sort and
 * format it as the number it is — `dataGridColumnTypeFromSqlType` maps BIGINT
 * to `'number'`, but the formatter branches on `typeof value === 'number'`, so
 * a stringified BIGINT silently loses decimals, percent/compact formatting and
 * in-cell bars. Only a value too large for a safe integer falls back to text,
 * where losing precision would be worse than losing formatting.
 */
export const fromArrowValue = (value: unknown): DuckDbCellValue => {
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : String(value);
  }
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  // Timestamps and anything else structured; readers downstream parse from text.
  return String(value);
};

export const fromArrowRow = (row: unknown): Record<string, DuckDbCellValue> =>
  Object.fromEntries(
    Object.entries(row as Record<string, unknown>).map(([key, value]) => [
      key,
      fromArrowValue(value),
    ])
  );

/**
 * A `count(*)` as a row count.
 *
 * Separate from {@link fromArrowValue} because it is stricter: a negative or
 * fractional value is not a count at all, and the caller renders "N rows
 * loaded" rather than a wrong total when this returns null.
 */
export const parseRowCount = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'bigint') {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
};

/** A numeric field of an aggregate row, or null when it is not one. */
export const readNumber = (
  row: Record<string, unknown> | undefined,
  key: string
): number | null => {
  const value = row?.[key];
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/** A text field of an aggregate row. Absent and SQL NULL both read as null. */
export const readString = (
  row: Record<string, unknown> | undefined,
  key: string
): string | null => {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
};
