# Layers

<kbd><a href="../README.md">← README</a></kbd>

A layer is one thing laid over a data source. There are five slots, and the
difference between two of them is the whole design.

| Slot      | Available on                               | What it does                                                                      |
| --------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `join`    | any adapter that sees its whole population | Bring columns across from another relation, before paging                         |
| `present` | any adapter                                | Leading grid columns, a live channel for patching loaded rows, a row detail panel |
| `enrich`  | any adapter                                | Attach fields to an already-fetched page from somewhere else                      |
| `project` | `/duckdb`                                  | Hand-written SQL projection, for what `join` can't express                        |
| `mutate`  | `/duckdb`                                  | Statements against a materialized table; can `ALTER`, can replay an edit log      |

---

## Joining two JSON blobs

You have `orders` and `users` as two arrays, and you want the customer's name to
be a real column: one you can sort by, filter on, and get correct answers from.

Declare it as a layer:

```ts
import { joinLayer } from '@cotera/griddle/source';

const withUser = joinLayer({
  id: 'user',
  from: { kind: 'rows', rows: users },
  on: 'user_id',
  columns: ['name', 'email'],
});
```

Then hand it to whichever adapter you're using. **The same object works on
both**, unchanged:

```ts
// In memory: builds a lookup and attaches the fields to the whole array
// before anything is filtered, sorted or paged.
createMemoryDataSource({ rows: orders, columns, layers: [withUser] });

// DuckDB: compiles a JOIN into the page query.
createDuckDbDataSource({ query, from, columns, layers: [withUser] });
```

`name` is now an ordinary column. Sort by it and you get the right rows out of
the whole dataset, because both adapters applied the join _before_ choosing a
page. That property has nothing to do with having a query engine — it needs the
adapter to be able to see everything, which an array and a database both can.

`src/duckdb/__tests__/join-oracle.spec.ts` hands one layer array to both
adapters and asserts they return identical rows across five sort and filter
shapes. If they ever disagree about what a join means, it fails.

---

## When you'd reach for DuckDB anyway

Scale, mostly. A `{ kind: 'rows' }` relation is a lookup table you already have
in memory; past a few thousand rows on the left-hand side you want the engine.
Point it at a parquet and the same layer still applies:

```ts
const from = await registerParquetSource(query, { name: 'orders', url });
createDuckDbDataSource({ query, from, columns, layers: [withUser] });
```

DuckDB fetches only the row groups the query touches, over HTTP range requests,
so a 200 MB file on a CDN costs a few hundred kB to sort. The demo does this
with 20,000 orders in a 177 kB parquet, and again with 609,698 NYC taxi trips in
an 8.7 MB one — the second is the same code and a better argument, because the
join it needs is one the TLC's schema imposed rather than one we chose. See
`scripts/build-taxi-fixture.mjs` for where that data comes from.

For data already in the warehouse, `from` also takes a bare string (or
`{ kind: 'sql' }`), which is a relation only an engine can read:

```ts
joinLayer({ id: 'user', from: 'users', on: 'user_id', columns: ['name'] });
```

The in-memory adapter throws on that one, with a message saying why.

---

## `join` is not `enrich`

