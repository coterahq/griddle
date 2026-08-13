import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryDataSource } from '../../memory/source';
import type {
  DataGridColumn,
  DataGridFilter,
  DataGridSort,
} from '../../core/types';
import { joinLayer } from '../join-layer';
import { registerJsonSource, registerParquetSource } from '../ingest';
import { createDuckDbDataSource } from '../source';
import { duckDbStringLiteral } from '../sql';
import type { DuckDbQuery } from '../types';
import { createTestDuckDb } from './duckdb';

/**
 * The product's headline claim, with a real oracle rather than a snapshot.
 *
 * "Point it at a parquet on S3, a JSON API and an in-memory array; get one
 * grid with *real* cross-source sort and filter." A snapshot of the generated
 * SQL would prove the strings have not changed. It would not prove they are
 * right. So: three genuinely different ingestion paths, and every result
 * checked against an equivalent hand-written single-table query — the answer
 * anyone would expect, arrived at without any of the machinery under test.
 *
 * The claim that matters is not "sorting works". It is that sorting by a
 * column from *another source* returns the right rows out of the whole
 * result, rather than the right rows out of the page that happened to be
 * loaded. That is the difference between `project` and `enrich`, and it is
 * why these assertions compare row *ids* across the full result.
 */

type OrderRow = {
  id: number;
  user_id: number;
  region: string;
  total: number | null;
  placed_at: string;
};

const ORDERS: OrderRow[] = [
  { id: 1, user_id: 20, region: 'emea', total: 100, placed_at: '2025-01-05' },
  { id: 2, user_id: 10, region: 'na', total: 20, placed_at: '2025-03-01' },
  { id: 3, user_id: 30, region: 'na', total: null, placed_at: '2025-02-11' },
  { id: 4, user_id: 10, region: 'apac', total: 400, placed_at: '2025-04-20' },
  { id: 5, user_id: 20, region: 'emea', total: 250, placed_at: '2025-01-30' },
  { id: 6, user_id: 30, region: 'apac', total: 60, placed_at: '2025-05-02' },
];

// Lowercase ASCII, distinct, no embedded digits. Deliberate: DuckDB orders
// text by binary collation and `/memory` uses `Intl.Collator`, and the two
// genuinely disagree about case and about 'item 9' vs 'item 10'. A fixture
// that walked into that would be testing collation rather than the join.
const USERS = [
  { user_id: 10, user_name: 'ada', email: 'ada@example.com' },
  { user_id: 20, user_name: 'grace', email: 'grace@example.com' },
  { user_id: 30, user_name: 'brian', email: 'brian@example.com' },
];

const FLAGS = [
  { order_id: 1, is_flagged: true },
  { order_id: 2, is_flagged: false },
  { order_id: 3, is_flagged: true },
  { order_id: 4, is_flagged: false },
  { order_id: 5, is_flagged: true },
  { order_id: 6, is_flagged: false },
];

const COLUMNS = [
  { id: 'id', sqlType: 'INTEGER' },
  { id: 'user_id', sqlType: 'INTEGER' },
  { id: 'region', sqlType: 'VARCHAR' },
  { id: 'total', sqlType: 'INTEGER' },
  { id: 'placed_at', sqlType: 'DATE' },
];

let query: DuckDbQuery;
let close: () => void;
let directory: string;
let source: ReturnType<typeof buildSource>;

const buildSource = (orders: string, users: string, flags: string) =>
  createDuckDbDataSource({
    query,
    from: orders,
    columns: COLUMNS,
    defaultOrderBy: 'id',
    layers: [
      joinLayer({
        id: 'user',
        from: users,
        on: 'user_id',
        columns: ['user_name', 'email'],
      }),
      joinLayer({
        id: 'flags',
        from: flags,
        on: { left: 'id', right: 'order_id' },
        columns: [{ name: 'is_flagged', sqlType: 'BOOLEAN' }],
      }),
    ],
  });

