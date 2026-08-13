import { describe, expect, it } from 'vitest';
import type { DataGridColumn } from '../../core/types';
import { createMemoryDataSource } from '../source';

/**
 * The in-memory source is the reference implementation, so these specs are
 * really specs on *what a filter means* — `/duckdb` and `/http` are checked
 * against the behaviour pinned here.
 */

type Row = {
  id: number;
  name: string;
  region: string;
  total: number | null;
  placedAt: string | null;
  active: boolean;
};

const ROWS: Row[] = [
  {
    id: 1,
    name: 'Alpha',
    region: 'NA',
    total: 100,
    placedAt: '2025-01-05',
    active: true,
  },
  {
    id: 2,
    name: 'beta',
    region: 'EMEA',
    total: 20,
    placedAt: '2025-03-01',
    active: false,
  },
  {
    id: 3,
    name: 'Gamma',
    region: 'NA',
    total: null,
    placedAt: null,
    active: true,
  },
  {
    id: 4,
    name: 'Delta',
    region: 'APAC',
    total: 9,
    placedAt: '2025-02-11',
    active: false,
  },
  {
    id: 5,
    name: 'Item 10',
    region: 'NA',
    total: 3000,
    placedAt: '2025-04-20',
    active: true,
  },
  {
    id: 6,
    name: 'Item 9',
    region: 'EMEA',
    total: 250,
    placedAt: '2025-01-30',
    active: true,
  },
];

const COLUMNS: DataGridColumn<Row>[] = [
  { id: 'id', header: 'Id', type: 'number', getValue: (row) => row.id },
  { id: 'name', header: 'Name', type: 'text', getValue: (row) => row.name },
  {
    id: 'region',
    header: 'Region',
    type: 'category',
    getValue: (row) => row.region,
  },
  {
    id: 'total',
    header: 'Total',
    type: 'number',
    getValue: (row) => row.total,
  },
  {
    id: 'placedAt',
    header: 'Placed',
    type: 'date',
    getValue: (row) => row.placedAt,
  },
  {
    id: 'active',
    header: 'Active',
    type: 'boolean',
    getValue: (row) => row.active,
  },
];

const source = createMemoryDataSource<Row>({ rows: ROWS, columns: COLUMNS });

const page = async (
  overrides: Partial<Parameters<typeof source.loadPage>[0]> = {}
) =>
  source.loadPage({
    offset: 0,
    limit: 100,
    sorts: [],
    filters: [],
    ...overrides,
  });

const ids = async (
  overrides: Partial<Parameters<typeof source.loadPage>[0]> = {}
): Promise<number[]> => (await page(overrides)).rows.map((row) => row.id);

