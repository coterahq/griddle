# `@cotera/data-grid`

A React data grid that **joins multiple data sources into one view**.

Point it at a parquet on S3, a JSON API and an in-memory array; get one grid
with real cross-source sort and filter — one query across all of them, not a
reordering of whatever page happened to be loaded.

```bash
npm install @cotera/data-grid
```

---

## Why this exists

Most data grids assume you already have the rows. You fetch an array, hand it
over, and the grid sorts and filters it in JavaScript. That works until one of
three things happens, and in practice all three happen at once.

**The rows don't fit.** Once the dataset is larger than the page, sorting the
loaded page is not sorting — it reorders a sample and looks like it worked. The
grid has to be able to push the sort down to whatever holds the data.

**The rows aren't in one place.** Orders live in the warehouse, customer names
in an API, feature flags in a config service. The usual answer is to fetch a
page and then decorate it — but a column stapled onto a page cannot be sorted
by, for the same reason as above. What you want is for the _join_ to happen
before the page is chosen.

**The grid is the product surface.** Column stats, in-cell bars, editing,
detail panels and structured filters get built anyway, badly, twice, because
they weren't in the grid.

This library was extracted from a working application, so it starts from the
end of that road rather than the beginning: a `GridDataSource` contract that any
backend can implement, a controller that handles the paging and cancellation
that a real backend forces on you, and **layers** — a way to compose extra
columns from other sources into the query itself, so ordering by them is
correct rather than plausible.