beforeAll(async () => {
  ({ query, close } = await createTestDuckDb());
  directory = await mkdtemp(join(tmpdir(), 'dg-oracle-'));

  // Source 1 — a real parquet file, read back through `read_parquet`.
  const ordersJson = join(directory, 'orders.json');
  await writeFile(ordersJson, JSON.stringify(ORDERS));
  const ordersParquet = join(directory, 'orders.parquet');
  await query(
    `COPY (SELECT * FROM read_json_auto(${duckDbStringLiteral(ordersJson)})) ` +
      `TO ${duckDbStringLiteral(ordersParquet)} (FORMAT PARQUET)`
  );

  // Source 2 — a JSON file on disk, standing in for an API response.
  const usersJson = join(directory, 'users.json');
  await writeFile(usersJson, JSON.stringify(USERS));

  const orders = await registerParquetSource(query, {
    name: 'orders',
    url: ordersParquet,
  });
  const users = await registerJsonSource(query, {
    name: 'users',
    url: usersJson,
  });
  // Source 3 — an array already in memory.
  const flags = await registerJsonSource(query, { name: 'flags', rows: FLAGS });

  source = buildSource(orders, users, flags);
});

afterAll(async () => {
  close();
  await rm(directory, { recursive: true, force: true });
});

const page = async (
  sorts: DataGridSort[] = [],
  filters: DataGridFilter[] = []
): Promise<number[]> => {
  const result = await source.loadPage({
    offset: 0,
    limit: 100,
    sorts,
    filters,
  });
  return result.rows.map((row) => Number((row as { id: unknown }).id));
};

/**
 * The same question, asked without any of the machinery under test: one hand-
 * written JOIN, one ORDER BY, one WHERE.
 */
const oracle = async (clause: string): Promise<number[]> => {
  const result = await query(
    `SELECT o.id FROM read_parquet(${duckDbStringLiteral(
      join(directory, 'orders.parquet')
    )}) AS o
     LEFT JOIN users AS u ON u.user_id = o.user_id
     LEFT JOIN flags AS f ON f.order_id = o.id
     ${clause}`
  );
  return result.toArray().map((row) => Number((row as { id: unknown }).id));
};

