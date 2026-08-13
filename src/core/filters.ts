import type {
  DataGridComparisonFilterValue,
  DataGridFilterComparison,
  DataGridFilterScalar,
  DataGridStructuredFilterValue,
} from './types';

const isScalar = (value: unknown): value is DataGridFilterScalar =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

const COMPARISONS: DataGridFilterComparison[] = [
  'contains',
  'equals',
  'notEquals',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'isNull',
  'isNotNull',
];

/** Comparisons that read no operand, so a form can hide the value input. */
export const comparisonTakesValue = (
  comparison: DataGridFilterComparison
): boolean => comparison !== 'isNull' && comparison !== 'isNotNull';

export const isComparisonFilterValue = (
  value: unknown
): value is DataGridComparisonFilterValue => {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { kind?: unknown; comparison?: unknown };
  return (
    candidate.kind === 'compare' &&
    COMPARISONS.some((entry) => entry === candidate.comparison) &&
    isScalar((value as { value?: unknown }).value)
  );
};

const COMPARISON_LABELS: Record<DataGridFilterComparison, string> = {
  contains: 'contains',
  equals: '=',
  notEquals: '≠',
  greaterThan: '>',
  greaterThanOrEqual: '≥',
  lessThan: '<',
  lessThanOrEqual: '≤',
  isNull: 'is empty',
  isNotNull: 'is not empty',
};

export const isStructuredFilterValue = (
  value: unknown
): value is DataGridStructuredFilterValue => {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { kind?: unknown };
  if (candidate.kind === 'in') {
    const values = (value as { values?: unknown }).values;
    return Array.isArray(values) && values.every(isScalar);
  }
  if (candidate.kind === 'between') {
    const { min, max } = value as { min?: unknown; max?: unknown };
    return (
      (typeof min === 'number' || typeof min === 'string') &&
      (typeof max === 'number' || typeof max === 'string')
    );
  }
  return false;
};

const sameScalar = (
  left: DataGridFilterScalar,
  right: DataGridFilterScalar
): boolean => left === right;

/**
 * Toggling an `in` mark adds the value when absent and removes it when
 * present. Removing the last value clears the filter entirely.
 */
export const toggleInFilterValue = (
  current: unknown,
  next: DataGridStructuredFilterValue & { kind: 'in' }
): DataGridStructuredFilterValue | null => {
  const currentValues =
    isStructuredFilterValue(current) && current.kind === 'in'
      ? current.values
      : [];
  const nextValues = [...currentValues];
  for (const value of next.values) {
    const index = nextValues.findIndex((candidate) =>
      sameScalar(candidate, value)
    );
    if (index === -1) {
      nextValues.push(value);
    } else {
      nextValues.splice(index, 1);
    }
  }
  return nextValues.length === 0 ? null : { kind: 'in', values: nextValues };
};

const compare = (left: number | string, right: number | string): number => {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return String(left) < String(right)
    ? -1
    : String(left) > String(right)
    ? 1
    : 0;
};

/**
 * Selecting a second bucket widens the active range to the union of both,
 * which is what "drag across a few histogram bars" should feel like.
 * Re-selecting the exact active range clears it.
 */
export const toggleBetweenFilterValue = (
  current: unknown,
  next: DataGridStructuredFilterValue & { kind: 'between' }
): DataGridStructuredFilterValue | null => {
  if (!isStructuredFilterValue(current) || current.kind !== 'between') {
    return next;
  }
  if (
    compare(current.min, next.min) === 0 &&
    compare(current.max, next.max) === 0
  ) {
    return null;
  }
  return {
    kind: 'between',
    min: compare(current.min, next.min) <= 0 ? current.min : next.min,
    max: compare(current.max, next.max) >= 0 ? current.max : next.max,
    inclusiveMax: current.inclusiveMax === true || next.inclusiveMax === true,
  };
};

export const toggleStructuredFilterValue = (
  current: unknown,
  next: DataGridStructuredFilterValue
): DataGridStructuredFilterValue | null =>
  next.kind === 'in'
    ? toggleInFilterValue(current, next)
    : toggleBetweenFilterValue(current, next);

/** True when the active filter already covers the given stat mark. */
export const filterSelectsValue = (
  current: unknown,
  candidate: DataGridStructuredFilterValue | undefined
): boolean => {
  if (candidate === undefined || !isStructuredFilterValue(current)) {
    return false;
  }
  if (current.kind === 'in' && candidate.kind === 'in') {
    return candidate.values.every((value) =>
      current.values.some((active) => sameScalar(active, value))
    );
  }
  if (current.kind === 'between' && candidate.kind === 'between') {
    return (
      compare(current.min, candidate.min) <= 0 &&
      compare(current.max, candidate.max) >= 0
    );
  }
  return false;
};

export const describeFilterValue = (value: unknown): string => {
  if (isComparisonFilterValue(value)) {
    const label = COMPARISON_LABELS[value.comparison];
    return comparisonTakesValue(value.comparison)
      ? `${label} ${String(value.value)}`
      : label;
  }
  if (isStructuredFilterValue(value)) {
    if (value.kind === 'in') {
      return value.values
        .map((entry) => (entry === null ? 'null' : String(entry)))
        .join(', ');
    }
    return `${String(value.min)} – ${String(value.max)}`;
  }
  return value === null || value === undefined ? '' : String(value);
};
