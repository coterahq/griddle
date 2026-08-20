# Changing data at runtime

<kbd><a href="../README.md">← README</a></kbd>

`controller.rowSource` takes granular patches, which is what lets the grid
repaint a row instead of the viewport.

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
