import { describe, expect, it } from 'vitest';
import type { DataGridColumn } from '../../../core/types';
import { createMemoryDataSource } from '../../../memory/source';
import { applyJoin, joinLayer, joinedGridColumns, joinsIn } from '../join';

/**
 * A join is a declaration, and this file is about the half of it that needs no
 * engine.
 *
 * `join-oracle.spec.ts` takes the same layer objects to DuckDB and asserts the
 * two adapters agree row for row. This one pins what the JavaScript side
 * actually does.
 */

type Order = { id: number; user_id: string | null; total: number };

const ORDERS: Order[] = [
  { id: 1, user_id: 'u2', total: 10 },
  { id: 2, user_id: 'u1', total: 30 },
  { id: 3, user_id: 'missing', total: 20 },
  { id: 4, user_id: null, total: 40 },
];

const USERS = [
  { user_id: 'u1', name: 'ada', tier: 'pro' },
  { user_id: 'u2', name: 'grace', tier: 'free' },
];

const COLUMNS: DataGridColumn<Order>[] = [
  { id: 'id', header: 'Id', type: 'number', getValue: (row) => row.id },
  {
    id: 'total',
    header: 'Total',
    type: 'number',
    getValue: (row) => row.total,
  },
];

const userJoin = (kind?: 'LEFT' | 'INNER') =>
  joinLayer<Order>({
    id: 'user',
    from: { kind: 'rows', rows: USERS },
    on: 'user_id',
    columns: ['name', { name: 'tier', as: 'user_tier', type: 'category' }],
    ...(kind === undefined ? {} : { kind }),
  });

const sourceWith = (layers: ReturnType<typeof userJoin>[]) =>
  createMemoryDataSource<Order>({ rows: ORDERS, columns: COLUMNS, layers });

const page = async (
  layers: ReturnType<typeof userJoin>[],
  overrides: Record<string, unknown> = {}
) =>
  sourceWith(layers).loadPage({
    offset: 0,
    limit: 100,
    sorts: [],
    filters: [],
    ...overrides,
  });

describe('applyJoin', () => {
  it('attaches the requested columns, renaming where asked', () => {
    const joined = applyJoin(ORDERS, userJoin().join);

    expect(joined[0]).toMatchObject({
      id: 1,
      name: 'grace',
      user_tier: 'free',
    });
  });

  // LEFT is the default because dropping rows you did not ask to drop is a
  // surprising thing for adding a column to do.
  it('keeps unmatched rows with nulls under a LEFT join', () => {
    const joined = applyJoin(ORDERS, userJoin().join);

    expect(joined).toHaveLength(4);
    expect(joined[2]).toMatchObject({ id: 3, name: null, user_tier: null });
    expect(joined[3]).toMatchObject({ id: 4, name: null });
  });

  it('drops unmatched rows under an INNER join', () => {
    const joined = applyJoin(ORDERS, userJoin('INNER').join);

    expect(joined.map((row) => row.id)).toMatchObject([1, 2]);
  });

  // A JSON payload says `"1"` where a database row says `1`. Comparing keys as
  // text is the same rule the filter evaluator uses for a cell value.
  it('matches keys across number and string representations', () => {
    const joined = applyJoin(
      [{ id: 1, ref: 7 }],
      joinLayer({
        id: 'r',
        from: { kind: 'rows', rows: [{ ref: '7', label: 'seven' }] },
        on: 'ref',
        columns: ['label'],
      }).join
    );

    expect(joined[0]).toMatchObject({ label: 'seven' });
  });

  it('reads a rows function on every call, so live data is not snapshotted', () => {
    let right = [{ user_id: 'u1', name: 'first' }];
    const layer = joinLayer<Order>({
      id: 'user',
      from: { kind: 'rows', rows: () => right },
      on: 'user_id',
      columns: ['name'],
    });

    expect(applyJoin(ORDERS, layer.join)[1]).toMatchObject({ name: 'first' });
    right = [{ user_id: 'u1', name: 'second' }];
    expect(applyJoin(ORDERS, layer.join)[1]).toMatchObject({ name: 'second' });
  });

  // The message has to name the layer and the way out, because the failure is
  // a configuration mistake rather than a runtime condition.
  it('refuses a sql relation with an actionable error', () => {
    expect(() =>
      applyJoin(
        ORDERS,
        joinLayer({ id: 'u', from: 'users', on: 'user_id', columns: ['name'] })
          .join
      )
    ).toThrow(/joinLayer\("u"\).*DuckDB adapter/s);
  });
});

