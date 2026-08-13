import {
  isComparisonFilterValue,
  isStructuredFilterValue,
} from '../core/filters';
import { unreachable } from '../internal/assert';
import type {
  DataGridColumnDataType,
  DataGridFilterComparison,
  DataGridFilterScalar,
} from '../core/types';

/**
 * Filter evaluation for the in-memory source.
 *
 * This file is the written-down definition of what every `DataGridFilterValue`
 * shape *means*, and every other adapter is checked against it. `/duckdb`
 * generates SQL for the same shapes at L5 and is proved row-for-row equal to
 * this over a shared fixture; `/http` serialises them at L6 and the demo
 * server evaluates them with this. So the rules below are not "how the memory
 * adapter happens to work" — they are the contract.
 *
 * The one that matters most: a **bare scalar is a case-insensitive substring
 * match**, not equality. That is what the header's plain text box produces,
 * and it mirrors DuckDB's `CAST(col AS VARCHAR) ILIKE '%x%'` — including
 * matching a number column by typing part of the number. Equality is available
 * as `{kind:'compare', comparison:'equals'}`, which is what the form emits when
 * a user picks it.
 */

/** Nulls sort last by default, and never match a substring or comparison. */
const isMissing = (value: unknown): boolean =>
  value === null || value === undefined;

const asText = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);

/**
 * Comparison operands arrive as strings from a text input even for number and
 * date columns, so both sides are coerced by the column's declared type rather
 * than by what JavaScript happens to think of `'10' > '9'` (which is false).
 */
const coerce = (
  value: unknown,
  type: DataGridColumnDataType | undefined
): number | string | boolean | null => {
  if (isMissing(value)) {
    return null;
  }
  switch (type) {
    case 'number': {
      const numeric = typeof value === 'number' ? value : Number(value);
      return Number.isNaN(numeric) ? asText(value) : numeric;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : asText(value) === 'true';
    case 'date':
    case 'timestamp': {
      const time =
        value instanceof Date ? value.getTime() : Date.parse(asText(value));
      return Number.isNaN(time) ? asText(value) : time;
    }
    case 'text':
    case 'category':
    case 'unknown':
    case undefined:
      return typeof value === 'number' || typeof value === 'boolean'
        ? value
        : asText(value);
    default:
      return unreachable(type);
  }
};

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

/** -1 / 0 / 1, or `null` when the two are not comparable. */
export const compareValues = (
  left: unknown,
  right: unknown,
  type: DataGridColumnDataType | undefined
): number | null => {
  const a = coerce(left, type);
  const b = coerce(right, type);
  if (a === null || b === null) {
    return null;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    const l = a === true ? 1 : 0;
    const r = b === true ? 1 : 0;
    return l === r ? 0 : l < r ? -1 : 1;
  }
  // `Intl.Collator` rather than `<`, so 'Item 10' sorts after 'Item 9' and
  // accents land where a reader expects rather than where UTF-16 puts them.
  return collator.compare(String(a), String(b));
};

const substringMatches = (value: unknown, needle: unknown): boolean => {
  if (isMissing(value)) {
    return false;
  }
  return asText(value).toLowerCase().includes(asText(needle).toLowerCase());
};

const sameScalar = (
  value: unknown,
  candidate: DataGridFilterScalar
): boolean =>
  candidate === null
    ? isMissing(value)
    : // `in` values come from stat buckets, whose labels are strings even when
      // the column is numeric. Compare as text once neither side is null.
      !isMissing(value) && asText(value) === asText(candidate);

const evaluateComparison = (
  value: unknown,
  comparison: DataGridFilterComparison,
  operand: DataGridFilterScalar,
  type: DataGridColumnDataType | undefined
): boolean => {
  switch (comparison) {
    case 'isNull':
      return isMissing(value);
    case 'isNotNull':
      return !isMissing(value);
    case 'contains':
      return substringMatches(value, operand);
    case 'equals':
      return sameScalar(value, operand);
    case 'notEquals':
      return !sameScalar(value, operand);
    case 'greaterThan': {
      const order = compareValues(value, operand, type);
      return order !== null && order > 0;
    }
    case 'greaterThanOrEqual': {
      const order = compareValues(value, operand, type);
      return order !== null && order >= 0;
    }
    case 'lessThan': {
      const order = compareValues(value, operand, type);
      return order !== null && order < 0;
    }
    case 'lessThanOrEqual': {
      const order = compareValues(value, operand, type);
      return order !== null && order <= 0;
    }
    default:
      return unreachable(comparison);
  }
};

/** True when `value` passes `filterValue` for a column of `type`. */
export const matchesFilterValue = (
  value: unknown,
  filterValue: unknown,
  type: DataGridColumnDataType | undefined
): boolean => {
  if (filterValue === undefined || filterValue === null) {
    return true;
  }

  if (isComparisonFilterValue(filterValue)) {
    return evaluateComparison(
      value,
      filterValue.comparison,
      filterValue.value,
      type
    );
  }

  if (isStructuredFilterValue(filterValue)) {
    if (filterValue.kind === 'in') {
      // An explicit `null` in the list is a real choice — the stats chart has
      // a null bucket — so it selects missing values rather than being skipped.
      return filterValue.values.some((candidate) =>
        sameScalar(value, candidate)
      );
    }
    const lower = compareValues(value, filterValue.min, type);
    const upper = compareValues(value, filterValue.max, type);
    if (lower === null || upper === null) {
      return false;
    }
    // Half-open by default so adjacent histogram buckets do not both claim the
    // boundary; the top bucket sets `inclusiveMax` to catch the maximum.
    return (
      lower >= 0 && (filterValue.inclusiveMax === true ? upper <= 0 : upper < 0)
    );
  }

  // A bare scalar from the header's text box: substring, case-insensitive.
  if (filterValue === '') {
    return true;
  }
  return substringMatches(value, filterValue);
};
