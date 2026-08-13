import { describe, expect, it } from 'vitest';
import type { DataGridFilter } from '../../core/types';
import { buildWhereSql } from '../query-sql';

// The column descriptor changed shape when it was lifted — it was a warehouse
// API's response type, which made the SQL builder unusable against a parquet
// nobody had registered. Every expected string below is byte-for-byte the
// original's, which is what makes this file evidence rather than decoration.
const COLUMNS = [
  { id: 'name', sqlType: 'VARCHAR' },
  { id: 'revenue', sqlType: 'DOUBLE' },
  { id: 'active', sqlType: 'BOOLEAN' },
  { id: 'created_at', sqlType: 'TIMESTAMP' },
];

const sql = (filter: DataGridFilter): string =>
  buildWhereSql([filter], COLUMNS);

describe('buildWhereSql', () => {
  it('keeps bare scalars as substring matches', () => {
    expect(sql({ columnId: 'name', value: 'ac' })).toBe(
      ` WHERE "name"::VARCHAR ILIKE '%ac%'`
    );
  });

  it('compares numbers as numbers', () => {
    expect(
      sql({
        columnId: 'revenue',
        value: { kind: 'compare', comparison: 'greaterThanOrEqual', value: 30 },
      })
    ).toBe(` WHERE "revenue" >= 30`);
  });

  it('drops a numeric comparison whose operand is not a number', () => {
    expect(
      sql({
        columnId: 'revenue',
        value: { kind: 'compare', comparison: 'lessThan', value: 'abc' },
      })
    ).toBe('');
  });

  it('compares booleans as booleans', () => {
    expect(
      sql({
        columnId: 'active',
        value: { kind: 'compare', comparison: 'equals', value: false },
      })
    ).toBe(` WHERE "active" = FALSE`);
  });

  it('casts both sides of a temporal comparison', () => {
    expect(
      sql({
        columnId: 'created_at',
        value: {
          kind: 'compare',
          comparison: 'lessThanOrEqual',
          value: '2026-01-01T00:00',
        },
      })
    ).toBe(
      ` WHERE CAST("created_at" AS TIMESTAMP) <= CAST('2026-01-01T00:00' AS TIMESTAMP)`
    );
  });

  it('compares text as text, and quotes the operand', () => {
    expect(
      sql({
        columnId: 'name',
        value: { kind: 'compare', comparison: 'notEquals', value: "o'brien" },
      })
    ).toBe(` WHERE "name"::VARCHAR <> 'o''brien'`);
  });

  it('reads emptiness without an operand', () => {
    expect(
      sql({
        columnId: 'name',
        value: { kind: 'compare', comparison: 'isNull', value: null },
      })
    ).toBe(` WHERE "name" IS NULL`);
    expect(
      sql({
        columnId: 'name',
        value: { kind: 'compare', comparison: 'isNotNull', value: null },
      })
    ).toBe(` WHERE "name" IS NOT NULL`);
  });

  it('still translates the stat mark filters', () => {
    expect(
      sql({ columnId: 'name', value: { kind: 'in', values: ['a', null] } })
    ).toBe(` WHERE ("name"::VARCHAR IN ('a') OR "name" IS NULL)`);
  });
});
