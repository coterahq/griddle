# `@cotera/griddle`

A batteries-included React data grid. Virtualization, filtering, sorting,
column stats, inline editing and theming are in the box — and columns can come
from more than one data source, joined before the grid picks a page, so sorting
by them is correct rather than plausible.

```bash
npm install @cotera/griddle
```

## Demos

Eight demos, all running in the browser, no server:
**[coterahq.github.io/griddle](https://coterahq.github.io/griddle/)**

| Demo                                                                    | What it shows                                                                                                                                                               |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [A parquet file](https://coterahq.github.io/griddle/?demo=parquet)      | 20,000 rows in a 177 kB parquet on a CDN. DuckDB reads only the row groups a sort touches, over HTTP range requests. Columns come from `describeSource`, not a declaration. |
| [Any CSV](https://coterahq.github.io/griddle/?demo=csv)                 | Paste a CSV URL. DuckDB sniffs the delimiter and types; the columns build themselves.                                                                                       |
| [Three sources](https://coterahq.github.io/griddle/?demo=three-sources) | A parquet, a JSON file and an in-memory array in one grid. Sort by a column from any of them; it's one query.                                                               |
| [600k real rows](https://coterahq.github.io/griddle/?demo=taxi)         | 609,698 NYC taxi trips as the TLC published them, with zone names joined from a separate lookup, twice.                                                                     |
| [In memory](https://coterahq.github.io/griddle/?demo=memory)            | 10,000 rows sorted and filtered in JavaScript. Also the reference adapter the others are tested against.                                                                    |
| [Over HTTP](https://coterahq.github.io/griddle/?demo=http)              | A real `fetch` against a service worker. Sort twice quickly and watch the superseded request abort silently.                                                                |
| [Theming](https://coterahq.github.io/griddle/?demo=theming)             | Nine tokens, live. Everything else derives from them.                                                                                                                       |
| [Overrides](https://coterahq.github.io/griddle/?demo=overrides)         | A custom cell drawing a sparkline and a wholesale header replacement, both following the theme.                                                                             |

Every demo is a file in `examples/src/demos/` — start from the one closest to
your case. It also powers our public dataset library at
[cotera.co/datasets/library](https://cotera.co/datasets/library).

---

## What's in the box

The parts most teams end up building by hand:

- **Virtualization**, rows and columns both.
- **Columns**: pin, resize, reorder, hide (hidden columns get a chip to bring
  them back).
- **Sorting**: multi-sort with visible priority, and a `sortableColumns()`
  capability so the header never offers a sort the backend can't honour.
- **Filtering**: a filter UI per column type, plus per-column stats charts where
  clicking a bar applies the matching filter.
- **Editing**: inline cell editors with a pending-edit banner.
- **Rows**: expandable detail panels, selection, keyboard navigation.
- **Live data**: granular patches (insert, delete, update cell/row, splice) that
  repaint the affected row instead of the viewport.
- **Async plumbing**: paging, abort of superseded queries, out-of-order response
  handling, rows kept on screen through a refetch.
- **Theming**: nine CSS tokens, four shipped themes, no `:root` leakage.
- **Adapters**: in-memory, DuckDB and HTTP, behind a one-method contract.

The thing you can't easily assemble from other libraries is **layers**: columns
composed from another source _into the query_, so `ORDER BY` and `WHERE` reach
them.

## When to use something else

**You want control over every pixel.** [TanStack Table](https://tanstack.com/table)
is headless, smaller, framework-agnostic and excellent. It ships no DOM, so
there's nothing to fight — but virtualization, filter UI, column menus, resize
handles, cell editors and stats charts are yours to wire up on every project.
Griddle takes the other side of that trade: the decisions live in the library,
and where you disagree you replace a whole component rather than configure one.

**Your rows are grouped, nested or aggregated.** There is no group-by, no
rollups, no tree data, no multi-level headers. Rows are a flat list.

**You need server rendering.** It measures itself with `ResizeObserver` and
`getBoundingClientRect`. Client only.

**Your data is behind an API you don't control.** Joins need an adapter that can
see the whole population before it pages. One page of an HTTP response can't, so
the best available there is `enrich`, whose columns can't be sorted or filtered.

Full detail in [Limitations](#limitations).

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

That's the whole integration for an array you already have — no store,
controller or page size required.

---

## Joining across sources

You have `orders` and `users` as two arrays, and you want the customer's name to
be a real column: sortable, filterable, correct across the whole dataset rather
than the page on screen.

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

The same object works on either adapter, unchanged:

```ts
// In memory: builds a lookup and attaches the fields to the whole array
// before anything is filtered, sorted or paged.
createMemoryDataSource({ rows: orders, columns, layers: [withUser] });

// DuckDB: compiles a JOIN into the page query.
createDuckDbDataSource({ query, from, columns, layers: [withUser] });
```

`name` is now an ordinary column, because both adapters applied the join
_before_ choosing a page. A test hands one layer array to both adapters and
asserts identical rows across five sort and filter shapes.

### Reaching for DuckDB

Scale, mostly. `{ kind: 'rows' }` is a lookup table already in memory; past a
few thousand rows on the left-hand side you want an engine. Point it at a
parquet and the same layer applies:

```ts
const from = await registerParquetSource(query, { name: 'orders', url });
createDuckDbDataSource({ query, from, columns, layers: [withUser] });
```

DuckDB fetches only the row groups the query touches, over HTTP range requests,
so a large file on a CDN costs a few hundred kB to sort. For data already in a
warehouse, `from` also takes a bare string (or `{ kind: 'sql' }`):

```ts
joinLayer({ id: 'user', from: 'users', on: 'user_id', columns: ['name'] });
```

The in-memory adapter throws on that one, with a message saying why.

---

## Layers

A layer is one thing laid over a data source.

| Slot      | Available on                               | What it does                                                                      |
| --------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `join`    | any adapter that sees its whole population | Bring columns across from another relation, before paging                         |
| `present` | any adapter                                | Leading grid columns, a live channel for patching loaded rows, a row detail panel |
| `enrich`  | any adapter                                | Attach fields to an already-fetched page from somewhere else                      |
| `project` | `/duckdb`                                  | Hand-written SQL projection, for what `join` can't express                        |
| `mutate`  | `/duckdb`                                  | Statements against a materialized table; can `ALTER`, can replay an edit log      |

### `join` is not `enrich`

A joined column is applied before the page is chosen, so `WHERE` and `ORDER BY`
reach it the same way they reach a native column.

An enriched column is stapled onto a page the source already chose. Sorting by
one could only reorder that page; filtering by one would leave four rows under a
footer claiming 20,000. So enriched columns can't be sorted or filtered, and
that's enforced three ways rather than documented once: the `EnrichedColumn`
type removes both keys, `LayerStack` sets them to `false` on the way out, and
`withLayers` drops any sort or filter that reaches one and warns in development.

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

It handles the parts that are easy to get wrong: every query carries a
generation counter, so a slow first response landing after a fast second one is
dropped rather than painted; superseded queries are aborted and the resulting
`AbortError` is swallowed rather than surfaced as an error; rows stay on screen
through a refetch; and a filter change invalidates column stats while a sort
change doesn't.

The controller subscribes to `viewModel.sorts` and `viewModel.filters` directly,
so `onSortChange` and `onFilterChange` stay yours for analytics or URL sync.

### The library doesn't own DuckDB

Bundle selection, worker hosting and CSP are properties of your deployment.
GitHub Pages can't set COOP/COEP, so a site there needs the non-threaded bundle
while the same app behind your own server can use threads. So you pass in a
query function:

```ts
import { createDuckDbWasmQuery } from '@cotera/griddle/duckdb';
const query = createDuckDbWasmQuery(db);
```

There's no `apache-arrow` dependency either — `{ toArray(): unknown[] }` is the
entire type surface, and an Arrow `Table` already satisfies it.

### Writing your own adapter

One required method. The rest are optional, because some backends can answer
cheaply and others can't:

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
  // works out "is there more" from whether the page came back full.
  async loadTotal({ filters, signal }) {
    return myClient.count({ where: filters, signal });
  },

  // Optional. Declare it when your API only sorts by certain fields, so the
  // grid doesn't draw a sort arrow over the backend's default order. Omit it
  // to mean "any column".
  sortableColumns() {
    return ['id', 'name', 'created_at'];
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

The controller intersects `sortableColumns()` with each column's own `sortable`,
so the capability can take a sort away but never hand one back that you
disabled.

Two things to get right. **Forward the `signal`** — the controller aborts
superseded queries, and an adapter that ignores it leaves abandoned requests
running. And **interpret filters the way the in-memory adapter does**:
`src/memory/filter.ts` is the written definition of each filter shape, down to
why a bare scalar is a case-insensitive substring match rather than an equality
check. It's exported as `matchesFilterValue` and `compareValues`, so you can
call it instead of reimplementing it slightly differently.

---

## Performance

The design goal is that a live update repaints what changed, not the grid.
`src/core/__tests__/render-cost.spec.tsx` measures this by counting per-row
renders through a real `CellComponent`:

- a 100,000-row source mounts fewer than sixty rows on first paint
- inserting a row re-renders no existing row
- deleting a row re-renders no surviving row
- updating one cell re-renders that row and nothing else
- writing a value a cell already holds re-renders nothing at all — the source
  hands back the same array reference and the store's `Object.is` check drops
  the write before a subscriber hears about it

That last one matters more than it sounds if anything in your app restates every
loaded row on a timer.

Subscription is fine-grained: every store-typed prop goes through
`useSyncExternalStore`, and column stats are per column, so a histogram arriving
for one column doesn't re-render the header row. Batches coalesce into a single
notification:

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

These are tests in the repo, not claims. Run them.

---

## Changing data at runtime

`controller.rowSource` takes granular patches:

```ts
controller.rowSource.applyPatch({
  type: 'insert-row',
  row: { id: 'new', name: 'Ada', total: 42 },
});
controller.rowSource.applyPatch({ type: 'insert-row', row, atIndex: 0 });
controller.rowSource.applyPatch({ type: 'delete-row', rowId: 'new' });

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

controller.rowSource.applyPatch({
  type: 'splice-rows',
  startIndex: 10,
  deleteCount: 5,
  rows: replacements,
});
```

Insert, delete and splice keep `totalRows` in step when a total is known.

Columns live in a store on the view model, so changing them is a `set`:

```ts
viewModel.setColumnVisible('note', false); // hidden, but reachable from a chip

viewModel.columns.set(
  viewModel.columns.snapshot().filter((column) => column.id !== 'note')
);

viewModel.columns.set([
  ...viewModel.columns.snapshot(),
  { id: 'margin', header: 'Margin', type: 'number', getValue: (r) => r.margin },
]);
```

The rest of the view model is the same shape all the way down:

```ts
viewModel.resizeColumn('name', 240);
viewModel.reorderColumn('total', 'name'); // move `total` before `name`
viewModel.setSort('total', 'desc');
viewModel.setFilter('status', { kind: 'in', values: ['shipped'] });
viewModel.clearFilters();
```

With a controller attached, changing sorts or filters re-queries on its own.

Everything is a store. Call `snapshot()` for the value now, `subscribe()` for
changes, or `useGridStore()` inside a component:

```ts
import { useGridStore } from '@cotera/griddle';

const status = useGridStore(controller.status); // 'idle' | 'loading' | 'ready' | 'error'
const total = useGridStore(controller.rowSource.totalRows);
const selected = useGridStore(viewModel.selectedRowIds);
```

---

## Theming

Nine tokens are the whole surface:

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

Thirty-nine more tokens sit behind those — the row stripe, three focus-ring
weights, the chart bars, the skeleton pulse — each derived with
`color-mix(in oklab, …)` and each overridable on its own. Ready-made themes ship
at `@cotera/griddle/themes/{light,dark,dark-auto,cotera}.css`.

There are no dark-mode rules in the library. Colour only arrives through those
nine, so `themes/cotera.css` is nine lines of `--dg-bg: var(--background)` and
dark mode follows your app's own `.dark`.

Nothing is defined on `:root`; every custom property lives on `.cotera-griddle`,
and `scripts/build-css.mjs` fails the build if a `:root` or `:host` selector
survives into `dist/style.css`. Drop the stylesheet into a page you don't
control and it can't change anything outside the grid.

One consequence: `DataGrid` puts `.cotera-griddle` on its own root, and a
declaration on an element beats a value inherited from an ancestor. Setting
tokens on a _wrapper_ silently does nothing. Set them on the grid:

```tsx
<DataGrid style={{ '--dg-accent': '#b45309' } as React.CSSProperties} … />
```

or in a rule matching the grid itself (`.dark .cotera-griddle { … }`).

## Overriding components

`CellComponent`, `HeaderComponent`, `RowComponent`, `TopBarComponent` and
`FooterComponent` each replace a default wholesale — no config object, no
seventeen props. Anything you write that paints with `--dg-*` follows the theme
without knowing the theme exists.

---

## Limitations

**Joins need an adapter that sees its whole population.** In-memory and DuckDB
do; the HTTP adapter does not, since the library only ever holds one page. Joins
there mean doing the work server-side or accepting `enrich`. `project` and
`mutate` are DuckDB-only by definition.

**Enriched columns can't be sorted or filtered.** By design. To order by a
column from another source it has to be a `join`, a `project`, or joined before
the data reaches the grid.

**Selection and focus changes re-render the visible window.** Row identity
optimizes data changes; selection is part of the cell context, so clicking a row
re-renders the rows on screen. Virtualization bounds it, but it isn't as
surgical as a row patch.

**No grouping, aggregation or tree data.** No multi-level column headers, no
group-by rows, no rollups, no parent/child hierarchies. Detail panels expand;
children don't.

**No CSV or Excel export.** The SQL clause builders are exported
(`buildWhereSql`, `buildOrderBySql`) so an export can use the exact predicate
the grid is showing, but writing the file is on you.

**No persistence.** Column widths, order, visibility, sorts and filters live in
the view model and vanish on unmount. They're stores, so persisting them is a
`subscribe` and a `set`, but the library won't pick a storage key for you.

**The HTTP adapter has no retry.** A retry policy interacts with the abort on
every sort toggle and with whatever your fetch wrapper already does. Inject
`fetch` and bring your own.

**Text sorts differently between adapters.** DuckDB orders by binary collation;
the in-memory adapter uses `Intl.Collator` with numeric collation, so `item 9`
comes before `item 10` there and after it in DuckDB. Filter _semantics_ agree
exactly, with a test proving it row for row; ordering of mixed case or embedded
digits may not.

**Client-side only.** `ResizeObserver` and `getBoundingClientRect` are
load-bearing. React 18 or 19.

**duckdb-wasm needs setup from you.** Bundle choice, worker hosting and the wasm
URL are yours. `examples/src/duckdb.ts` is a working reference, including the
two URLs that have to be absolute or they 404 in production and only in
production.

Several of these are gaps rather than decisions. If one is in your way, open an
issue.

---

## Development

```bash
bun install
bun run test          # vitest on node, jsdom
bun run typecheck
bun run lint
bun run build         # tsup (js + bundled dts), then scripts/build-css.mjs
bun run check:package # publint + attw

bun run examples:dev         # the demo site
bun run examples:screenshots # visual baseline
```

`bun test` is not the test command. Bun registers happy-dom, and this grid
measures itself through `ResizeObserver`, `IntersectionObserver`,
`getBoundingClientRect` and scroll geometry — precisely where happy-dom and
jsdom disagree. Tests run on node under vitest with jsdom, and the DuckDB oracle
needs node for a native binding anyway.

## Licence

MIT