describe('cross-source join — the headline claim', () => {
  it('joins three sources into one row shape', async () => {
    const result = await source.loadPage({
      offset: 0,
      limit: 100,
      sorts: [],
      filters: [],
    });

    expect(result.rows[0]).toMatchObject({
      id: 1,
      region: 'emea',
      user_name: 'grace',
      email: 'grace@example.com',
      is_flagged: true,
    });
  });

  /*
   * Every joined sort below carries a secondary sort on `id`.
   *
   * Three users own six orders, so sorting by `user_name` alone leaves ties,
   * and `ORDER BY` says nothing about how ties are broken. Comparing two
   * independently-run queries that both have an undefined tiebreak is a
   * coin flip dressed as an assertion — it passed ascending and failed
   * descending on the first run, which is exactly the failure mode. The
   * tiebreak makes the question well-posed without weakening it: the claim
   * is still that a column from another source orders the whole result.
   */
  it('sorts by a joined column across the whole result, not within a page', async () => {
    // `user_name` lives in the JSON source. If this were `enrich`, the answer
    // could only ever be a reordering of whatever page the parquet returned.
    await expect(
      page([
        { columnId: 'user_name', direction: 'asc' },
        { columnId: 'id', direction: 'asc' },
      ])
    ).resolves.toMatchObject(
      await oracle('ORDER BY u.user_name ASC, o.id ASC')
    );
  });

  it('agrees with the oracle for a descending joined sort', async () => {
    await expect(
      page([
        { columnId: 'user_name', direction: 'desc' },
        { columnId: 'id', direction: 'asc' },
      ])
    ).resolves.toMatchObject(
      await oracle('ORDER BY u.user_name DESC, o.id ASC')
    );
  });

  it('filters on one source while sorting by another', async () => {
    await expect(
      page(
        [
          { columnId: 'user_name', direction: 'asc' },
          { columnId: 'id', direction: 'asc' },
        ],
        [
          {
            columnId: 'is_flagged',
            value: { kind: 'compare', comparison: 'equals', value: true },
          },
        ]
      )
    ).resolves.toMatchObject(
      await oracle(
        'WHERE f.is_flagged = TRUE ORDER BY u.user_name ASC, o.id ASC'
      )
    );
  });

  it('filters on a joined column and the base source at once', async () => {
    await expect(
      page(
        [
          { columnId: 'total', direction: 'desc' },
          { columnId: 'id', direction: 'asc' },
        ],
        [
          {
            columnId: 'user_name',
            value: { kind: 'in', values: ['ada', 'grace'] },
          },
          {
            columnId: 'region',
            value: { kind: 'in', values: ['emea', 'apac'] },
          },
        ]
      )
    ).resolves.toMatchObject(
      await oracle(
        `WHERE u.user_name::VARCHAR IN ('ada', 'grace')
           AND o.region::VARCHAR IN ('emea', 'apac')
         ORDER BY o.total DESC, o.id ASC`
      )
    );
  });

  it('counts under a joined predicate', async () => {
    const total = await source.loadTotal?.({
      filters: [
        {
          columnId: 'is_flagged',
          value: { kind: 'compare', comparison: 'equals', value: true },
        },
      ],
    });

    expect(total).toBe((await oracle('WHERE f.is_flagged = TRUE')).length);
  });

  it('pages a joined sort consistently', async () => {
    const all = await oracle('ORDER BY u.user_name ASC, o.id ASC');
    const first = await source.loadPage({
      offset: 0,
      limit: 3,
      sorts: [
        { columnId: 'user_name', direction: 'asc' },
        { columnId: 'id', direction: 'asc' },
      ],
      filters: [],
    });
    const second = await source.loadPage({
      offset: 3,
      limit: 3,
      sorts: [
        { columnId: 'user_name', direction: 'asc' },
        { columnId: 'id', direction: 'asc' },
      ],
      filters: [],
    });

    expect([
      ...first.rows.map((row) => Number((row as { id: unknown }).id)),
      ...second.rows.map((row) => Number((row as { id: unknown }).id)),
    ]).toMatchObject(all);
  });

  // The property a flat wrap with N joins would silently break: layer 2's
  // JOIN references `id`, which is fine, but its *base alias* is layer 1's
  // subquery — so it can also see `user_name`, which layer 1 produced.
  it('nests wrapping so a later layer can address an earlier one’s column', () => {
    const sql = source.sourceSql();

    expect(sql.startsWith('(SELECT cotera_src_1.*, ')).toBe(true);
    expect(sql).toContain('FROM (SELECT cotera_src_0.*, ');
    expect(sql).toContain('AS cotera_src_0_join_user');
    expect(sql).toContain('AS cotera_src_1_join_flags');
  });

  it('exposes joined columns to the grid as ordinary sortable columns', () => {
    expect(source.columns.map((column) => column.id)).toMatchObject([
      'id',
      'user_id',
      'region',
      'total',
      'placed_at',
      'user_name',
      'email',
      'is_flagged',
    ]);
  });
});

/**
 * The other half of the exit gate: the SQL and the reference implementation
 * have to agree about what a filter *means*.
 *
 * `/memory` is the written definition — `src/memory/filter.ts` — and it is
 * readable. This proves the SQL translation says the same thing, over a
 * fixture flattened to exactly the rows the join produces.
 */
