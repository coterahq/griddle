# `@cotera/data-grid`

A React data grid that **joins multiple data sources into one view**.

Point it at a parquet on S3, a JSON API and an in-memory array; get one grid
with real cross-source sort and filter — one query across all of them, not a
reordering of whatever page happened to be loaded.

Virtualized rows and columns, column pinning, resize and reorder, multi-sort,
structured filters, column stats charts, cell editing, row detail panels and
keyboard navigation. No domain types anywhere in it.

```bash
npm install @cotera/data-grid
```

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
    <DataGrid
      rows={rows}
      columns={columns}
      viewModel={viewModel}
      getRowId={(r) => r.id}
    />
  );
}
```

`rows` takes a plain array. Nothing above requires learning what a store, a
page or an abort controller is — those exist underneath and are load-bearing,
but not at the front door.

## The pitch: layers

A **layer** is one thing laid over a data source. Four slots, and the
difference between two of them is the whole design:

| Slot      | Works with  | What it does                                                                      |
| --------- | ----------- | --------------------------------------------------------------------------------- |
| `present` | any adapter | Leading grid columns, a live channel for patching loaded rows, a row detail panel |
| `enrich`  | any adapter | Attach fields to an already-fetched page from somewhere else                      |
| `project` | SQL only    | Extra columns at read time, via `JOIN` from another source                        |
| `mutate`  | SQL only    | Statements against a materialized table; can `ALTER`, can replay an edit log      |

```ts
import { createDuckDbDataSource, joinLayer } from '@cotera/data-grid/duckdb';

const source = createDuckDbDataSource({
  query,
  from: orders,
  columns,
  layers: [
    joinLayer({
      id: 'user',
      from: users,
      on: 'user_id',
      columns: ['name', 'email'],
    }),
    joinLayer({
      id: 'flags',
      from: flags,
      on: 'order_id',
      columns: ['is_flagged'],
    }),
  ],
});
```

Sorting by `name` or filtering on `is_flagged` issues **one** DuckDB query
across all three sources.

### `project` is not `enrich`

A **projected** column is part of the query, so the grid's own `WHERE` and
`ORDER BY` address it exactly like a native one.

An **enriched** column is stapled onto a page the source already chose. Sorting
by it could only reorder _that page_ — which looks like it worked — and
filtering by it would leave a short page beside a total that disagrees. So
enriched columns are not sortable or filterable, and that is enforced three
ways: the type removes both keys, the stack sets them `false`, and the source
wrapper drops any sort or filter that reaches one anyway with a dev warning.

Silent wrong ordering is the worst outcome available here, so it is not left to
documentation.

## Adapters

| Import                     | For                                                                         |
| -------------------------- | --------------------------------------------------------------------------- |
| `@cotera/data-grid/memory` | An array you already have. Also the reference implementation.               |
| `@cotera/data-grid/duckdb` | DuckDB — wasm in a browser, native in Node, anything speaking the same SQL. |
| `@cotera/data-grid/http`   | An HTTP endpoint.                                                           |
| `@cotera/data-grid/source` | The `GridDataSource` contract and the controller that drives one.           |

`createGridController` handles paging, aborts, stale-response ordering and
stats invalidation:

```ts
import { createGridController } from '@cotera/data-grid/source';
import { createMemoryDataSource } from '@cotera/data-grid/memory';

const controller = createGridController({
  source: createMemoryDataSource({ rows, columns }),
  viewModel,
  getRowId: (row) => row.id,
});

<DataGrid {...controller.gridProps} viewModel={viewModel} getRowId={(r) => r.id} />;
```

It subscribes to `viewModel.sorts` and `viewModel.filters` directly rather than
through `onSortChange` / `onFilterChange`, so those callbacks stay free for
analytics or URL sync.

### The library does not own DuckDB

Bundle selection, worker hosting and CSP differ per deployment — GitHub Pages
cannot set COOP/COEP, so the same app needs a non-threaded bundle there and a
threaded one behind its own server. So you inject a query function:

```ts
import { createDuckDbWasmQuery } from '@cotera/data-grid/duckdb';
const query = createDuckDbWasmQuery(db);
```

There is no `apache-arrow` dependency. `{ toArray(): unknown[] }` is the entire
type surface, which an Arrow `Table` satisfies structurally.

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
`.cotera-data-grid`, and the build fails if a single `:root` or `:host`
selector survives into `dist/style.css` — so dropping this into a page you do
not control cannot change anything outside the grid.

## Overriding components

`CellComponent`, `HeaderComponent`, `RowComponent`, `TopBarComponent` and
`FooterComponent` replace the defaults wholesale rather than taking a config
object — a small number of total replacements instead of a large number of
options that each need documenting and keeping working. Overrides painting with
`--dg-*` follow the theme without knowing it exists.

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

`bun test` is not the test command: it registers happy-dom, and the grid
measures itself entirely from `ResizeObserver` / `IntersectionObserver` with
heavy `getBoundingClientRect` and scroll geometry — exactly where the two DOM
shims diverge.

## Licence

MIT
