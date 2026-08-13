import { describe, expect, it } from 'vitest';
import {
  formatDataGridDate,
  formatDataGridValue,
  toDataGridDate,
} from '../format';
import { DEFAULT_DATA_GRID_DISPLAY_OPTIONS } from '../types';

// DuckDB timestamps arrive through Arrow as epoch milliseconds, so a date
// column's raw value is a number and must not render as one.
const EPOCH_MS = 1715715641000; // 2024-05-14T19:40:41Z

describe('data grid date formatting', () => {
  it('formats date columns from epoch millis, ISO strings and Date objects', () => {
    expect({
      millisAsDate: formatDataGridDate(EPOCH_MS, 'date'),
      millisAsTimestamp: formatDataGridDate(EPOCH_MS, 'timestamp'),
      iso: formatDataGridDate('2024-05-14T19:40:41Z', 'timestamp'),
      dateObject: formatDataGridDate(new Date(EPOCH_MS), 'date'),
      garbage: formatDataGridDate('not a date', 'date'),
      missing: toDataGridDate(null),
    }).toMatchObject({
      millisAsDate: '2024-05-14',
      millisAsTimestamp: '2024-05-14 19:40:41',
      iso: '2024-05-14 19:40:41',
      dateObject: '2024-05-14',
      garbage: null,
      missing: null,
    });
  });

  it('routes cell values through date formatting only for date columns', () => {
    expect({
      timestampColumn: formatDataGridValue(
        EPOCH_MS,
        DEFAULT_DATA_GRID_DISPLAY_OPTIONS,
        'timestamp'
      ),
      numberColumn: formatDataGridValue(
        EPOCH_MS,
        DEFAULT_DATA_GRID_DISPLAY_OPTIONS,
        'number'
      ),
      untypedColumn: formatDataGridValue(
        EPOCH_MS,
        DEFAULT_DATA_GRID_DISPLAY_OPTIONS
      ),
      // An unparseable value falls back rather than rendering blank.
      unparseableDate: formatDataGridValue(
        'n/a',
        DEFAULT_DATA_GRID_DISPLAY_OPTIONS,
        'date'
      ),
    }).toMatchObject({
      timestampColumn: '2024-05-14 19:40:41',
      numberColumn: '1715715641000',
      untypedColumn: '1715715641000',
      unparseableDate: 'n/a',
    });
  });
});