describe('row-for-row agreement with /memory', () => {
  type Flat = OrderRow & {
    user_name: string;
    email: string;
    is_flagged: boolean;
  };

  const FLAT: Flat[] = ORDERS.map((order) => ({
    ...order,
    user_name:
      USERS.find((user) => user.user_id === order.user_id)?.user_name ?? '',
    email: USERS.find((user) => user.user_id === order.user_id)?.email ?? '',
    is_flagged:
      FLAGS.find((flag) => flag.order_id === order.id)?.is_flagged ?? false,
  }));

  const MEMORY_COLUMNS: DataGridColumn<Flat>[] = [
    { id: 'id', header: 'Id', type: 'number', getValue: (row) => row.id },
    {
      id: 'region',
      header: 'Region',
      type: 'text',
      getValue: (row) => row.region,
    },
    {
      id: 'total',
      header: 'Total',
      type: 'number',
      getValue: (row) => row.total,
    },
    {
      id: 'placed_at',
      header: 'Placed',
      type: 'date',
      getValue: (row) => row.placed_at,
    },
    {
      id: 'user_name',
      header: 'User',
      type: 'text',
      getValue: (row) => row.user_name,
    },
    {
      id: 'is_flagged',
      header: 'Flagged',
      type: 'boolean',
      getValue: (row) => row.is_flagged,
    },
  ];

  const memory = createMemoryDataSource<Flat>({
    rows: FLAT,
    columns: MEMORY_COLUMNS,
  });

  const memoryIds = async (
    sorts: DataGridSort[],
    filters: DataGridFilter[]
  ): Promise<number[]> => {
    const result = await memory.loadPage({
      offset: 0,
      limit: 100,
      sorts,
      filters,
    });
    return result.rows.map((row) => row.id);
  };

  const cases: [string, DataGridSort[], DataGridFilter[]][] = [
    [
      'a bare scalar substring on text',
      [{ columnId: 'id', direction: 'asc' }],
      [{ columnId: 'region', value: 'a' }],
    ],
    [
      'an `in` on a joined column',
      [{ columnId: 'id', direction: 'asc' }],
      [
        {
          columnId: 'user_name',
          value: { kind: 'in', values: ['ada', 'brian'] },
        },
      ],
    ],
    [
      'a half-open `between` on numbers',
      [{ columnId: 'id', direction: 'asc' }],
      [{ columnId: 'total', value: { kind: 'between', min: 20, max: 250 } }],
    ],
    [
      'an inclusive `between` on numbers',
      [{ columnId: 'id', direction: 'asc' }],
      [
        {
          columnId: 'total',
          value: { kind: 'between', min: 20, max: 250, inclusiveMax: true },
        },
      ],
    ],
    [
      '`greaterThan` on numbers',
      [{ columnId: 'id', direction: 'asc' }],
      [
        {
          columnId: 'total',
          value: { kind: 'compare', comparison: 'greaterThan', value: 60 },
        },
      ],
    ],
    [
      '`isNull`',
      [{ columnId: 'id', direction: 'asc' }],
      [
        {
          columnId: 'total',
          value: { kind: 'compare', comparison: 'isNull', value: null },
        },
      ],
    ],
    [
      '`isNotNull`',
      [{ columnId: 'id', direction: 'asc' }],
      [
        {
          columnId: 'total',
          value: { kind: 'compare', comparison: 'isNotNull', value: null },
        },
      ],
    ],
    [
      '`contains` on text',
      [{ columnId: 'id', direction: 'asc' }],
      [
        {
          columnId: 'user_name',
          value: { kind: 'compare', comparison: 'contains', value: 'a' },
        },
      ],
    ],
    [
      'a temporal comparison',
      [{ columnId: 'id', direction: 'asc' }],
      [
        {
          columnId: 'placed_at',
          value: {
            kind: 'compare',
            comparison: 'greaterThanOrEqual',
            value: '2025-03-01',
          },
        },
      ],
    ],
    // Nulls last in both directions, which the two agree on: DuckDB's default
    // null order is NULLS LAST regardless of direction, and `/memory` sorts
    // them last deliberately so a descending sort does not open on empties.
    [
      'a descending numeric sort with a null',
      [{ columnId: 'total', direction: 'desc' }],
      [],
    ],
    [
      'an ascending numeric sort with a null',
      [{ columnId: 'total', direction: 'asc' }],
      [],
    ],
    [
      'a multi-key sort',
      [
        { columnId: 'region', direction: 'asc' },
        { columnId: 'total', direction: 'desc' },
        { columnId: 'id', direction: 'asc' },
      ],
      [],
    ],
  ];

  it.each(cases)('agrees on %s', async (_label, sorts, filters) => {
    await expect(page(sorts, filters)).resolves.toMatchObject(
      await memoryIds(sorts, filters)
    );
  });
});