describe('memory source — filter shapes', () => {
  // The plain header text box produces a bare scalar, and it means substring,
  // not equality. That mirrors DuckDB's `CAST(col AS VARCHAR) ILIKE '%x%'`.
  it('treats a bare scalar as a case-insensitive substring match', async () => {
    await expect(
      ids({ filters: [{ columnId: 'name', value: 'a' }] })
    ).resolves.toMatchObject([1, 2, 3, 4]);
  });

  it('substring-matches a number column by its digits', async () => {
    await expect(
      ids({ filters: [{ columnId: 'total', value: '00' }] })
    ).resolves.toMatchObject([1, 5]);
  });

  it('treats an empty string as no filter at all', async () => {
    await expect(
      ids({ filters: [{ columnId: 'name', value: '' }] })
    ).resolves.toHaveLength(6);
  });

  it('matches an `in` filter by value', async () => {
    await expect(
      ids({
        filters: [
          { columnId: 'region', value: { kind: 'in', values: ['NA', 'APAC'] } },
        ],
      })
    ).resolves.toMatchObject([1, 3, 4, 5]);
  });

  // A null bucket in the stats chart is a real, clickable mark, so an explicit
  // null in the list has to select missing values rather than be skipped.
  it('selects missing values from an explicit null in an `in` list', async () => {
    await expect(
      ids({
        filters: [{ columnId: 'total', value: { kind: 'in', values: [null] } }],
      })
    ).resolves.toMatchObject([3]);
  });

  // Half-open, so two adjacent histogram bars never both claim a value sitting
  // exactly on their shared boundary.
  it('excludes the upper bound of a `between` filter by default', async () => {
    await expect(
      ids({
        filters: [
          { columnId: 'total', value: { kind: 'between', min: 9, max: 250 } },
        ],
      })
    ).resolves.toMatchObject([1, 2, 4]);
  });

  it('includes the upper bound when inclusiveMax is set', async () => {
    await expect(
      ids({
        filters: [
          {
            columnId: 'total',
            value: { kind: 'between', min: 9, max: 250, inclusiveMax: true },
          },
        ],
      })
    ).resolves.toMatchObject([1, 2, 4, 6]);
  });

  it('never matches a null against a range', async () => {
    await expect(
      ids({
        filters: [
          {
            columnId: 'total',
            value: { kind: 'between', min: -1e9, max: 1e9, inclusiveMax: true },
          },
        ],
      })
    ).resolves.not.toContain(3);
  });

  describe('every comparison', () => {
    const cases: [string, unknown, number[]][] = [
      [
        'contains',
        { kind: 'compare', comparison: 'contains', value: 'ta' },
        [2, 4],
      ],
      [
        'equals',
        { kind: 'compare', comparison: 'equals', value: 'Alpha' },
        [1],
      ],
      [
        'notEquals',
        { kind: 'compare', comparison: 'notEquals', value: 'Alpha' },
        [2, 3, 4, 5, 6],
      ],
      ['isNull', { kind: 'compare', comparison: 'isNull', value: null }, []],
      [
        'isNotNull',
        { kind: 'compare', comparison: 'isNotNull', value: null },
        [1, 2, 3, 4, 5, 6],
      ],
    ];

    it.each(cases)(
      'applies %s on a text column',
      async (_label, value, expected) => {
        await expect(
          ids({ filters: [{ columnId: 'name', value }] })
        ).resolves.toMatchObject(expected);
      }
    );

    const numeric: [string, unknown, number[]][] = [
      [
        'greaterThan',
        { kind: 'compare', comparison: 'greaterThan', value: 100 },
        [5, 6],
      ],
      [
        'greaterThanOrEqual',
        { kind: 'compare', comparison: 'greaterThanOrEqual', value: 100 },
        [1, 5, 6],
      ],
      [
        'lessThan',
        { kind: 'compare', comparison: 'lessThan', value: 100 },
        [2, 4],
      ],
      [
        'lessThanOrEqual',
        { kind: 'compare', comparison: 'lessThanOrEqual', value: 100 },
        [1, 2, 4],
      ],
    ];

    it.each(numeric)(
      'applies %s on a number column',
      async (_label, value, expected) => {
        await expect(
          ids({ filters: [{ columnId: 'total', value }] })
        ).resolves.toMatchObject(expected);
      }
    );

    // The operand arrives as a string from a text input even on a number
    // column. Coercing by the column's declared type is what stops `'9' > '100'`
    // — true as strings — from deciding the answer.
    it('coerces a string operand by the column type', async () => {
      await expect(
        ids({
          filters: [
            {
              columnId: 'total',
              value: {
                kind: 'compare',
                comparison: 'greaterThan',
                value: '100',
              },
            },
          ],
        })
      ).resolves.toMatchObject([5, 6]);
    });

    it('compares dates chronologically rather than lexically', async () => {
      await expect(
        ids({
          filters: [
            {
              columnId: 'placedAt',
              value: {
                kind: 'compare',
                comparison: 'greaterThanOrEqual',
                value: '2025-03-01',
              },
            },
          ],
        })
      ).resolves.toMatchObject([2, 5]);
    });
  });

  it('ands multiple column filters together', async () => {
    await expect(
      ids({
        filters: [
          { columnId: 'region', value: { kind: 'in', values: ['NA'] } },
          {
            columnId: 'active',
            value: { kind: 'compare', comparison: 'equals', value: true },
          },
        ],
      })
    ).resolves.toMatchObject([1, 3, 5]);
  });
});

