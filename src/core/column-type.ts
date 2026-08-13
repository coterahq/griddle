import type { IconName } from '@cotera/client/app/components/ui/icon';
import type { DataGridColumnDataType } from './types';

const ICONS: Record<DataGridColumnDataType, IconName> = {
  text: 'file-text',
  number: 'list-ordered',
  boolean: 'list-todo',
  date: 'calendar-days',
  timestamp: 'clock-reset',
  category: 'list-bullet',
  unknown: 'table-cells',
};

export const dataGridColumnTypeIcon = (
  type: DataGridColumnDataType | undefined
): IconName => ICONS[type ?? 'unknown'];

/**
 * Best-effort mapping from a warehouse/duckdb type name onto the grid's
 * logical column types. Callers with richer metadata should set
 * `column.type` explicitly instead of relying on this.
 */
export const dataGridColumnTypeFromSqlType = (
  sqlType: string | null | undefined
): DataGridColumnDataType => {
  if (sqlType === null || sqlType === undefined) {
    return 'unknown';
  }
  const normalized = sqlType.toUpperCase();
  if (normalized.includes('BOOL')) {
    return 'boolean';
  }
  if (normalized.includes('TIMESTAMP') || normalized.includes('DATETIME')) {
    return 'timestamp';
  }
  if (normalized.includes('DATE') || normalized.includes('TIME')) {
    return 'date';
  }
  if (
    normalized.includes('INT') ||
    normalized.includes('DOUBLE') ||
    normalized.includes('FLOAT') ||
    normalized.includes('DECIMAL') ||
    normalized.includes('NUMERIC') ||
    normalized.includes('REAL') ||
    normalized.includes('HUGEINT')
  ) {
    return 'number';
  }
  if (
    normalized.includes('VARCHAR') ||
    normalized.includes('CHAR') ||
    normalized.includes('TEXT') ||
    normalized.includes('STRING')
  ) {
    return 'text';
  }
  return 'unknown';
};