A joined column is applied before the page is chosen. `WHERE` and `ORDER BY`
reach it the same way they reach a native column, so sorting by it is correct.
(`project` is the same thing written by hand in SQL, for the cases the
declaration can't express.)

An enriched column is stapled onto a page the source already chose. Sorting by
one could only ever reorder that page. Filtering by one would leave you with
four rows and a footer confidently claiming 20,000.

So enriched columns can't be sorted or filtered, and that isn't left to a
paragraph in a doc:

- The `EnrichedColumn` type removes both keys, so a layer can't ask for them.
- `LayerStack` sets them to `false` on the way out.
- `withLayers` drops any sort or filter that reaches one anyway, and warns in
  development with the column's name in the message.

Three layers of belt for one pair of trousers, because a silently wrong sort
order is the worst thing this library could do to you.

### Which one to reach for

**Use `join`.** It is the way to add a column from another source, and it is
available on every adapter that can see its whole population — in-memory and
DuckDB, including when the relation lives behind an `https://` URL. The column
that comes back is ordinary: sort it, filter it, click a bar in its stats chart.

**Use `project`** on DuckDB when the relationship is something a declarative
join can't express and you want to write the SQL yourself. Same guarantee: the
engine sees the column, so ordering by it is real.

**Use `enrich` only when neither is possible** — the adapter is holding one page
because the server chose it, and there is nowhere for a join to happen. Its
columns are display-only by construction, which is the honest version of the
result rather than a sort that reorders a page and looks like it worked.

---

## Wiring layers up

Which call takes the layers depends on the adapter, because `join`, `project`
and `mutate` change the query while `present` and `enrich` only touch what came
back.

```ts
// Memory and DuckDB take them directly: they own the query, so they can
// compile a join into it.
createMemoryDataSource({ rows, columns, layers });
createDuckDbDataSource({ query, from, columns, layers });

// Any other source wraps: `withLayers` runs `present` and `enrich` around it.
const layered = withLayers({ source, layers, getRowId });
const viewModel = createDataGridViewModel({
  columns: layered.columns(COLUMNS),
});
const controller = createGridController({
  source: layered.source,
  viewModel,
  getRowId,
});
```

`layered.columns(base)` returns presentation columns, then enriched ones, then
your own — the same outermost-first order the stack applies internally. For a
`join` on the memory or DuckDB adapter, `joinedGridColumns(layers)` builds the
grid columns for the fields you brought across, so you don't declare them twice:

```ts
createDataGridViewModel({
  columns: [...COLUMNS, ...joinedGridColumns(layers)],
});
```

---

## `present`: columns, a live channel, a detail panel

Pure React and grid concepts, so it works against every adapter. A selection
checkbox is the smallest useful one, and it ships:

```ts
import { selectionLayer } from '@cotera/griddle/source';

const selection = selectionLayer<Order>({
  render: ({ row, rowId }) => <Checkbox rowId={rowId} disabled={row.locked} />,
});
```

The other two slots are what make `present` more than a column factory. A live
channel patches rows already on screen without re-running the page query, and a
row detail panel renders under an expanded row:

```ts
const liveStatus: GridSourceLayer<Order> = {
  id: 'live-status',
  present: ({ getRowId }) => ({
    columns: [
      {
        id: 'status',
        header: 'Status',
        type: 'category',
        getValue: (row) => row.status,
      },
    ],

    // Called with the grid's side of the channel. Return an unsubscribe.
    subscribe: (grid) => {
      const socket = openStatusFeed();
      socket.on('changed', ({ id, status }) => grid.patch(id, { status }));
      socket.on('created', (order) => grid.insertRow(order));
      socket.on('deleted', ({ id }) => grid.deleteRow(id));
      // `loadedRowIds()` is read at call time, so a subscription can ask for
      // only what is on screen rather than the whole table.
      socket.subscribeTo(grid.loadedRowIds());
      return () => socket.close();
    },

    // Height and renderer travel together: the grid positions rows from the
    // height, so a renderer without one leaves every row unexpandable.
    rowDetail: {
      height: 220,
      render: ({ row }) => <OrderTimeline orderId={getRowId(row)} />,
    },
  }),
};
```

Only one layer in a stack can own the row detail, and it's first-wins — a
selection layer a caller appends can't steal it from the layer that owns the
data. The loser gets a development warning naming both.

---

## `enrich`: one batched lookup per page

The non-SQL join: given the page the source already returned, attach fields from
somewhere else. `attach` is called once with the whole page, precisely so it can
issue one request for every id it needs rather than one per row.

```ts
const userName: GridSourceLayer<Order> = {
  id: 'user',
  enrich: () => ({
    // Declared at construction, so the grid can lay them out. Note there is no
    // `sortable` or `filterable` key to set — `EnrichedColumn` removes both.
    columns: [
      {
        id: 'userName',
        header: 'Customer',
        type: 'text',
        getValue: (row) => row.userName ?? null,
      },
    ],
    attach: async ({ rows, signal }) => {
      const ids = [...new Set(rows.map((row) => row.userId))];
      const names = await api.users.byIds(ids, { signal }); // one request
      return rows.map((row) => ({
        ...row,
        userName: names[row.userId] ?? null,
      }));
    },
  }),
};
```

Forward the `signal`: enrichment runs inside `loadPage`, so a superseded page
query should abandon its lookups too.

---

## `project`: SQL columns the engine can order by

DuckDB only. Where `join` is declarative, `project` hands you the SQL — and
because the column is part of the query, sorts and filters address it exactly
like a native one.

```ts
const slaBreach: SqlSourceLayer<Order> = {
  id: 'sla',
  project: ({ baseAlias, alias }) => {
    const sla = alias('sla'); // unique across the whole stack
    return {
      // Appended to `SELECT <baseAlias>.*`
      selectExpressions: [
        `(${baseAlias}."shipped_at" > ${sla}."due_at") AS "sla_breached"`,
      ],
      // Placed after `FROM <source> AS <baseAlias>`. Qualify base columns with
      // baseAlias — a bare column name in an ON clause is ambiguous.
      joins: [
        `LEFT JOIN sla_targets AS ${sla} ` +
          `ON ${sla}."tier" = ${baseAlias}."tier"`,
      ],
      // Declared so sorts, filters and header stats can address them.
      columns: [{ name: 'sla_breached', type: 'BOOLEAN' }],
    };
  },
};
```

A projected column can also replace its header chart, which is the right call
for a synthesised value where the type-derived aggregate would be meaningless.
`loadStats` receives the fully resolved source with the active `WHERE` already
applied, so what it computes describes exactly the rows on screen:

```ts
columns: [
  {
    name: 'sla_breached',
    type: 'BOOLEAN',
    loadStats: async ({ sourceSql }) => {
      const rows = await query(
        `SELECT "sla_breached" AS key, count(*) AS n ` +
          `FROM ${sourceSql} GROUP BY 1`
      );
      return { kind: 'categorical', buckets: toBuckets(rows) };
    },
  },
];
```

---

## `mutate`: statements against the materialized table

DuckDB only, and the right slot for a bounded, replayable edit log: it can
`ALTER` the schema, and it can position an inserted row relative to a row an
earlier statement inserted. A projection can express neither.

The statements run in order immediately after the table is created, and you
return the schema they leave behind — one return rather than two methods,
because a layer that taught the replay about a new operation and forgot to teach
the schema about it was the most expensive bug shape in this code.

```ts
const edits: SqlSourceLayer<Order> = {
  id: 'edits',
  mutate: ({ tableName, columns, rowIdColumn }) => ({
    statements: [
      `ALTER TABLE "${tableName}" ADD COLUMN "note" VARCHAR`,
      ...editLog.map(
        (edit) =>
          `UPDATE "${tableName}" SET "note" = ${literal(edit.note)} ` +
          `WHERE "${rowIdColumn}" = ${literal(edit.rowId)}`
      ),
    ],
    columns: [...columns, { name: 'note', type: 'VARCHAR' }],
  }),
};
```

Nothing a layer does may depend on connection-scoped state. A query function is
free to take any connection from a pool, so a `CREATE TEMP TABLE`, a temp view
or a `SET` issued by one layer is invisible to the next read — anything that has
to persist belongs in a real table.

---

## Worked examples in the repo

| Where                                        | What it shows                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `examples/src/demos/three-sources.tsx`       | Two `joinLayer`s over a parquet, a JSON URL and an in-memory array      |
| `examples/src/demos/taxi.tsx`                | The same lookup joined twice, aliased, over 609,698 rows                |
| `src/duckdb/__tests__/join-oracle.spec.ts`   | One layer array, both adapters, identical rows across sorts and filters |
| `src/source/layers/__tests__/enrich.spec.ts` | A batched `enrich` lookup, and the sort/filter refusal                  |
| `src/source/layers/__tests__/layers.spec.ts` | Stacking order, the live channel, row-detail first-wins                 |
