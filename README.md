<div align="center">

# `@cotera/griddle`

**A React data grid that joins your data sources instead of making you join them first**  
**Parquet on a CDN, a JSON endpoint, an array in memory — one grid, one correct sort**

[![CI](https://github.com/coterahq/griddle/actions/workflows/ci.yml/badge.svg)](https://github.com/coterahq/griddle/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat&labelColor=363D44)](#license)
[![React](https://img.shields.io/badge/React-18%20%7C%2019-blue?style=flat&logo=react&logoColor=b0c0c0&labelColor=363D44)](#quick-start)
[![DuckDB](https://img.shields.io/badge/DuckDB-wasm%20%7C%20native-blue?style=flat&logo=duckdb&logoColor=b0c0c0&labelColor=363D44)](#adapters)

**[▶ Live demos — coterahq.github.io/griddle](https://coterahq.github.io/griddle/)**

</div>

---

> Fetch a page of orders, look up the customer names, staple them onto the rows. It ships.  
> Then someone clicks **sort by customer** — and gets the page they already had, reordered.  
> No error, no empty state. Just quietly wrong.

---

## Table of Contents

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

## Why Griddle

### Ask yourself these questions:

- Do your grid columns come from more than one place — a warehouse, an API, a config service?
- Have you shipped a sort that only reorders the page the user already had?
- Do you have more rows than fit in one fetch?
- Are you about to hand-roll virtualization, filter UI, column stats and cell editing again?
- Do you want a column from another source to be sortable and filterable, correctly?

**If you answered yes to two or more — Griddle is worth your time.**

Pushing the join into the query is the correct fix and everybody knows it. The
reason it doesn't happen is that it's a week of work: sort state has to reach
the query builder, the query builder has to know about the join, and now you own
paging, cancellation, and the bug where a slow first request lands after a fast
second one. This library is that week, already done.

> [!NOTE]
> **Best for:** React apps showing more rows than one fetch holds, or columns
> that come from more than one source — warehouse tables, parquet on object
> storage, JSON APIs, in-memory arrays.
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

<div align="right"><kbd><a href="#table-of-contents">↑ Back to top ↑</a></kbd></div>

---

## Adapters

| Import                   | For                                                                        | Joins                                |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------------ |
| `@cotera/griddle/memory` | An array you already have. Also the reference implementation.              | ✅                                   |
| `@cotera/griddle/duckdb` | DuckDB: wasm in a browser, native in Node, anything speaking the same SQL. | ✅                                   |
| `@cotera/griddle/http`   | An HTTP endpoint that pages, sorts and filters server-side.                | ⚠️ `enrich` only — it holds one page |
| `@cotera/griddle/source` | The `GridDataSource` contract and the controller that drives one.          | —                                    |

The library doesn't own DuckDB: bundle choice, worker hosting and CSP are
properties of your deployment, so you pass in a query function. There's no
`apache-arrow` dependency either — `{ toArray(): unknown[] }` is the entire type
surface. Full detail, plus how to write your own adapter, in
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

The design goal is that a live update repaints what changed and not the grid.
Every number below is asserted in `src/core/__tests__/render-cost.spec.tsx`,
counting per-row renders through a real `CellComponent`.

| Change                             | Cost                        |
| ---------------------------------- | --------------------------- |
| 100,000-row source, first paint    | fewer than 60 rows mounted  |
| Insert a row                       | no existing row re-renders  |
| Delete a row                       | no surviving row re-renders |
| Update one cell                    | that row, nothing else      |
| Write a value a cell already holds | **nothing re-renders**      |
| 200 patches applied as a batch     | one notification            |

Nine of those tests exist because the first version of this section was wrong
and the test caught it — the story is in
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

- **[Layers](./docs/layers.md)** — joins across sources, the five slots, `join` vs `enrich`
- **[Adapters](./docs/adapters.md)** — the controller, DuckDB setup, writing your own source
- **[Runtime changes](./docs/runtime.md)** — row patches, columns, the view model, stores
- **[Theming](./docs/theming.md)** — the nine tokens, the wrapper gotcha, component overrides
- **[Performance](./docs/performance.md)** — what's measured, how, and one confession
- **[Limitations](./docs/limitations.md)** — the full list, and when to use something else

<div align="right"><kbd><a href="#table-of-contents">↑ Back to top ↑</a></kbd></div>

---

## License

MIT. Issues and pull requests: **[github.com/coterahq/griddle](https://github.com/coterahq/griddle/issues)**.
