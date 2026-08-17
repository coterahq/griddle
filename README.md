# `@cotera/griddle`

A React data grid that joins your data sources together instead of making you
do it first.

Point it at a parquet file on S3, a JSON endpoint and an array you already have
in memory. You get one grid, and sorting by a column that came from the JSON
sorts all twenty thousand rows, not the two hundred that happened to be on
screen.

```bash
npm install @cotera/griddle
```

---

## The problem

Your orders are in the warehouse. Customer names are behind an API. Feature
flags live in some config service that a different team owns.

So you do the obvious thing. Fetch a page of orders, collect the user IDs, ask
the API for those users, staple the names onto the rows, hand the array to a
grid. It works. It ships.

Then someone clicks "sort by customer".

What they get back is the page you already had, reordered. If Aaron's order is
on page four, he isn't coming to the top, because the sort never left the
browser. The grid looks like it worked. There is no error, no empty state,
nothing red. It is just quietly wrong, and it stays quietly wrong until a user
notices that the top of an A-to-Z list isn't an A.

You can fix it by pushing the join into the query, so the database orders
everything and hands you the right page. That is the correct fix and everybody
knows it. The reason it doesn't happen is that it's a week of work: your sort
state has to reach the query builder, the query builder has to know about the
join, and now you own paging, cancellation, and the fun bug where a slow first
request lands after a fast second one and overwrites it.

This library is that week, already done.

---

## Why should I use this?

Because you have more rows than fit in a page, or your columns come from more
than one place, and you would rather not hand-roll the machinery for either.

It ships the parts everyone builds anyway and nobody enjoys building: row and
column virtualization, pinned columns, resize and reorder, multi-sort with
visible priority, a real filter UI, per-column stats charts that filter when you
click a bar, inline editing with a pending-edit banner, expandable detail
panels, and keyboard navigation that behaves.

It has a data contract, `GridDataSource`, with one required method. Three
adapters ship with it (in-memory, DuckDB, HTTP) and writing a fourth for your
own backend is an afternoon.

It has **layers**, which is the part you can't easily get elsewhere: a way to
compose columns from other sources into the query itself, so ordering by them is
correct rather than plausible.

And it's a real extraction, not a greenfield library. Every feature in here
exists because an application needed it, which is a different and usually better
filter than "what should a grid have".

## Why shouldn't I use this?

Plenty of reasons, and most of them come down to this being an opinionated grid
when you might want an unopinionated one.

