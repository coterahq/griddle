# Changing data at runtime

<kbd><a href="../README.md">← README</a></kbd>

`controller.rowSource` takes granular patches, which is what lets the grid
repaint a row instead of the viewport.

## How a change reaches sorting, filters and the header stats

There are two levels to this, and the difference is the useful part.

**A patch repaints. It does not re-query.** `applyPatch` writes into the rows
the grid is currently holding, so the affected cells repaint immediately and
nothing moves: a row whose new value would sort it elsewhere stays where it is
until the next query. That is deliberate — rows jumping under the cursor while
someone is reading them is worse than an ordering that is one edit stale.

**To fold the change into ordering, filtering, totals and the header charts,
the source has to see it.** Give the source live data and re-run the query:

```ts
// In memory: `rows` takes a function, re-read on every loadPage, loadTotal
// and loadColumnStats. Return a new array and joined columns re-join too.
let orders = initialOrders;
const source = createMemoryDataSource({ rows: () => orders, columns, layers });

// 1. update the data the source reads
orders = orders.map((o) => (o.id === 'r42' ? { ...o, status: 'shipped' } : o));

// 2. repaint now, so the cell doesn't wait for a round trip
controller.rowSource.applyPatch({
  type: 'update-cell',
  rowId: 'r42',
  columnId: 'status',
  value: 'shipped',
});

// 3. re-run the current query — same sorts, same filters, rows stay mounted
controller.refresh();
```

After step 3 the new value is an ordinary part of the population: `ORDER BY`
sees it, `WHERE` sees it, and `loadTotal` counts it. Changing a sort or a filter
re-queries on its own, so an edit made just before a sort needs no `refresh()`
at all.

On the DuckDB adapter the equivalent of step 1 is a `mutate` layer, which
replays an edit log into the materialized table so the engine owns the value —
see [Layers](./layers.md#mutate-statements-against-the-materialized-table).

**Header stats** are per column and reload when filters change, or the first
time a column's stats are opened. They are computed by the source over the whole
population — `loadColumnStats` in the in-memory adapter reads the same `rows`
function, and the DuckDB adapter aggregates over the fully joined source — so
once the source has the change, the next stats load reflects it. Toggling a
filter is the cheapest way to force that; a patch alone will not, because the
grid never claims to have recomputed an aggregate it did not run.

## Rows

Add a row:

```ts
controller.rowSource.applyPatch({
  type: 'insert-row',
  row: { id: 'new', name: 'Ada', total: 42 },
});

// or put it somewhere specific
controller.rowSource.applyPatch({ type: 'insert-row', row, atIndex: 0 });
```

Remove one:

```ts
controller.rowSource.applyPatch({ type: 'delete-row', rowId: 'new' });
```

Update a cell, or a whole row:

```ts
controller.rowSource.applyPatch({
  type: 'update-cell',
  rowId: 'r42',
  columnId: 'status',
  value: 'shipped',
});

controller.rowSource.applyPatch({
  type: 'update-row',
  rowId: 'r42',
  row: next,
});
```

Replace a range:

```ts
controller.rowSource.applyPatch({
  type: 'splice-rows',
  startIndex: 10,
  deleteCount: 5,
  rows: replacements,
});
```

Insert, delete and splice keep `totalRows` in step when a total is known.

Batches coalesce into a single notification:

```ts
// 200 cell updates off a websocket, one render
rowSource.applyPatches(
  deltas.map((d) => ({
    type: 'update-cell',
    rowId: d.id,
    columnId: d.field,
    value: d.value,
  }))
);
```

## Columns

Columns live in a store on the view model, so changing them is a `set`. Hiding
keeps a column reachable, since the top bar renders a chip to bring it back:

```ts
viewModel.setColumnVisible('note', false);
```

Deleting is removing it from the array:

```ts
viewModel.columns.set(
  viewModel.columns.snapshot().filter((column) => column.id !== 'note')
);
```

Adding one at runtime is the mirror image:

```ts
viewModel.columns.set([
  ...viewModel.columns.snapshot(),
  { id: 'margin', header: 'Margin', type: 'number', getValue: (r) => r.margin },
]);
```

## The rest of the view model

Same shape all the way down:

```ts
viewModel.resizeColumn('name', 240);
viewModel.reorderColumn('total', 'name'); // move `total` before `name`
viewModel.setSort('total', 'desc');
viewModel.setFilter('status', { kind: 'in', values: ['shipped'] });
viewModel.clearFilters();
```

With a controller attached, changing sorts or filters re-queries on its own.
There's nothing to wire.

## Stores

Everything here is a store. Call `snapshot()` for the value now, `subscribe()`
for changes, or `useGridStore()` inside a component:

```ts
import { useGridStore } from '@cotera/griddle';

const status = useGridStore(controller.status); // 'idle' | 'loading' | 'ready' | 'error'
const total = useGridStore(controller.rowSource.totalRows);
const selected = useGridStore(viewModel.selectedRowIds);
```