describe('joined columns are ordinary columns', () => {
  it('exposes them as sortable, filterable grid columns', () => {
    const columns = joinedGridColumns([userJoin()]);

    expect(columns).toMatchObject([
      { id: 'name', type: 'unknown' },
      { id: 'user_tier', type: 'category' },
    ]);
    // Not marked unsortable the way an enriched column is: the adapter applied
    // this join before it chose a page, so ordering by it is meaningful.
    expect(columns.every((column) => column.sortable === undefined)).toBe(true);
  });

  it('collects joins in stack order', () => {
    const second = joinLayer<Order>({
      id: 'flags',
      from: { kind: 'rows', rows: [] },
      on: 'id',
      columns: ['flagged'],
    });

    expect(joinsIn([userJoin(), second]).map((join) => join.id)).toMatchObject([
      'user',
      'flags',
    ]);
  });
});

describe('/memory sorts and filters joined columns', () => {
  // The claim the whole design turns on. `name` came from another array, and
  // the in-memory adapter can order the entire population by it because it
  // joined before it paged.
  it('sorts by a joined column across the whole population', async () => {
    const result = await page([userJoin()], {
      sorts: [
        { columnId: 'name', direction: 'asc' },
        { columnId: 'id', direction: 'asc' },
      ],
    });

    // ada, grace, then the two unmatched rows (nulls last).
    expect(result.rows.map((row) => row.id)).toMatchObject([2, 1, 3, 4]);
  });

  it('filters on a joined column, and the total agrees', async () => {
    const result = await page([userJoin()], {
      filters: [
        { columnId: 'user_tier', value: { kind: 'in', values: ['pro'] } },
      ],
    });

    expect({
      ids: result.rows.map((row) => row.id),
      total: result.total,
    }).toMatchObject({ ids: [2], total: 1 });
  });

  it('sorts by a joined column beyond the first page', async () => {
    const result = await page([userJoin()], {
      offset: 1,
      limit: 1,
      sorts: [{ columnId: 'name', direction: 'asc' }],
    });

    // Page two of a sort by a joined column: the row that is globally second,
    // not the second row of some page that was chosen first.
    expect(result.rows.map((row) => row.id)).toMatchObject([1]);
  });

  it('reports joined stats over the joined population', async () => {
    const stats = await sourceWith([userJoin()]).loadColumnStats?.({
      columnId: 'user_tier',
      filters: [],
    });

    expect(stats).toMatchObject({ kind: 'categorical', nullCount: 2 });
  });

  it('leaves a source without layers untouched', async () => {
    const result = await page([]);
    expect(result.rows.map((row) => row.id)).toMatchObject([1, 2, 3, 4]);
  });

  it('composes two joins, the second seeing the first', async () => {
    const tiers = joinLayer<Order>({
      id: 'tier-label',
      from: {
        kind: 'rows',
        rows: [
          { tier: 'pro', label: 'Professional' },
          { tier: 'free', label: 'Free' },
        ],
      },
      // Keys off `user_tier`, which only exists because the join before it ran.
      on: { left: 'user_tier', right: 'tier' },
      columns: ['label'],
    });

    const result = await page([userJoin(), tiers], {
      sorts: [{ columnId: 'id', direction: 'asc' }],
    });

    expect(result.rows[0]).toMatchObject({ user_tier: 'free', label: 'Free' });
    expect(result.rows[1]).toMatchObject({
      user_tier: 'pro',
      label: 'Professional',
    });
  });
});