**You want to control every pixel.** Use
[TanStack Table](https://tanstack.com/table). It describes itself as "a headless
table library for building powerful datagrids with full control over markup,
styles, and behavior", and that is exactly what it is and exactly what it's good
at. It ships no DOM, so nothing to fight. It's smaller, it's framework-agnostic,
it's excellent, and if your data is small and lives in one place you will
probably be happier with it. We are not trying to talk you out of it.

The trade is that a headless library gives you a state machine and leaves the
rest. Virtualization is a separate package you wire up yourself. Filter UI, sort
affordances, column menus, resize handles, cell editors, stats charts: all
yours, every time, on every project. And the performance characteristics become
your responsibility, which matters more than it sounds. A `columns` array
rebuilt inline on each render, a cell renderer that forgot to memoize, a missing
`getRowId` that makes row selection index-based so it breaks the moment someone
sorts — none of these throw. The grid just gets sluggish somewhere north of a
few thousand rows and you find out from a user. It's all documented and all
avoidable, but it's knowledge every person who touches the file has to be
carrying.

We took the other side of that trade. The decisions are in the library, and
where you disagree with one you replace the whole component instead of
configuring it.

**Your rows are grouped, nested, or aggregated.** There's no group-by, no
rollup rows, no tree data, no multi-level column headers. Rows are a flat list.
If you need a pivot table, this is not a pivot table.

**You need it to render on a server.** It measures itself with `ResizeObserver`
and `getBoundingClientRect`. It is a client component and it will stay one.

**You want joins without DuckDB.** Right now `joinLayer` compiles to SQL, so
engine-side joins mean the DuckDB adapter. There's a
[workaround for small data](#if-both-fit-in-memory-do-it-in-javascript) that's
genuinely fine, but if you wanted the in-memory adapter to do real joins, it
doesn't yet.

**You found a bug or a missing feature.** Please open an issue. Several of the
things in the [limitations](#limitations) section are gaps rather than
decisions, and we'd rather know which ones are in your way.

---

## Quick start

```tsx
import { DataGrid, createDataGridViewModel } from '@cotera/griddle';
import '@cotera/griddle/style.css';
import '@cotera/griddle/themes/light.css';

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

That's the whole integration for an array you already have. No store, no
controller, no page size. Those exist and they matter, but you shouldn't have to
meet them to put fifty rows on a screen.

---

## Joining two JSON blobs

Here's the case from the top of this README, concretely. You have `orders` and
`users` as two arrays, and you want the customer's name to be a real column: one
you can sort by, filter on, and get correct answers from.

### If both fit in memory, do it in JavaScript

For small data this is the right answer and it needs nothing from us. Build a
lookup, flatten the rows, hand them over:

```ts
import { createMemoryDataSource } from '@cotera/griddle/memory';
import { createGridController } from '@cotera/griddle/source';

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

`user_name` now behaves like every other column. This works because the
in-memory adapter holds the whole population, so when it sorts, it sorts
everything. The failure mode described at the top of this file needs a _page_
to happen to, and there isn't one.

### If they don't, let DuckDB do it

Register each blob and declare the join as a layer. DuckDB folds it into the
page query:

```ts
import {
  createDuckDbDataSource,
  joinLayer,
  registerJsonSource,
} from '@cotera/griddle/duckdb';

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

Sorting by `name` is now one query across both relations. Swap
`registerJsonSource` for `registerParquetSource` and the same code runs against
a 200 MB file on a CDN, because DuckDB fetches only the row groups the query
touches over HTTP range requests. The demo does this with 20,000 orders and a
177 kB parquet.

---

## Layers

A layer is one thing laid over a data source. There are four slots, and the
difference between two of them is the whole design.

| Slot      | Available on | What it does                                                                      |
| --------- | ------------ | --------------------------------------------------------------------------------- |
| `present` | any adapter  | Leading grid columns, a live channel for patching loaded rows, a row detail panel |
| `enrich`  | any adapter  | Attach fields to an already-fetched page from somewhere else                      |
| `project` | `/duckdb`    | Extra columns at read time, via `JOIN` from another source                        |
| `mutate`  | `/duckdb`    | Statements against a materialized table; can `ALTER`, can replay an edit log      |

### `project` is not `enrich`

A projected column is part of the query. `WHERE` and `ORDER BY` reach it the
same way they reach a native column, so sorting by it is correct.

An enriched column is stapled onto a page the source already chose. It is the
staple-the-name-on pattern from the top of this README, with a name. Sorting by
one could only ever reorder that page. Filtering by one would leave you with
four rows and a footer confidently claiming 20,000.

So enriched columns can't be sorted or filtered, and we didn't leave that to a
paragraph in a doc. The `EnrichedColumn` type removes both keys, so a layer
can't ask for them. `LayerStack` sets them to `false` on the way out. And
`withLayers` drops any sort or filter that reaches one anyway and warns in
development with the column's name in the message. Three layers of belt for one
pair of trousers, because a silently wrong sort order is the worst thing this
library could do to you.

---

## Adapters

| Import                   | For                                                                        |
| ------------------------ | -------------------------------------------------------------------------- |
| `@cotera/griddle/memory` | An array you already have. Also the reference implementation.              |
| `@cotera/griddle/duckdb` | DuckDB: wasm in a browser, native in Node, anything speaking the same SQL. |
| `@cotera/griddle/http`   | An HTTP endpoint.                                                          |
| `@cotera/griddle/source` | The `GridDataSource` contract and the controller that drives one.          |

`createGridController` sits between the grid and a source and owns the loop:

```ts
const controller = createGridController({
  source,
  viewModel,
  getRowId: (row) => row.id,
  pageSize: 200,
});

<DataGrid {...controller.gridProps} viewModel={viewModel} getRowId={(r) => r.id} />;
```

Four things in there are worth more than they look. Every query carries a
generation counter, so when you toggle a sort twice quickly and the first
response lands second, it gets dropped instead of painted. Superseded queries
are aborted, and the resulting `AbortError` is swallowed, because it's a success
— it means the newer query won. Rows stay on screen through a refetch instead of
blanking. And a filter change invalidates the column stats while a sort change
doesn't, because sorting reorders the same population.

Every one of those is a bug we've watched someone write. The abort one is
practically a rite of passage: you wire up cancellation, then wonder why an
error banner flashes every time a user clicks impatiently.

The controller subscribes to `viewModel.sorts` and `viewModel.filters` directly,
so `onSortChange` and `onFilterChange` stay yours for analytics or URL sync.

### The library doesn't own DuckDB

Bundle selection, worker hosting, and CSP are properties of your deployment, not
of a grid. GitHub Pages can't set COOP/COEP, so a site there needs the
non-threaded bundle, while the same app behind your own server can use threads.
Any answer baked into a library is wrong for somebody. So you pass in a query
function:

```ts
import { createDuckDbWasmQuery } from '@cotera/griddle/duckdb';
const query = createDuckDbWasmQuery(db);
```

There's no `apache-arrow` dependency either. `{ toArray(): unknown[] }` is the
entire type surface, and an Arrow `Table` already satisfies it. A 600 kB peer
dependency to import one type name would be a poor trade.

### Writing your own adapter

One required method. The rest are optional because some backends can answer
cheaply and others can't, and pretending otherwise helps nobody:

```ts
import type { GridDataSource } from '@cotera/griddle/source';

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

  // Optional. Return null when counting is expensive. The controller then
  // works out "is there more" from whether the page came back full, which
  // beats a total you had to guess at.
  async loadTotal({ filters, signal }) {
    return myClient.count({ where: filters, signal });
  },

  // Optional. Leave it off and the header charts stay empty.
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

Two things to get right. Forward the `signal`: the controller aborts superseded
queries, and an adapter that ignores it leaves every abandoned request running
to completion. And interpret filters the way the in-memory adapter does.
`src/memory/filter.ts` is the written definition of what each filter shape
means, down to why a bare scalar is a case-insensitive substring match and not
an equality check. It's exported as `matchesFilterValue` and `compareValues`, so
you can call it instead of reimplementing it slightly differently and spending
an afternoon on why your grid disagrees with itself.

---

## Is it actually fast?

Fast enough that we'd rather show you the tests than the adjectives.

The design goal is that a live update repaints what changed and not the grid.
There are three mechanisms behind that, and `src/core/__tests__/render-cost.spec.tsx`
measures all of them by counting per-row renders through a real
`CellComponent`.

Rows and columns are both virtualized. A 100,000-row source mounts fewer than
sixty rows on first paint, and there's a test pinning that number so nobody
quietly regresses it.

Row identity survives a patch. `createPatchableRowSource` replaces only the row
objects a patch actually touched, and rows are `React.memo`'d, so an untouched
row with an unchanged object doesn't render at all. Concretely, and all asserted:

- inserting a row re-renders no existing row
- deleting a row re-renders no surviving row
- updating one cell re-renders that row and nothing else
- writing a value a cell already holds re-renders **nothing at all**, because
  the source hands back the same array reference and the store's `Object.is`
  check drops the write before a single subscriber hears about it

That last one sounds like a micro-optimization until you meet a reconcile loop
that restates every loaded row on a timer. Most of those writes change nothing,
and now they cost nothing.

Subscription is fine-grained. Every store-typed prop goes through
`useSyncExternalStore`, and column stats are per column, so a histogram arriving
for one column doesn't re-render the header row.

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

### A confession

Everything above was true when we wrote this section except one part, and we
only found out because we wrote the test first.

The claim was that inserting a row doesn't re-render the grid. The test said
otherwise: inserting one row re-rendered every row on screen, and so did
deleting one. Cell updates were already surgical, so the bug had been hiding
behind the case people check.

The cause was a single dependency array. The function that builds each cell's
context is a prop on every memoized row, and it listed the virtual window's
`endIndex`. That index is clamped by the row count, so it moved on every insert
and delete, which gave the callback a new identity, which busted the memo on
every row, which threw away the exact row-identity work the patchable source
exists to do. One ref later it was fixed, and there are now nine tests standing
on it.

We're telling you because "high performance" in a README is worth about as much
as the paper it's printed on. The tests are in the repo. Run them.

---

## Changing data at runtime

`controller.rowSource` takes granular patches, which is what lets the grid
repaint a row instead of the viewport.

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

And the rest of the view model, which is the same shape all the way down:

```ts
viewModel.resizeColumn('name', 240);
viewModel.reorderColumn('total', 'name'); // move `total` before `name`
viewModel.setSort('total', 'desc');
viewModel.setFilter('status', { kind: 'in', values: ['shipped'] });
viewModel.clearFilters();
```

With a controller attached, changing sorts or filters re-queries on its own.
There's nothing to wire.

Everything here is a store. Call `snapshot()` for the value now, `subscribe()`
for changes, or `useGridStore()` inside a component:

```ts
import { useGridStore } from '@cotera/griddle';

const status = useGridStore(controller.status); // 'idle' | 'loading' | 'ready' | 'error'
const total = useGridStore(controller.rowSource.totalRows);
const selected = useGridStore(viewModel.selectedRowIds);
```

---

## Theming

Nine tokens. That's the whole surface:

```css
.cotera-griddle {
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

Thirty-nine more tokens sit behind those, one per thing the grid paints: the row
stripe, three different focus-ring weights, the chart bars, the skeleton pulse.
Each derives from the nine with `color-mix(in oklab, …)` and each can be
overridden on its own if you want to move one without moving the others. Ready
made themes ship at
`@cotera/griddle/themes/{light,dark,dark-auto,cotera}.css`.

There are no dark-mode rules in the library at all. Colour only ever arrives
through those nine, which means `themes/cotera.css` is nine lines of
`--dg-bg: var(--background)` and dark mode follows your app's own `.dark` for
free.

Nothing is defined on `:root`. Every custom property lives on
`.cotera-griddle`, and the build fails if a single `:root` or `:host` selector
survives into `dist/style.css`. Drop this stylesheet into a page you don't
control and it cannot change anything outside the grid. That's not a promise,
it's an assertion in `scripts/build-css.mjs`.

## Overriding components

`CellComponent`, `HeaderComponent`, `RowComponent`, `TopBarComponent` and
`FooterComponent` each replace a default wholesale. No config object, no
seventeen props to discover. Swap the component, render what you want. Anything
you write that paints with `--dg-*` follows the theme without knowing the theme
exists.

---

## Limitations

The short version lives in [why shouldn't I use this](#why-shouldnt-i-use-this).
The details:

**Joins need DuckDB.** `project` and `mutate` compile to SQL. The in-memory
adapter could support engine-side joins, since it holds the whole population,
but it doesn't today; join in JavaScript first. The HTTP adapter can't, because
the library only ever holds one page and the server would have to do the work.

**Enriched columns can't be sorted or filtered.** By design, and enforced three
ways. If you need to order by a column from another source it has to be a
`project` layer, or joined before the data reaches the grid.

**Selection and focus changes re-render the visible window.** Row identity
optimizes data changes. Selection is part of the cell context, so clicking a row
re-renders the rows on screen. Virtualization bounds it, but it isn't as
surgical as a row patch.

**No grouping, aggregation, or tree data.** No multi-level column headers, no
group-by rows, no rollups, no parent/child hierarchies. Detail panels expand;
children don't.

**No CSV or Excel export.** The SQL clause builders are exported
(`buildWhereSql`, `buildOrderBySql`) so an export can use the exact predicate
the grid is showing, but writing the file is on you.

**No persistence.** Column widths, order, visibility, sorts and filters all live
in the view model and vanish on unmount. They're stores, so persisting them is a
`subscribe` and a `set`, but the library won't pick a storage key for you.

**The HTTP adapter has no retry.** A retry policy interacts with the abort on
every sort toggle and with whatever your fetch wrapper already does. Inject
`fetch` and bring your own.

**Text sorts differently between adapters.** DuckDB orders by binary collation;
the in-memory adapter uses `Intl.Collator` with numeric collation, so `item 9`
comes before `item 10` there and after it in DuckDB. Filter _semantics_ agree
exactly and there's a test proving it row for row. Ordering of mixed case or
embedded digits may not.

**Client-side only.** `ResizeObserver` and `getBoundingClientRect` are load
bearing. React 18 or 19.

**duckdb-wasm needs setup from you.** Bundle choice, worker hosting, and the
wasm URL are yours. `examples/src/duckdb.ts` is a working reference, including
the two URLs that have to be absolute or they 404 in production and only in
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

`bun test` is not the test command, and the difference matters. Bun registers
happy-dom, and this grid measures itself entirely through `ResizeObserver`,
`IntersectionObserver`, `getBoundingClientRect` and scroll geometry, which is
precisely the region where happy-dom and jsdom disagree. Tests run on node under
vitest with jsdom, and the DuckDB oracle needs node anyway for a native binding.

## Licence

MIT