describe('memory source — ordering', () => {
  it('sorts nulls last in both directions', async () => {
    await expect(
      ids({ sorts: [{ columnId: 'total', direction: 'asc' }] })
    ).resolves.toMatchObject([4, 2, 1, 6, 5, 3]);
    await expect(
      ids({ sorts: [{ columnId: 'total', direction: 'desc' }] })
    ).resolves.toMatchObject([5, 6, 1, 2, 4, 3]);
  });

  // `Intl.Collator` with numeric collation, so 'Item 9' precedes 'Item 10'
  // rather than following it the way a UTF-16 comparison would put it.
  it('orders text naturally rather than by code unit', async () => {
    const names = (
      await page({ sorts: [{ columnId: 'name', direction: 'asc' }] })
    ).rows.map((row) => row.name);
    expect(names.indexOf('Item 9')).toBeLessThan(names.indexOf('Item 10'));
  });

  it('is case-insensitive on text', async () => {
    await expect(
      ids({ sorts: [{ columnId: 'name', direction: 'asc' }] })
    ).resolves.toMatchObject([1, 2, 4, 3, 6, 5]);
  });

  // Stability is what makes "sort by region, then total" behave: within a
  // region the earlier key's order survives.
  it('applies sort keys in order and is stable', async () => {
    await expect(
      ids({
        sorts: [
          { columnId: 'region', direction: 'asc' },
          { columnId: 'total', direction: 'desc' },
        ],
      })
    ).resolves.toMatchObject([4, 6, 2, 5, 1, 3]);
  });
});

describe('memory source — paging and totals', () => {
  it('reports the filtered total, not the array length', async () => {
    const result = await page({
      limit: 2,
      filters: [{ columnId: 'region', value: { kind: 'in', values: ['NA'] } }],
    });
    expect({ rows: result.rows.length, total: result.total }).toMatchObject({
      rows: 2,
      total: 3,
    });
  });

  it('pages from an offset', async () => {
    await expect(
      ids({
        offset: 4,
        limit: 2,
        sorts: [{ columnId: 'id', direction: 'asc' }],
      })
    ).resolves.toMatchObject([5, 6]);
  });

  it('reads a rows function on every query, so live data is not snapshotted', async () => {
    let current: Row[] = [ROWS[0] as Row];
    const live = createMemoryDataSource<Row>({
      rows: () => current,
      columns: COLUMNS,
    });
    const first = await live.loadPage({
      offset: 0,
      limit: 10,
      sorts: [],
      filters: [],
    });
    current = ROWS;
    const second = await live.loadPage({
      offset: 0,
      limit: 10,
      sorts: [],
      filters: [],
    });
    expect({
      first: first.rows.length,
      second: second.rows.length,
    }).toMatchObject({
      first: 1,
      second: 6,
    });
  });

  it('rejects with an AbortError when the query is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      source.loadPage({
        offset: 0,
        limit: 10,
        sorts: [],
        filters: [],
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('memory source — column stats', () => {
  it('summarises a category column as buckets with click-through filters', async () => {
    const stats = await source.loadColumnStats?.({
      columnId: 'region',
      filters: [],
    });
    // Ordered by count, so the chart's first bar is the most common value.
    expect(stats).toMatchObject({ kind: 'categorical', uniqueCount: 3 });
    expect(stats?.kind === 'categorical' ? stats.buckets : []).toMatchObject([
      { label: 'NA', count: 3, filter: { kind: 'in', values: ['NA'] } },
      { label: 'EMEA', count: 2 },
      { label: 'APAC', count: 1 },
    ]);
  });

  it('summarises a number column as a distribution', async () => {
    const stats = await source.loadColumnStats?.({
      columnId: 'total',
      filters: [],
    });
    expect(stats).toMatchObject({
      kind: 'numericDistribution',
      min: 9,
      max: 3000,
      nullCount: 1,
    });
  });

  it('summarises a date column as a temporal distribution', async () => {
    const stats = await source.loadColumnStats?.({
      columnId: 'placedAt',
      filters: [],
    });
    expect(stats).toMatchObject({
      kind: 'temporalDistribution',
      min: '2025-01-05T00:00:00.000Z',
      max: '2025-04-20T00:00:00.000Z',
      nullCount: 1,
    });
  });

  // Stats describe what the grid is showing. A histogram computed over the
  // whole table would disagree with the rows underneath it.
  it('computes stats over the filtered population', async () => {
    const stats = await source.loadColumnStats?.({
      columnId: 'region',
      filters: [
        {
          columnId: 'active',
          value: { kind: 'compare', comparison: 'equals', value: true },
        },
      ],
    });
    expect(stats).toMatchObject({ kind: 'categorical', uniqueCount: 2 });
  });

  it('reports an error for an unknown column rather than throwing', async () => {
    await expect(
      source.loadColumnStats?.({ columnId: 'nope', filters: [] })
    ).resolves.toMatchObject({ kind: 'error' });
  });
});
