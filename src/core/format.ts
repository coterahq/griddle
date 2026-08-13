import type {
  DataGridColumnAlignment,
  DataGridColumnDataType,
  DataGridColumnDisplayOptions,
} from './types';

/**
 * DuckDB timestamps arrive through Arrow as epoch milliseconds, so a date
 * column's raw cell value is a number. Formatting therefore keys off the
 * column's declared type rather than the JS type of the value.
 */
export const toDataGridDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

/**
 * Rendered in UTC so the grid shows the value as stored, matching the header
 * stats (which read their bounds straight out of DuckDB) rather than shifting
 * by the viewer's timezone.
 */
export const formatDataGridDate = (
  value: unknown,
  type: 'date' | 'timestamp'
): string | null => {
  const date = toDataGridDate(value);
  if (date === null) {
    return null;
  }
  const iso = date.toISOString();
  return type === 'date'
    ? iso.slice(0, 10)
    : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
};

export const ALIGNMENT_CLASS: Record<DataGridColumnAlignment, string> = {
  left: 'justify-start text-left',
  center: 'justify-center text-center',
  right: 'justify-end text-right',
};

const numberFormatter = (
  options: DataGridColumnDisplayOptions
): Intl.NumberFormat =>
  new Intl.NumberFormat(undefined, {
    ...(options.decimals === null
      ? {}
      : {
          minimumFractionDigits: options.decimals,
          maximumFractionDigits: options.decimals,
        }),
    ...(options.numberFormat === 'percent'
      ? { style: 'percent' as const }
      : {}),
    ...(options.numberFormat === 'compact'
      ? { notation: 'compact' as const }
      : {}),
  });

const isDefaultNumberPresentation = (
  options: DataGridColumnDisplayOptions
): boolean => options.numberFormat === 'number' && options.decimals === null;

export const formatDataGridNumber = (
  value: number,
  options: DataGridColumnDisplayOptions
): string => {
  if (!Number.isFinite(value) || isDefaultNumberPresentation(options)) {
    // Untouched columns keep the raw value verbatim rather than picking up
    // locale grouping the caller never asked for.
    return String(value);
  }
  return numberFormatter(options).format(value);
};

/**
 * Formats a cell value for display. Only numbers respond to display options;
 * everything else is stringified so the grid stays type-agnostic.
 */
export const formatDataGridValue = (
  value: unknown,
  options: DataGridColumnDisplayOptions,
  type?: DataGridColumnDataType
): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (type === 'date' || type === 'timestamp') {
    const formatted = formatDataGridDate(value, type);
    if (formatted !== null) {
      return formatted;
    }
  }
  if (typeof value === 'number') {
    return formatDataGridNumber(value, options);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
};

/** Share of the cell width an in-cell bar should occupy, 0–1. */
export const inCellBarShare = (
  value: unknown,
  options: DataGridColumnDisplayOptions
): number | null => {
  if (!options.inCellBar || typeof value !== 'number') {
    return null;
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  const max =
    options.barMax ?? (options.numberFormat === 'percent' ? 1 : undefined);
  if (max === undefined || max <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, value / max));
};
