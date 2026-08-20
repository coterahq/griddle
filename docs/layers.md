# Layers

<kbd><a href="../README.md">← README</a></kbd>

A layer is one thing laid over a data source. There are five slots, and the
difference between two of them is the whole design.

| Slot      | Available on                               | What it does                                                                      |
| --------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `join`    | any adapter that sees its whole population | Bring columns across from another relation, before paging                         |
| `present` | any adapter                                | Leading grid columns, a live channel for patching loaded rows, a row detail panel |
| `enrich`  | any adapter                                | Attach fields to an already-fetched page from somewhere else                      |
| `project` | `/duckdb`                                  | Hand-written SQL projection, for what `join` can't express                        |
| `mutate`  | `/duckdb`                                  | Statements against a materialized table; can `ALTER`, can replay an edit log      |

---

## Joining two JSON blobs

You have `orders` and `users` as two arrays, and you want the customer's name to
be a real column: one you can sort by, filter on, and get correct answers from.

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

Then hand it to whichever adapter you're using. **The same object works on
both**, unchanged:

```ts
// In memory: builds a lookup and attaches the fields to the whole array
// before anything is filtered, sorted or paged.
createMemoryDataSource({ rows: orders, columns, layers: [withUser] });

// DuckDB: compiles a JOIN into the page query.
createDuckDbDataSource({ query, from, columns, layers: [withUser] });
```

`name` is now an ordinary column. Sort by it and you get the right rows out of
the whole dataset, because both adapters applied the join _before_ choosing a
page. That property has nothing to do with having a query engine — it needs the
adapter to be able to see everything, which an array and a database both can.

`src/duckdb/__tests__/join-oracle.spec.ts` hands one layer array to both
adapters and asserts they return identical rows across five sort and filter
shapes. If they ever disagree about what a join means, it fails.

---

## When you'd reach for DuckDB anyway

Scale, mostly. A `{ kind: 'rows' }` relation is a lookup table you already have
in memory; past a few thousand rows on the left-hand side you want the engine.
Point it at a parquet and the same layer still applies:

```ts
const from = await registerParquetSource(query, { name: 'orders', url });
createDuckDbDataSource({ query, from, columns, layers: [withUser] });
```

DuckDB fetches only the row groups the query touches, over HTTP range requests,
so a 200 MB file on a CDN costs a few hundred kB to sort. The demo does this
with 20,000 orders in a 177 kB parquet, and again with 609,698 NYC taxi trips in
an 8.7 MB one — the second is the same code and a better argument, because the
join it needs is one the TLC's schema imposed rather than one we chose. See
`scripts/build-taxi-fixture.mjs` for where that data comes from.

For data already in the warehouse, `from` also takes a bare string (or
`{ kind: 'sql' }`), which is a relation only an engine can read:

```ts
joinLayer({ id: 'user', from: 'users', on: 'user_id', columns: ['name'] });
```

The in-memory adapter throws on that one, with a message saying why.

---

## `join` is not `enrich`

A joined column is applied before the page is chosen. `WHERE` and `ORDER BY`
reach it the same way they reach a native column, so sorting by it is correct.
(`project` is the same thing written by hand in SQL, for the cases the
declaration can't express.)

An enriched column is stapled onto a page the source already chose. Sorting by
one could only ever reorder that page. Filtering by one would leave you with
four rows and a footer confidently claiming 20,000.

So enriched columns can't be sorted or filtered, and that isn't left to a
paragraph in a doc:

- The `EnrichedColumn` type removes both keys, so a layer can't ask for them.
- `LayerStack` sets them to `false` on the way out.
- `withLayers` drops any sort or filter that reaches one anyway, and warns in
  development with the column's name in the message.

Three layers of belt for one pair of trousers, because a silently wrong sort
order is the worst thing this library could do to you.

### Which one to reach for

**Use `join`.** It is the way to add a column from another source, and it is
available on every adapter that can see its whole population — in-memory and
DuckDB, including when the relation lives behind an `https://` URL. The column
that comes back is ordinary: sort it, filter it, click a bar in its stats chart.

**Use `project`** on DuckDB when the relationship is something a declarative
join can't express and you want to write the SQL yourself. Same guarantee: the
engine sees the column, so ordering by it is real.

**Use `enrich` only when neither is possible** — the adapter is holding one page
because the server chose it, and there is nowhere for a join to happen. Its
columns are display-only by construction, which is the honest version of the
result rather than a sort that reorders a page and looks like it worked.
