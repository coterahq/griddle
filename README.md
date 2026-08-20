<div align="center">

# `@cotera/griddle`

**A React data grid that joins your data sources instead of making you join them first**  
**Parquet on a CDN, a JSON endpoint, an array in memory — one grid, one correct sort**

[![CI](https://github.com/coterahq/griddle/actions/workflows/ci.yml/badge.svg)](https://github.com/coterahq/griddle/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat&labelColor=363D44)](#license)
[![React](https://img.shields.io/badge/React-18%20%7C%2019-blue?style=flat&logo=react&logoColor=b0c0c0&labelColor=363D44)](#quick-start)

**[▶ Live demos — coterahq.github.io/griddle](https://coterahq.github.io/griddle/)**

</div>

---

> A grid can only sort what it can see. Griddle joins your other data sources into
> the query itself, so sorting, filtering and column stats cover the whole dataset
> rather than the page that happened to be loaded.

---

## Table of Contents

- [The Problem](#the-problem)
- [Why Griddle](#why-griddle)
- [What You Get](#what-you-get)
- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [Cross-Source Joins](#cross-source-joins)
- [Adapters](#adapters)
- [Live Demos](#live-demos)
- [Performance](#performance)
- [Griddle vs. TanStack Table](#griddle-vs-tanstack-table)
- [Limitations](#limitations)
- [Development](#development)
- [Documentation](#documentation)
- [License](#license)

---

## The Problem

Say your orders are in a warehouse table and your customer names come from an
API. The usual approach is to fetch a page of orders, look up the names for the
200 rows you got back, and attach them to the rows.

Now sort by customer. The database ordered by order id, not by name, so the sort
runs over those 200 rows in JavaScript. A customer whose order sits on page four
never reaches the top. Nothing throws and nothing looks broken — the list is
simply in the wrong order, and stays that way until someone notices the top of
an A-to-Z list isn't an A.

Filtering has the same shape: filter on a name and you get four matching rows
out of the page, under a footer that still says 20,000. The fix is to join
before paging, so the engine orders the whole population and hands you the
correct page. That is what a `join` layer does, and both the in-memory and
DuckDB adapters implement it.

<div align="right"><kbd><a href="#table-of-contents">↑ Back to top ↑</a></kbd></div>

---

## Why Griddle

You want a configurable, fast data grid that can layer on data from elsewhere —
and change that data at runtime — without sorting, filtering and column stats
quietly going wrong when it does.

> [!NOTE]
> **Best for:** React apps with more rows than one fetch holds, or columns from
> more than one source — warehouse tables, parquet on object storage, JSON
> APIs, in-memory arrays.
>
> **Not for:** pivot tables, tree/grouped rows, server-rendered grids, or
> pixel-level control over every element.

<div align="right"><kbd><a href="#table-of-contents">↑ Back to top ↑</a></kbd></div>

---

## What You Get

- **Cross-source joins that sort correctly** — declare a `join` layer once; the in-memory
  and DuckDB adapters both apply it _before_ paging. _([Layers](./docs/layers.md))_
- **The parts everyone rebuilds** — row and column virtualization, pinned columns, resize
  and reorder, multi-sort with visible priority, filter UI, per-column stats charts that
  filter when you click a bar, inline editing, detail panels, keyboard navigation.
- **One data contract, one required method** — `GridDataSource`. Three adapters ship;
  writing a fourth is an afternoon. _([Adapters](./docs/adapters.md))_
- **A controller that handles the boring bugs** — out-of-order responses dropped, superseded
  queries aborted, rows kept on screen through a refetch.
- **Live updates that repaint a row, not the grid** — granular patches, `React.memo`'d rows,
  a no-op write that costs nothing. _([Performance](./docs/performance.md))_
- **Nine CSS tokens, no `:root` rules** — the build fails if a global selector escapes into
  `dist/style.css`. _([Theming](./docs/theming.md))_
- **A real extraction, not a greenfield library** — every feature exists because an
  application needed it.

<div align="right"><kbd><a href="#table-of-contents">↑ Back to top ↑</a></kbd></div>

---

## How It Works

```
  parquet on a CDN ─┐
  JSON endpoint    ─┼─► layers ─► ONE query ─► page ─► grid
  array in memory  ─┘             (join first, then sort, then page)
                                        ▲
  sort · filter · scroll ── controller ──┘
```

**What the library handles:** the join, the query, paging, cancellation of
superseded requests, virtualization, and repainting only what changed.

**What you write:** a column list, a data source (or one of the shipped
adapters), and a layer for each source you want joined in.

<div align="right"><kbd><a href="#table-of-contents">↑ Back to top ↑</a></kbd></div>

---

## Quick Start

```bash
npm install @cotera/griddle
```

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
controller, no page size — those exist, but you shouldn't have to meet them to
put fifty rows on a screen.

<div align="right"><kbd><a href="#table-of-contents">↑ Back to top ↑</a></kbd></div>

---

## Cross-Source Joins

Declare the other source as a layer:

```ts
import { joinLayer } from '@cotera/griddle/source';

const withUser = joinLayer({
  id: 'user',
  from: { kind: 'rows', rows: users }, // or a SQL relation: a table, a parquet, a JSON file
  on: 'user_id',
  columns: ['name', 'email'],
});
```

**The same object works on both adapters, unchanged:**

```ts
createMemoryDataSource({ rows: orders, columns, layers: [withUser] }); // builds a lookup
createDuckDbDataSource({ query, from, columns, layers: [withUser] }); // compiles a JOIN
```

`name` is now an ordinary column: sortable, filterable, correct across the whole
dataset rather than across the page. `src/duckdb/__tests__/join-oracle.spec.ts`
hands one layer array to both adapters and asserts they return identical rows
across five sort and filter shapes.

> [!IMPORTANT]
> Bring cross-source columns in with a `join` layer — that's what makes them
> sortable and filterable, because the join runs before the page is chosen.
> `enrich`, which staples fields onto a page the source already chose, is the
> fallback for adapters that can't see past one page, and its columns
> **cannot** be sorted or filtered. See
> [`join` is not `enrich`](./docs/layers.md#join-is-not-enrich).

`join` is one of five slots. The others add presentation columns, a live channel
for patching rows on screen, a row detail panel, hand-written SQL projections and
replayable mutations — each with a worked example in
**[docs/layers.md](./docs/layers.md)**.

<div align="right"><kbd><a href="#table-of-contents">↑ Back to top ↑</a></kbd></div>

---

## Adapters

| Import                   | For                                                                        | Joins                                |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------------ |
| `@cotera/griddle/memory` | An array you already have. Also the reference implementation.              | ✅                                   |
| `@cotera/griddle/duckdb` | DuckDB: wasm in a browser, native in Node, anything speaking the same SQL. | ✅                                   |
| `@cotera/griddle/http`   | An HTTP endpoint that pages, sorts and filters server-side.                | ⚠️ `enrich` only — it holds one page |
| `@cotera/griddle/source` | The `GridDataSource` contract and the controller that drives one.          | —                                    |

Each adapter is its own entry point, and the grid itself depends on none of
them. `@cotera/griddle` installs no database driver: `@duckdb/duckdb-wasm` is an
optional peer that only matters if you import `@cotera/griddle/duckdb`, and the
adapter declares the shape it needs structurally rather than importing the
package at all. Setup, capabilities and how to write your own adapter are in
**[docs/adapters.md](./docs/adapters.md)**.

<div align="right"><kbd><a href="#table-of-contents">↑ Back to top ↑</a></kbd></div>

---

## Live Demos

All eight run entirely in your browser at
**[coterahq.github.io/griddle](https://coterahq.github.io/griddle/)**.

| Demo                                                                    | What it proves                                                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [A parquet file](https://coterahq.github.io/griddle/?demo=parquet)      | 20,000 rows in a 177 kB parquet, read over HTTP range requests. Columns come from `describeSource`, not a declaration. |
| [Any CSV](https://coterahq.github.io/griddle/?demo=csv)                 | Paste a CORS-served URL; DuckDB sniffs the delimiter and infers types.                                                 |
| [Three sources](https://coterahq.github.io/griddle/?demo=three-sources) | A parquet, a JSON file and an in-memory array. One query across all three.                                             |
| [600k real rows](https://coterahq.github.io/griddle/?demo=taxi)         | 609,698 NYC taxi trips; zone names live in a 265-row JSON lookup, joined twice. Sorting by zone is a query.            |
| [In memory](https://coterahq.github.io/griddle/?demo=memory)            | 10,000 rows sorted and filtered in JavaScript — the reference semantics.                                               |
| [Over HTTP](https://coterahq.github.io/griddle/?demo=http)              | A real `fetch`; sort twice quickly and watch the first request abort with no error on screen.                          |
| [Theming](https://coterahq.github.io/griddle/?demo=theming)             | Nine tokens, live. Append `&scheme=dark` to any demo.                                                                  |
| [Overrides](https://coterahq.github.io/griddle/?demo=overrides)         | Replacing cell, header, row, top bar and footer components wholesale.                                                  |

<div align="right"><kbd><a href="#table-of-contents">↑ Back to top ↑</a></kbd></div>

---

## Performance

Judge it on the big one:
**[609,698 NYC taxi trips in an 8.7 MB parquet](https://coterahq.github.io/griddle/?demo=taxi)**,
sorted, filtered and joined against a lookup table, entirely in your browser.

Rows and columns are virtualized, and a patch repaints the cells it touched
rather than the viewport. The numbers behind that are asserted in
`src/core/__tests__/render-cost.spec.tsx` and summarised in
**[docs/performance.md](./docs/performance.md)**.

<div align="right"><kbd><a href="#table-of-contents">↑ Back to top ↑</a></kbd></div>

---

## Griddle vs. TanStack Table

| Feature                                   | Griddle                               | [TanStack Table](https://tanstack.com/table) |
| ----------------------------------------- | ------------------------------------- | -------------------------------------------- |
| **Cross-source joins**                    | ✅ `join` layers, sorted in the query | ⚠️ join before the data reaches the grid     |
| **Virtualization**                        | ✅ rows and columns, included         | ⚠️ separate package, wired by you            |
| **Filter UI, column menus, stats charts** | ✅ ships as DOM                       | ⚠️ yours to build, on every project          |
| **Markup and style control**              | ⚠️ component override slots           | ✅ total — it ships no DOM                   |
| **Frameworks**                            | ⚠️ React 18 / 19                      | ✅ React, Vue, Svelte, Solid, Qwik, Lit      |
| **Grouping, aggregation, pivots**         | ❌ not supported                      | ✅ built in                                  |
| **Server rendering**                      | ❌ client only — it measures itself   | ✅ headless, no DOM                          |
| **Bundle size**                           | ⚠️ grid + Radix primitives            | ✅ smaller                                   |

TanStack Table is excellent and we are not trying to talk you out of it: if your
data is small and lives in one place, you will probably be happier with it. The
trade is that a headless library gives you a state machine and leaves the rest —
including the performance characteristics. Griddle takes the other side: the
decisions are in the library, and where you disagree with one you replace the
whole component instead of configuring it.

<div align="right"><kbd><a href="#table-of-contents">↑ Back to top ↑</a></kbd></div>

---

## Limitations

- **Joins need an adapter that sees its whole population** — in-memory and DuckDB do,
  including over a URL (DuckDB reads JSON, CSV and parquet off `https://` directly).
  A server-side pager doesn't: `createHttpDataSource` holds one page, so it gets `enrich`.
- **Enriched columns can't be sorted or filtered** — by design. Add the column with a
  `join` layer instead and it sorts like any other; `enrich` is the fallback for sources
  that can't see past one page.
- **No grouping, aggregation, tree data or multi-level headers** — rows are a flat list.
- **Text sorts differently under the DuckDB adapter** — and only there: it orders by binary
  collation where the in-memory adapter uses `Intl.Collator`, so `item 9` sorts before
  `item 10` in memory and after it in DuckDB. Filter _semantics_ agree exactly, proven row
  for row by a test.
- **Client-side only** — `ResizeObserver` and `getBoundingClientRect` are load bearing.

The reasoning behind each, and when to reach for something else, is in
**[docs/limitations.md](./docs/limitations.md)**.

<div align="right"><kbd><a href="#table-of-contents">↑ Back to top ↑</a></kbd></div>

---

## Development

```bash
bun install
bun run test          # vitest on node + jsdom, 263 specs
bun run typecheck
bun run lint
bun run build         # tsup (js + bundled dts), then scripts/build-css.mjs
bun run check:package # publint + attw

bun run examples:dev         # the demo site
bun run examples:screenshots # visual baseline
```

> [!NOTE]
> `bun test` is not the test command. Bun registers happy-dom, and this grid
> measures itself entirely through `ResizeObserver`, `IntersectionObserver`,
> `getBoundingClientRect` and scroll geometry — precisely where happy-dom and
> jsdom disagree. Use `bun run test`.

<div align="right"><kbd><a href="#table-of-contents">↑ Back to top ↑</a></kbd></div>

---

## Documentation

- **[Layers](./docs/layers.md)** — joins across sources, and a worked example of each of the five slots
- **[Adapters](./docs/adapters.md)** — the controller, DuckDB setup, writing your own source
- **[Runtime changes](./docs/runtime.md)** — row patches, and how a change reaches sorting, filters and the header stats
- **[Theming](./docs/theming.md)** — the nine tokens, the wrapper gotcha, component overrides
- **[Performance](./docs/performance.md)** — what's measured, how, and one confession
- **[Limitations](./docs/limitations.md)** — the full list, and when to use something else

<div align="right"><kbd><a href="#table-of-contents">↑ Back to top ↑</a></kbd></div>

---

## License

MIT. Issues and pull requests: **[github.com/coterahq/griddle](https://github.com/coterahq/griddle/issues)**.
