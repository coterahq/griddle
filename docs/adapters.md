# Adapters and the controller

<kbd><a href="../README.md">← README</a></kbd>

| Import                   | For                                                                        |
| ------------------------ | -------------------------------------------------------------------------- |
| `@cotera/griddle/memory` | An array you already have. Also the reference implementation.              |
| `@cotera/griddle/duckdb` | DuckDB: wasm in a browser, native in Node, anything speaking the same SQL. |
| `@cotera/griddle/http`   | An HTTP endpoint.                                                          |
| `@cotera/griddle/source` | The `GridDataSource` contract and the controller that drives one.          |

---

## The controller

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

Four things in there are worth more than they look:

- **Generation counters.** Toggle a sort twice quickly and the first response
  lands second: it gets dropped instead of painted.
- **Aborts are successes.** Superseded queries are aborted and the resulting
  `AbortError` is swallowed, because it means the newer query won. Wire up
  cancellation without this and an error banner flashes every time a user clicks
  impatiently.
- **Rows stay on screen** through a refetch instead of blanking.
- **A filter change invalidates column stats; a sort change doesn't**, because
  sorting reorders the same population.

The controller subscribes to `viewModel.sorts` and `viewModel.filters`
directly, so `onSortChange` and `onFilterChange` stay yours for analytics or
URL sync.

---

## The library doesn't own DuckDB

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

`examples/src/duckdb.ts` is a working reference, including the two URLs that
have to be absolute or they 404 in production and only in production.

---

## Writing your own adapter

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

  // Optional. Declare it when your API only sorts by certain fields. Most
  // APIs accept a fixed set and ignore the rest, which means the grid draws a
  // sort arrow, the backend returns its default order, and the user reads a
  // list they believe is sorted. Omit it to mean "any column".
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
disabled. Columns outside the set are marked unsortable on the view model, so
the header stops offering a control that cannot work.

### Two things to get right

**Forward the `signal`.** The controller aborts superseded queries, and an
adapter that ignores it leaves every abandoned request running to completion.

**Interpret filters the way the in-memory adapter does.**
`src/memory/filter.ts` is the written definition of what each filter shape
means, down to why a bare scalar is a case-insensitive substring match and not
an equality check. It's exported as `matchesFilterValue` and `compareValues`, so
you can call it instead of reimplementing it slightly differently and spending
an afternoon on why your grid disagrees with itself.
