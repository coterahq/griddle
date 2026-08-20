# Limitations

<kbd><a href="../README.md">← README</a></kbd>

**Joins need an adapter that sees its whole population.** In-memory and DuckDB
both do — including when the data lives behind a URL, since DuckDB reads JSON,
CSV and parquet over HTTP and a `fetch` you run yourself becomes
`{ kind: 'rows' }`. `createHttpDataSource` does not: it pushes sort and filter
to the server and holds one page, so joins there mean doing the work
server-side or accepting `enrich`, whose columns can't be sorted. `project` and
`mutate`, the hand-written SQL slots, remain DuckDB-only by definition.

**Enriched columns can't be sorted or filtered.** By design, and
[enforced three ways](./layers.md#join-is-not-enrich) — but this is a narrower
limitation than it sounds, because `enrich` is not how you add a column from
another source. A [`join` layer](./layers.md) is, and a joined column is
ordinary: sortable, filterable, and correct across the whole dataset, on the
in-memory and DuckDB adapters alike. `project` does the same on DuckDB for what
a declaration can't express. `enrich` is what's left when the adapter genuinely
cannot see the whole population — a server-side pager — and losing sort and
filter is the price of that.

**Selection and focus changes re-render the visible window.** Row identity
optimizes data changes. Selection is part of the cell context, so clicking a row
re-renders the rows on screen. Virtualization bounds it, but it isn't as
surgical as a row patch.

**No grouping, aggregation, or tree data.** No multi-level column headers, no
group-by rows, no rollups, no parent/child hierarchies. Detail panels expand;
children don't.

**Text sorts differently under the DuckDB adapter.** Only a concern if you use
it. DuckDB orders by binary collation; the in-memory adapter uses
`Intl.Collator` with numeric collation, so `item 9` comes before `item 10` there
and after it in DuckDB. Filter _semantics_ agree exactly and there's a test
proving it row for row. Ordering of mixed case or embedded digits may not.

**Client-side only.** `ResizeObserver` and `getBoundingClientRect` are load
bearing. React 18 or 19.

**duckdb-wasm needs setup from you.** Bundle choice, worker hosting, and the
wasm URL are yours. `examples/src/duckdb.ts` is a working reference.

---

## When to use something else

**You want to control every pixel.** Use [TanStack Table](https://tanstack.com/table).
It's headless, smaller, framework-agnostic and excellent, and if your data is
small and lives in one place you will probably be happier with it.

The trade is that a headless library gives you a state machine and leaves the
rest. Virtualization is a separate package you wire up yourself. Filter UI, sort
affordances, column menus, resize handles, cell editors, stats charts: all
yours, every time, on every project. And the performance characteristics become
your responsibility. A `columns` array rebuilt inline on each render, a cell
renderer that forgot to memoize, a missing `getRowId` that makes row selection
index-based so it breaks the moment someone sorts — none of these throw. The
grid just gets sluggish somewhere north of a few thousand rows and you find out
from a user. It's all documented and all avoidable, but it's knowledge every
person who touches the file has to be carrying.

Griddle takes the other side of that trade. The decisions are in the library,
and where you disagree with one you replace the whole component instead of
configuring it.

**Your rows are grouped, nested, or aggregated.** There's no group-by, no
rollup rows, no tree data, no multi-level column headers. If you need a pivot
table, this is not a pivot table.

**You need it to render on a server.** It measures itself with `ResizeObserver`
and `getBoundingClientRect`. It is a client component and it will stay one.

**Your data only ever arrives one page at a time.** Note that this is about
pagination, not ownership. An endpoint you don't control is fine as long as
something can read it whole: DuckDB will `read_json_auto`, `read_csv` or
`read_parquet` straight off an `https://` URL (CORS permitting, since the fetch
happens in the browser), and anything you can `fetch` yourself can be handed
over as `{ kind: 'rows' }`. The three-sources demo does both. What breaks joins
is a server-side pager — if the API only ever hands you page N of a result it
ordered, the adapter is holding one page, and the best it can do is `enrich`.

**You found a bug or a missing feature.** Please
[open an issue](https://github.com/coterahq/griddle/issues). Several of the
items above are gaps rather than decisions, and we'd rather know which ones are
in your way.