It is deliberately _not_ a spreadsheet, not a pivot table, and not a charting
library. See [Limitations](#limitations).

### Why not TanStack Table?

TanStack Table is very good, and this is not a criticism of it — it answers a
different question. It is **headless**: it gives you a table state machine and
you bring every piece of DOM. When you need total control over markup, or you
are building a design system's own table, that is exactly the right shape.

The cost is that a state machine leaves the expensive parts to you:

- **Virtualization is a separate concern.** You reach for TanStack Virtual and
  wire it up yourself — row and column windowing, scroll geometry, and how both
  interact with pinned columns and variable row heights.
- **Everything visible is yours.** Filter UI, sort affordances, column menus,
  resize handles, cell editors, detail panels, stats charts. Each one is a
  couple of days, and you write them again on the next project.
- **The performance pitfalls come with it.** A `data` or `columns` array
  rebuilt inline on every render, a cell renderer that isn't memoized, a missing
  `getRowId` that makes selection index-based and breaks it on sort — these
  degrade quietly. Nothing errors; the grid just gets slow at a few thousand
  rows, and you find out in production. Getting it right is well-documented and
  entirely achievable, but it is knowledge you have to hold, and everyone on the
  team has to hold it.
- **Server-side data is a mode, not a mechanism.** `manualSorting` and friends
  tell the table not to sort locally — you still write the fetch loop, the
  `AbortController` lifecycle, the generation counter that stops a slow first
  response from overwriting a fast second one, and the "keep rows on screen
  during a refetch" behaviour. That loop is roughly what
  `createGridController` is, and it is more subtle than it looks.
- **Nothing joins sources**, because that isn't what a table state machine is
  for.

So: if your dataset is small, lives in one place, and you want to design every
pixel, TanStack Table will give you a smaller bundle and total freedom, and you
should use it.

This library takes the opposite position. It ships opinions — real markup, real
virtualization, a real filter UI, a real editing flow — and makes the
performance-critical decisions in the library rather than in your application
code. The correctness of a live update is a
[test in this repo](#performance), not a guideline you have to remember.
Where you disagree with an opinion, replace the component wholesale; the
override slots exist for exactly that.

---

## Features

**Rendering**

- Virtualized rows **and** columns — a 100,000-row source mounts a bounded
  window, not the dataset
- Column pinning (left/right), resize, drag reorder, show/hide
- Multi-sort with visible priority, structured filters, per-column stats charts
  (categorical, numeric histogram, temporal) that filter on click
- In-cell value bars, number/percent/compact formatting, per-column display
  options
- Inline cell editing with a pending-edit banner or auto-save, dirty markers,
  and revert
- Expandable row detail panels, full keyboard navigation, cell-range selection
- Component override slots for cell, header, row, top bar and footer

**Data**

- One contract, `GridDataSource`, with three adapters shipped: `/memory`,
  `/duckdb`, `/http` — and a [custom adapter](#writing-a-custom-adapter) is one
  required method
- A controller that owns paging, `AbortController` lifecycle, out-of-order
  response rejection and stats invalidation
- **Layers**: compose extra columns from other sources into the query
- Granular row patches — insert, delete, update a cell — that repaint what
  changed rather than the grid

**Integration**

- Nine CSS custom properties are the entire theming surface; no dark-mode rules
  in the library
- Zero `:root` selectors in the shipped stylesheet, enforced at build time
- No domain types anywhere in it; `TRow` is yours
- ESM + CJS, typed for `node10`/`node16`/`bundler` resolution, no `any` in the
  public surface

---

## Quick start

```tsx
import { DataGrid, createDataGridViewModel } from '@cotera/data-grid';
import '@cotera/data-grid/style.css';
import '@cotera/data-grid/themes/light.css';

const columns = [
  { id: 'name', header: 'Name', type: 'text', getValue: (row) => row.name },
  {
    id: 'total',
    header: 'Total',
    type: 'number',
    getValue: (row) => row.total,
  },
];

function Orders({ rows }) {
  const viewModel = React.useMemo(
    () => createDataGridViewModel({ columns }),
    []
  );
  return (
    <DataGrid rows={rows} viewModel={viewModel} getRowId={(row) => row.id} />
  );
}
```

`rows` takes a plain array. Nothing here requires learning what a store, a page
or an abort controller is — those exist underneath and are load-bearing, but not
at the front door.

---

## Joining two JSON blobs

Say you have orders and users as two separate arrays, and you want the user's
name to be a **real column** — sortable and filterable across the whole
dataset, not just the loaded page.

### If both fit in memory, join them in JavaScript

The honest answer for small data. `/memory` holds the entire population, so
sorting and filtering a field you attached yourself is exactly as correct as
sorting a native one:

```ts
import { createMemoryDataSource } from '@cotera/data-grid/memory';
import { createGridController } from '@cotera/data-grid/source';

const usersById = new Map(users.map((user) => [user.user_id, user]));
const joined = orders.map((order) => ({
  ...order,
  user_name: usersById.get(order.user_id)?.name ?? null,
}));

const controller = createGridController({
  source: createMemoryDataSource({ rows: joined, columns }),
  viewModel,
  getRowId: (row) => row.id,
});
```

No library feature needed, and `user_name` behaves like any other column.

### If they don't, let DuckDB do it

Register each blob as a relation and declare the join as a layer. DuckDB
compiles it into the page query, so the sort is applied across the whole
dataset before the page is chosen:

```ts
import {
  createDuckDbDataSource,
  joinLayer,
  registerJsonSource,
} from '@cotera/data-grid/duckdb';

const ordersRel = await registerJsonSource(query, {
  name: 'orders',
  rows: orders,
});
const usersRel = await registerJsonSource(query, {
  name: 'users',
  rows: users,
});

const source = createDuckDbDataSource({
  query,
  from: ordersRel,
  columns: [
    { id: 'id', sqlType: 'BIGINT' },
    { id: 'user_id', sqlType: 'VARCHAR' },
    { id: 'total', sqlType: 'BIGINT' },
  ],
  layers: [
    joinLayer({ id: 'user', from: usersRel, on: 'user_id', columns: ['name'] }),
  ],
});
```

Sorting by `name` now issues one query across both relations. The same code
works if `orders` is `registerParquetSource(...)` pointed at a 200 MB file on a
CDN — DuckDB reads only the row groups the query touches, over HTTP range
requests.

`registerJsonSource` also takes `{ url }` to let DuckDB fetch the blob itself,
and `registerParquetSource` / `registerArrowSource` cover the other two paths.

---

## Layers

A layer is one thing laid over a data source. Four slots:

| Slot      | Available on | What it does                                                                      |
| --------- | ------------ | --------------------------------------------------------------------------------- |
| `present` | any adapter  | Leading grid columns, a live channel for patching loaded rows, a row detail panel |
| `enrich`  | any adapter  | Attach fields to an already-fetched page from somewhere else                      |
| `project` | `/duckdb`    | Extra columns at read time, via `JOIN` from another source                        |
| `mutate`  | `/duckdb`    | Statements against a materialized table; can `ALTER`, can replay an edit log      |

### `project` is not `enrich`

This is the distinction the whole design turns on.

A **projected** column is part of the query, so the grid's own `WHERE` and
`ORDER BY` address it exactly like a native one.

An **enriched** column is stapled onto a page the source already chose. Sorting
by it could only reorder _that page_ — which looks like it worked — and
filtering by it would leave a short page beside a total that disagrees with it.

So enriched columns are not sortable or filterable, and that is enforced three
ways rather than documented once: `EnrichedColumn` removes both keys so a layer
cannot ask for them, `LayerStack` sets them `false`, and `withLayers` drops any
sort or filter that reaches one anyway with a development warning naming the
column.

Silent wrong ordering is the worst outcome available here.

---

## Adapters

| Import                     | For                                                                         |
| -------------------------- | --------------------------------------------------------------------------- |
| `@cotera/data-grid/memory` | An array you already have. Also the reference implementation.               |
| `@cotera/data-grid/duckdb` | DuckDB — wasm in a browser, native in Node, anything speaking the same SQL. |
| `@cotera/data-grid/http`   | An HTTP endpoint.                                                           |
| `@cotera/data-grid/source` | The `GridDataSource` contract and the controller that drives one.           |

`createGridController` sits between the grid and a source:

```ts
const controller = createGridController({
  source,
  viewModel,
  getRowId: (row) => row.id,
  pageSize: 200,
});

<DataGrid {...controller.gridProps} viewModel={viewModel} getRowId={(r) => r.id} />;
```

It handles the four things that go wrong when this is written by hand: stale
responses discarded by generation counter, `AbortError` swallowed rather than
surfaced as an error, rows staying mounted through a refetch, and stats
invalidated by a filter change but not by a sort. It subscribes to
`viewModel.sorts` and `viewModel.filters` directly, so `onSortChange` /
`onFilterChange` stay free for analytics or URL sync.

### The library does not own DuckDB

Bundle selection, worker hosting and CSP differ per deployment — GitHub Pages
cannot set COOP/COEP, so the same app needs a non-threaded bundle there and a
threaded one behind its own server. You inject a query function:

```ts
import { createDuckDbWasmQuery } from '@cotera/data-grid/duckdb';
const query = createDuckDbWasmQuery(db);
```

There is no `apache-arrow` dependency. `{ toArray(): unknown[] }` is the entire
type surface, which an Arrow `Table` satisfies structurally.

### Writing a custom adapter

One required method. Everything else is optional and exists because some
backends can answer cheaply and others cannot:

```ts
import type { GridDataSource } from '@cotera/data-grid/source';

const source: GridDataSource<Order> = {
  async loadPage({ offset, limit, sorts, filters, signal }) {
    const response = await myClient.search({
      skip: offset,
      take: limit,
      orderBy: sorts.map((s) => `${s.columnId} ${s.direction}`),
      where: filters,
      signal,
    });
    return { rows: response.items, total: response.count ?? null };
  },

  // Optional. Return null if counting is expensive — the controller then
  // infers "is there more" from whether the page came back full, which is
  // better than a wrong total.
  async loadTotal({ filters, signal }) {
    return myClient.count({ where: filters, signal });
  },

  // Optional. Omit it and the header charts stay empty.
  async loadColumnStats({ columnId, filters, signal }) {
    const buckets = await myClient.histogram({
      columnId,
      where: filters,
      signal,
    });
    return {
      kind: 'categorical',
      buckets: buckets.map((b) => ({
        key: b.value,
        label: b.value,
        count: b.n,
        filter: { kind: 'in', values: [b.value] },
      })),
    };
  },
};
```

Two rules. **Forward `signal`** — the controller aborts superseded queries, and
an adapter that drops it leaves every abandoned request running. And **interpret
filters the way `/memory` does**: `src/memory/filter.ts` is the written
definition of what each filter shape means, and it is exported
(`matchesFilterValue`, `compareValues`) so you can reuse it directly rather than
reimplement it slightly differently.

---

## Performance

The design goal is that **a live update repaints what changed, not the grid**.
Three mechanisms, all measured in `src/core/__tests__/render-cost.spec.tsx`
rather than asserted:

**Virtualization.** Rows and columns are both windowed. A 100,000-row source
mounts fewer than 60 cells on first paint.

**Row identity is preserved across patches.** `createPatchableRowSource`
replaces only the row objects a patch actually touches. Rows are `React.memo`'d,
so an untouched row with an unchanged object skips rendering entirely. The spec
measures the render count per row and asserts:

- inserting a row does not re-render any existing row
- deleting a row does not re-render any surviving row
- updating one cell re-renders that row only
- writing a value a cell already holds re-renders **nothing** — the source
  returns the same array reference, and the store's `Object.is` guard drops the
  write before any subscriber is notified

**Fine-grained subscription.** Every store-typed prop is read through
`useSyncExternalStore`, and column stats are per column — a stats delta for one
column does not re-render the header row.

Batches coalesce: `applyPatches([...])` produces one notification, not one per
patch.

```ts
// 200 cell updates arriving from a websocket, one render
rowSource.applyPatches(
  deltas.map((d) => ({
    type: 'update-cell',
    rowId: d.id,
    columnId: d.field,
    value: d.value,
  }))
);
```

---

## Working with data programmatically

`controller.rowSource` is a patchable row source. Patches are granular so the
grid does not have to swap the whole array — see
[Performance](#performance) for what that buys.

### Adding a row

```ts
controller.rowSource.applyPatch({
  type: 'insert-row',
  row: { id: 'new', name: 'Ada', total: 42 },
});

// At a position, rather than appended
controller.rowSource.applyPatch({ type: 'insert-row', row, atIndex: 0 });
```

### Deleting a row

```ts
controller.rowSource.applyPatch({ type: 'delete-row', rowId: 'new' });
```

### Updating a cell or a whole row

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

### Replacing a range

```ts
controller.rowSource.applyPatch({
  type: 'splice-rows',
  startIndex: 10,
  deleteCount: 5,
  rows: replacements,
});
```

Insert, delete and splice adjust `totalRows` automatically when a total is
known.

### Hiding a column

Keeps it reachable — the top bar renders a chip to bring it back:

```ts
viewModel.setColumnVisible('note', false);
```

### Removing a column entirely

Columns live in a store on the view model, so removing one is a `set`:

```ts
viewModel.columns.set(
  viewModel.columns.snapshot().filter((column) => column.id !== 'note')
);
```

### Adding a column at runtime

```ts
viewModel.columns.set([
  ...viewModel.columns.snapshot(),
  { id: 'margin', header: 'Margin', type: 'number', getValue: (r) => r.margin },
]);
```

### Resizing, reordering, sorting and filtering

```ts
viewModel.resizeColumn('name', 240);
viewModel.reorderColumn('total', 'name'); // move `total` before `name`
viewModel.setSort('total', 'desc');
viewModel.setFilter('status', { kind: 'in', values: ['shipped'] });
viewModel.clearFilters();
```

When a controller is attached, changing sorts or filters re-queries
automatically — nothing else to wire.

### Reading state

Every one of these is a store: `snapshot()` for the current value,
`subscribe()` for changes, and `useGridStore()` inside a component.

```ts
import { useGridStore } from '@cotera/data-grid';

const status = useGridStore(controller.status); // 'idle' | 'loading' | 'ready' | 'error'
const total = useGridStore(controller.rowSource.totalRows);
const selected = useGridStore(viewModel.selectedRowIds);
```

---

## Theming

Nine tokens. That is the whole surface a theme has to supply:

```css
.cotera-data-grid {
  --dg-bg: #ffffff;
  --dg-fg: #0a0a0a;
  --dg-muted: #f4f4f5;
  --dg-muted-fg: #71717a;
  --dg-border: #e4e4e7;
  --dg-accent: #2563eb;
  --dg-accent-fg: #fafafa;
  --dg-popover: #ffffff;
  --dg-popover-fg: #0a0a0a;
}
```

39 role tokens — the row stripe, three focus-ring weights, the chart bars, the
skeleton pulse — derive from those with `color-mix(in oklab, …)` and are each
individually overridable. Ready-made themes ship at
`@cotera/data-grid/themes/{light,dark,dark-auto,cotera}.css`.

The library emits **no dark-mode rules**. Colour reaches it only through the
nine, so `themes/cotera.css` is nine lines of `--dg-bg: var(--background)` and
dark mode follows a host's own `.dark` for free.

Nothing is defined on `:root`. Every custom property lives on
`.cotera-data-grid`, and the build fails if a single `:root` or `:host` selector
survives into `dist/style.css` — so dropping this into a page you do not control
cannot change anything outside the grid.

---

## Overriding components

`CellComponent`, `HeaderComponent`, `RowComponent`, `TopBarComponent` and
`FooterComponent` replace the defaults wholesale rather than taking a config
object — a small number of total replacements instead of a large number of
options that each need documenting and keeping working. Overrides painting with
`--dg-*` follow the theme without knowing it exists.

---

## Limitations

Stated plainly, because finding these out later is worse.

**Joins are DuckDB-only.** `project` and `mutate` compile to SQL, so
`joinLayer` needs `/duckdb`. `/memory` could support engine-side joins — it
holds the whole population — but does not yet; join in JavaScript first, as
[above](#if-both-fit-in-memory-join-them-in-javascript). `/http` cannot,
because the library only ever holds one page; the server would have to do it.

**Enriched columns cannot be sorted or filtered.** By design, and enforced. If
you need to order by a column from another source, it has to be a `project`
layer on a SQL source, or joined before the data reaches the grid.

**Changing selection or focus re-renders the visible window.** Row identity
optimises _data_ changes. Selection state is part of the cell context, so
clicking a row re-renders the rows on screen — bounded by virtualization, but
not surgical the way a row patch is.

**No grouping, aggregation or tree data.** No multi-level column headers, no
group-by rows, no rollups, no parent/child hierarchies. Rows are a flat list.
Expandable _detail panels_ exist; expandable _children_ do not.

**No CSV or Excel export.** The SQL clause builders are exported
(`buildWhereSql`, `buildOrderBySql`) so an export can use the exact predicate
the grid is showing, but writing the file is yours.

**No persistence.** Column widths, order, visibility, sorts and filters live in
the view model and vanish on unmount. They are all stores, so persisting them is
a `subscribe` and a `set` — but the library will not pick a storage key for you.

**`/http` has no retry**, deliberately: a retry policy interacts with the abort
on every sort toggle and with whatever your fetch wrapper already does. Inject
`fetch` if you want one.

**`/memory` and `/duckdb` collate text differently.** DuckDB orders by binary
collation; `/memory` uses `Intl.Collator` with numeric collation, so `item 9`
precedes `item 10` there and follows it in DuckDB. Filter semantics agree
exactly and are proved row-for-row; text _ordering_ of mixed case or embedded
digits may not.

**Client-side only.** It reads layout from `ResizeObserver` and
`getBoundingClientRect`, so it does not server-render. React 18 or 19.

**duckdb-wasm needs work from you.** Bundle selection, worker hosting and the
wasm URL are the host's; see `examples/src/duckdb.ts` for a working setup,
including the two URLs that must be made absolute or they 404 only in
production.

---

## Development

```bash
bun install
bun run test          # vitest on node, jsdom, 226 specs
bun run typecheck
bun run lint
bun run build         # tsup (js + bundled dts), then scripts/build-css.mjs
bun run check:package # publint + attw

bun run examples:dev         # the demo site
bun run examples:screenshots # visual baseline
```

`bun test` is not the test command: it registers happy-dom, and the grid
measures itself entirely from `ResizeObserver` / `IntersectionObserver` with
heavy `getBoundingClientRect` and scroll geometry — exactly where the two DOM
shims diverge.

## Licence

MIT
