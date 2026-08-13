import { describe, expect, it } from 'vitest';
import type { DataGridFilter } from '@cotera/client/app/components/ui/data-grid';
import { filterSql } from '../query-sql';

const COLUMNS = [
  { name: 'name', type: 'VARCHAR' },
  { name: 'revenue', type: 'DOUBLE' },
  { name: 'active', type: 'BOOLEAN' },
  { name: 'created_at', type: 'TIMESTAMP' },
];

const sql = (filter: DataGridFilter): string => filterSql([filter], COLUMNS);

describe('filterSql', () => {
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
