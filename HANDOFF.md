# `@cotera/data-grid` — handoff

You are picking up a library extraction mid-flight. **L0 and L1 are done and green.**
This document is the whole context: the repo is self-contained and you do not need the
Cotera checkout for anything below.

---

## What this is

A React data grid extracted from `apps/client/src/app/components/ui/data-grid/` in the
Cotera monorepo, being turned into a standalone public npm package. ~7,500 lines of grid —
virtualization, column pinning/resize/reorder, multi-sort, structured filters, column stats
charts, cell editing, row detail panels, keyboard nav — with **zero domain types in it**.

**The differentiating feature is layers: joining multiple data sources into one grid.**
That is the pitch and the reason anyone would pick this over TanStack Table. Point it at a
parquet on S3, a JSON API and an in-memory array; get one grid with _real cross-source sort
and filter_. Do not let that get deprioritised — it is L4/L5 and it is the product.

Scope right now is **the library only**. Nothing in `~/work/cotera` gets touched. See
[Phase 2](#phase-2--the-cotera-cut-over-not-scheduled) for why it is still described here.

---

## Current state

| Commit    | What                                                                                    |
| --------- | --------------------------------------------------------------------------------------- |
| `a62efd7` | `vendor:` raw unmodified import from Cotera @ `39d72dafc`, so the rewrite is bisectable |
| `e33f263` | `chore:` repo skeleton + `src/store` (L0)                                               |
| `8ba1802` | `refactor:` decouple from Cotera (L1)                                                   |

Green: `lint`, `typecheck`, `test` (83 specs), `build`, `publint`, `attw` (all four
resolution modes).

```
src/
  index.ts        the package entry ("@cotera/data-grid")
  core/           the grid — decoupled, tested, done
  store/          createGridStore / derivedGridStore / useGridStore
  ui/             vendored primitives: cn, icons, tooltip, dialog,
                  dropdown-menu, controls, portal, modal-host, theme-scope
  internal/       assert
  source/layers/  ⚠ STILL VERBATIM COTERA IMPORTS — L4
  duckdb/         ⚠ STILL VERBATIM COTERA IMPORTS — L5
  memory/ http/   empty, L3 and L6
test/             setup.ts (observer stubs), modal-host.tsx (test host)
```

`src/source/layers` and `src/duckdb` are excluded from `tsconfig.json`,
`tsconfig.build.json`, `vitest.config.ts` and `eslint.config.js`. **Remove each exclusion
in its own milestone** — there are four places, they must all be updated together.

```bash
bun install
bun run test            # vitest, jsdom
bun run typecheck
bun run lint
bun run build           # tsup (js + bundled dts) then scripts/build-css.mjs
bun run check:package   # publint + attw --pack
```

---

## Ground rules

1. **Do not rewrite imported source to satisfy a lint rule.** The extraction's whole
   defence is that it is behaviour-preserving. If `strictTypeChecked` flags imported code,
   relax the rule in `eslint.config.js` with a comment explaining why — six rules are
   already relaxed that way, each with rationale. Rewriting during the move is what costs
   the argument.
2. **Specs are the contract.** The seven ported spec files under `src/core/__tests__/` are
   Cotera's, with only import lines changed. Do not "improve" their assertions. Add new
   specs in new files.
3. **Bun for install and scripts; vitest-on-node for tests.** `bun test` registers
   happy-dom, and the grid measures itself entirely from `ResizeObserver` /
   `IntersectionObserver` with heavy `getBoundingClientRect` and scroll geometry — exactly
   where the two DOM shims diverge. Versions of vitest/jsdom/@testing-library are pinned to
   match Cotera deliberately.
4. **Every new portal goes through `DataGridThemeScope`.** See [traps](#traps).
5. Conventional commits. Explicit `=== undefined` comparisons, exhaustive switches with
   `unreachable()` from `src/internal/assert`, `toMatchObject()` in tests, never cast to
   `any`/`unknown`.

---

## Verified facts — do not re-derive these

Each of these cost real digging or was corrected by evidence mid-flight.

1. **`{ snapshot; subscribe; set }` is a strict structural subset of Cotera's `Watchable`.**
   That is why the store contract is drawn this small: an app already holding `Watchable`s
   passes them into the grid with no adapter. `src/store/store.spec.ts` asserts it against a
   `Watchable`-shaped mock — if that stops compiling, the boundary has grown and a migration
   just became a wrapper-writing exercise. **Do not add members to `ReadonlyGridStore`.**
2. **`derivedGridStore` must watch its dependencies from construction, not from first
   listener.** React calls `getSnapshot` _during render_, before subscribing, so the cache
   cannot be conditional on being subscribed. Getting this wrong produces "The result of
   getSnapshot should be cached to avoid an infinite loop" on any object-returning compute.
   It also needs a baseline seeded on first `subscribe`, or the first dependency change
   notifies even when the computed value is unchanged. Both are tested.
3. **Declarations come from tsup's bundled dts, not `tsc`.** `rollup-plugin-dts` does _not_
   mangle `DataGridColumn<TRow, TValue, TMeta>` or its four render-prop callbacks — checked
   in the emitted output. `tsc`'s per-file emit _fails_ `attw`, because extensionless
   relative imports in `.d.ts` are unresolvable under node16 from ESM. Bundling leaves no
   internal imports to resolve.
4. **The exports map needs types nested per condition** (`import.types` → `.d.ts`,
   `require.types` → `.d.cts`) _plus_ legacy `main`/`module`/`types` for node10. A flat
   `types` key makes `attw` report "masquerading as ESM". `dist/index.d.cts` is produced by
   tsup, not by a copy step.
5. **No `@vitejs/plugin-react` in `vitest.config.ts`.** Vitest resolves its own nested Vite,
   so a plugin built against the top-level one is a structurally different `Plugin` type and
   will not typecheck. Tests only need the esbuild JSX transform, which reads
   `jsx: "react-jsx"` from tsconfig. The examples app gets its own Vite config and does use
   the plugin.
6. **Tailwind 4.3 compiles `bg-primary/10` to
   `color-mix(in oklab, var(--color-primary) 10%, transparent)`.** Deriving `--dg-*` alpha
   tokens with that identical expression is what makes pixel parity a claim rather than a
   hope. Same function, colour space, percentage, second operand.
7. **Zero interpolated `className` strings in the grid.** Every class is a static literal,
   so Tailwind `@source` scanning is complete and no safelist is needed.
8. **`sort-asc` mapped to a Z→A glyph and `sort-desc` to A→Z in the original** — inverted.
   Corrected in `src/ui/icons.tsx` with a comment. Deliberate divergence.

---

## L2 — theming

The one milestone that touches nearly every file. **Do it before L3+**, so later work is
written against the final class vocabulary.

### Census (measured in this repo, not estimated)

**153 colour sites across 14 files**, 42 distinct utilities, over exactly 9 shadcn
semantics. Top of the distribution:

```
text-muted-foreground 24   border-border 17   bg-background 16   text-foreground 10
bg-muted 9   bg-primary/10 6   text-muted-foreground/60 5   bg-primary 5   text-primary 4
… then a long tail of alpha variants: /5 /15 /20 /30 /40 /45 /50 /60 /70 /80 /90 /[0.06]
```

Regenerate with:

```bash
grep -rhoE "\b(bg|text|border|ring|border-t|border-l)-(background|foreground|muted|muted-foreground|border|primary|primary-foreground|popover|popover-foreground)(\/(\[[0-9.]+\]|[0-9]+))?" src/core src/ui | sort | uniq -c | sort -rn
```

### Two-tier tokens

**Tier 1 — nine base tokens**, the only thing a themer must supply:

```
--dg-bg  --dg-fg  --dg-muted  --dg-muted-fg  --dg-border
--dg-accent  --dg-accent-fg  --dg-popover  --dg-popover-fg
```

**Tier 2 — one role token per `(semantic, alpha)` pair** in the census, derived in the
library's base layer and each individually overridable:

```css
@layer base {
  .cotera-data-grid {
    --dg-row-hover-bg: color-mix(in oklab, var(--dg-muted) 40%, transparent);
    --dg-row-selected-bg: color-mix(
      in oklab,
      var(--dg-accent) 10%,
      transparent
    );
    --dg-cell-selected-bg: color-mix(
      in oklab,
      var(--dg-accent) 15%,
      transparent
    );
    --dg-cell-dirty-bg: color-mix(in oklab, var(--dg-accent) 6%, transparent);
    --dg-focus-ring: color-mix(in oklab, var(--dg-accent) 70%, transparent);
    --dg-bar-track: color-mix(in oklab, var(--dg-muted-fg) 10%, transparent);
    /* …one per pair; plus --dg-radius, --dg-font-size{,-sm,-xs}, --dg-cell-padding-x */
  }
}
```

### Rewrite shape

```diff
- 'border-b border-r border-border/70 bg-background'
- 'data-[focused=true]:ring-2 data-[focused=true]:ring-inset data-[focused=true]:ring-primary/70'
- 'data-[cell-selected=true]:bg-primary/15'
+ 'border-b border-r border-(color:--dg-border-subtle) bg-(--dg-surface)'
+ 'data-[focused=true]:ring-2 data-[focused=true]:ring-inset data-[focused=true]:ring-(color:--dg-focus-ring)'
+ 'data-[cell-selected=true]:bg-(--dg-cell-selected-bg)'
```

Two rules, **both fail silently**, so make them review checklist items:

- **The `(color:…)` data-type hint is mandatory on `text-`, `border-` and `ring-`** — those
  families are ambiguous between colour and size/width. `bg-(--x)` needs no hint.
- **Never put an opacity modifier on an arbitrary var** (`bg-(--dg-accent)/10`). Bake every
  alpha into its own tier-2 token. That is what makes the `color-mix` parity argument hold.

Geometry stays in TypeScript (`DEFAULT_ROW_HEIGHT=36`, `DEFAULT_HEADER_HEIGHT=40`,
`DATA_GRID_ROW_NUMBER_WIDTH=52`, `DEFAULT_COLUMN_WIDTH=160`) because virtualization
arithmetic needs it — but mirror them onto the root as inline style (`--dg-row-height` etc.)
so CSS decorations can reference them.

### CSS build

`scripts/build-css.mjs` already exists and currently no-ops with a message. It expects:

- `styles/grid.css` — imports `tailwindcss/theme.css` + `tailwindcss/utilities.css`
  **separately, never `@import "tailwindcss"`** (that pulls preflight, which would reset the
  host page), then `@source "../src/**/*.{ts,tsx}"`, then the `@layer base` token block.
- `styles/themes/{cotera,light,dark,dark-auto}.css`.

The script rescopes Tailwind's `@layer theme { :root, :host { … } }` to `.cotera-data-grid`
and **hard-fails the build if any `:root`/`:host` selector survives**. That assertion is the
guarantee that the library never leaks globals into a host page.

Restore the `./style.css` and `./themes/*.css` entries in `package.json` `exports` when the
files exist.

### Dark mode

The library emits **no** dark-mode rules. Colour comes only from `--dg-*`, so
`themes/cotera.css` is nine lines of `--dg-bg: var(--background)` and dark mode follows the
host's own `.dark` through variable indirection, for free. Ship `light.css` + `dark.css`
(class strategy) and `dark-auto.css` (`prefers-color-scheme`) for hosts without tokens.

### Exit gate

Specs still green (spot-check `data-grid-stats.spec.tsx` — the most class-heavy — that it
asserts on roles and text, not class names). `dist/style.css` has zero `:root`/`:host`.
Scaffold `examples/` here as the visual baseline and capture screenshots at light + dark;
they are the before/after for this milestone.

---

## L3 — `GridDataSource`, controller, `/memory`

```ts
export type GridQuery = {
  offset: number;
  limit: number;
  sorts: DataGridSort[];
  filters: DataGridFilter[];
  signal?: AbortSignal;
};
export type GridDataSource<TRow> = {
  loadPage(q: GridQuery): Promise<{ rows: TRow[]; total: number | null }>;
  loadColumnStats?(i: {
    columnId: string;
    filters: DataGridFilter[];
    signal?: AbortSignal;
  }): Promise<DataGridColumnStats>;
  loadTotal?(i: {
    filters: DataGridFilter[];
    signal?: AbortSignal;
  }): Promise<number | null>;
};
```

`createGridController({ source, viewModel, getRowId, pageSize = 200 })` →
`{ rowSource, columnStats, status, error, gridProps, refresh, dispose }`.

**It subscribes to `viewModel.sorts` / `viewModel.filters` directly**, not to
`onSortChange` / `onFilterChange` — it already owns those stores, so it needs no prop
wiring, and the host's callbacks stay free for analytics or URL sync. That is why
`gridProps` is only two keys.

Behaviours that must be there (all learned the hard way in the original 861-line host):

- Generation counter, discarding stale responses from rapid sort toggling.
- One `AbortController` per generation, with **`AbortError` swallowed rather than surfaced
  as `error`** — the single most common bug in hand-rolled versions of this.
- `isLoading` re-entrancy guard on `loadMore`.
- `hasMore` inference: `total === null ? rows.length === pageSize : loaded < total`.
- Error path empties once (`rows=[]`, `total=0`, `hasMore=false`) rather than clearing then
  failing.
- Rows stay mounted during a refetch.
- Stats invalidated on a _population_ change (filters), not on sort.

**`/memory` is the reference implementation and the oracle for L5.** It must handle every
`DataGridFilterValue` shape typed by `column.type`: bare scalar (substring, mirroring
DuckDB's `::VARCHAR ILIKE '%x%'`), `{kind:'in'}` with explicit `null` handling,
`{kind:'between'}` with `inclusiveMax`, and `{kind:'compare'}` across all nine comparisons.
Multi-key stable sort, `Intl.Collator` for text, nulls last by default.

**API softening to do here:** `DataGridProps.rows` is store-typed, so even "here are 50
rows" forces a consumer to build a store. Widen to `TRow[] | ReadonlyGridStore<TRow[]>`
(same for `columnStats`) so a casual user never meets the concept. Not done at L1 because
that milestone was explicitly no-API-change.

---

## L4 — layers in core

`src/source/layers/{types,stack,index}.ts` are sitting there verbatim, with excellent
docstrings. Read them first — the design is good and worth preserving.

Today `DuckDbSourceLayer<TRow>` has three slots. Two are SQL-specific and one is not, and
that split is the whole restructure:

| Slot      | Engine                  | What it does                                                                                                                                            |
| --------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `present` | **any adapter**         | Grid columns laid ahead of the source's own, a live `subscribe(grid)` channel for patching loaded rows, a row detail panel. Pure React + grid concepts. |
| `enrich`  | **any adapter** — _new_ | Given a loaded page, attach fields per row from another source. The non-SQL join.                                                                       |
| `project` | SQL                     | Extra columns at read time via JOIN from a side table                                                                                                   |
| `mutate`  | SQL                     | Statements against a materialized table; can `ALTER` schema, replay an edit log                                                                         |

So `present` + `enrich` move to core (`src/source/`), and `project` + `mutate` stay with the
SQL adapter. `DuckDbLayerStack` splits into a generic `LayerStack` and a `SqlLayerStack`
extending it with `materialize()` and `wrapSource()`.

**Be loud in the docs about the difference.** `project` joins in SQL, so the grid's own
`WHERE`/`ORDER BY` address joined columns exactly like native ones. `enrich` attaches fields
to an already-fetched page, so **you cannot sort or filter on an enriched column** — the
grid holds one page of a result it did not run. Make that a type error if cheap, a dev-mode
warning if not. Silent wrong ordering is the worst possible outcome.

`src/source/layers/__tests__/layers.spec.ts` ports as-is and is the regression net — it
already covers alias minting for two instances of the same layer kind, the
base-first-but-columns-reversed ordering rule, and first-wins row-detail ownership.

---

## L5 — `/duckdb`, the join engine

Already imported and waiting: `src/duckdb/{sql,arrow,query-sql,stats,source-sql}.ts` plus
`__tests__/query-sql.spec.ts`.

**The library does not own DuckDB setup** — bundle selection, worker hosting and CSP are the
host's business. Inject a query function:

```ts
type DuckDbQueryResult = { toArray(): unknown[] };   // apache-arrow Table satisfies this
createDuckDbDataSource<TRow>({ query, from, columns, mapRow?, defaultOrderBy?, stats?, layers? })
createDuckDbWasmQuery(db: AsyncDuckDB)   // convenience; dynamic import of the optional peer
```

**No `apache-arrow` dependency** — the structural type above is all that is needed, and a
600 kB peer for one type would be a self-inflicted wound.

What to generalise while lifting:

- `query-sql.ts` — column type goes from `DatasetArtifactMetadataOutput['schema']['columns']`
  to `readonly {id, sqlType?, type?}[]`; `DATASET_PREVIEW_ORDER_COLUMN` becomes the
  `defaultOrderBy` option. The `COMPARISON_OPERATORS` table and the `TRY_CAST` /
  `CAST(… AS TIMESTAMP)` fallbacks move unchanged. **Export `buildWhereSql`,
  `buildOrderBySql` and `buildPageSql` individually**, not just the whole source.
- `stats.ts` — `datasetPreviewDuckDb` becomes the injected `query`.
- `source-sql.ts` — keep the `wrapSource` composition entry point and the read-only
  statement guard (`SELECT`/`WITH` only); drop the dataset-specific constants.
- `sql.ts`, `arrow.ts` — verbatim.

`dataGridColumnTypeFromSqlType` **stays in core**; re-export from `/duckdb` for
discoverability.

### The flagship — ship `joinLayer` and the ingestion helpers

```ts
registerParquetSource(db, { name, url });        // read_parquet over HTTP range requests
registerJsonSource(db,    { name, url | rows }); // read_json_auto, or an inserted array
registerArrowSource(db,   { name, table });      // zero-copy from an existing Arrow table
```

```ts
const source = createDuckDbDataSource({
  query,
  from: orders,
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
    selectionLayer(), // `present` only — checkbox column
  ],
});
```

Sorting by `name` or filtering on `is_flagged` issues one DuckDB query across all three.
`joinLayer` is a thin convenience over `project`; ship it rather than making everyone
hand-write JOIN fragments.

### Exit gate

- `src/duckdb/__tests__/query-sql.spec.ts` passing unchanged is a free proof that the lifted
  SQL generation is byte-identical.
- A `wrapSource` nesting snapshot, proving layer _i+1_'s JOIN can reference a column layer
  _i_ produced — the property a flat wrap would silently break.
- **The cross-source join oracle:** build the three-source fixture in node DuckDB
  (`@duckdb/node-api`, devDependency only, keep it on node not bun — native N-API), then
  assert that sorting on a joined column and filtering on a different source's column both
  return the same row order as an equivalent single-table query. This is the product's
  headline claim; it gets a real oracle, not a snapshot.
- Row-for-row agreement with `/memory` over a shared fixture.

---

## L6 — `/http`

Default contract:
`GET {url}?offset&limit&sort=name:asc,created:desc&filter=<urlencoded JSON>` →
`{ rows, total }`. Total discovery order: `parseTotal` → `X-Total-Count` → `body.total` →
`null` (controller falls back to the page-size heuristic).

Escape hatches layered smallest-first: `serializeSorts`/`serializeFilters` → `headers` (sync
or async, for tokens) → `buildRequest` → `parseResponse` → `fetch` injection. Forward
`signal` unconditionally; no built-in retry.

Specs: query-string encoding, `X-Total-Count` precedence, and **abort-on-rapid-sort
surfacing no error**.

---

## L7 — `examples/` and publish

One app, three jobs: public demo, theming documentation, visual-regression baseline. Vite +
React, `base: '/data-grid/'`, deployed by a `pages.yml` workflow (Pages source = _GitHub
Actions_). **Every demo works statically**, which is what makes Pages viable:

| Demo                                           | How it stays static                                                                                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Three sources, one grid** — the landing demo | parquet + JSON + Arrow from `public/`, joined in DuckDB-wasm                                                                                  |
| `/memory`                                      | 10k generated rows, everything in JS                                                                                                          |
| `/http`                                        | **MSW service worker** implementing the default wire contract — genuinely exercises `X-Total-Count`, encoding and abort rather than faking it |
| `/duckdb`                                      | committed `.parquet` read over HTTP **range requests** (Pages' CDN honours `Range`, which is why this works)                                  |
| Theme playground                               | live `--dg-*` editor + light/dark/cotera presets; doubles as the theming docs                                                                 |
| Overrides                                      | custom `CellComponent` (sparkline) and `HeaderComponent`                                                                                      |

Publish `0.1.0-beta.1`. `examples/` must never ship to npm — `files: ["dist"]` handles it.

---

## Traps

| Trap                                            | Why it bites                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A portal without `DataGridThemeScope`**       | `--dg-*` lives on `.cotera-data-grid`, and a portal to `document.body` is outside it. Renders unstyled. Invisible against a host that happens to define the same tokens; obvious only in production against one that does not. Four sites today: `DataGridOverlay`, dialog, dropdown, hover-card. Add a spec asserting the class on the portalled node. |
| **Missing `(color:…)` hint**                    | `text-`/`border-`/`ring-` are ambiguous. Produces a silently wrong utility, not an error.                                                                                                                                                                                                                                                               |
| **Opacity modifier on an arbitrary var**        | Breaks the `color-mix` pixel-parity argument.                                                                                                                                                                                                                                                                                                           |
| **Adding a member to `ReadonlyGridStore`**      | Silently breaks structural compatibility with Cotera's `Watchable`, turning a zero-adapter migration into a wrapper-writing exercise. `store.spec.ts` catches it.                                                                                                                                                                                       |
| **Forgetting one of the four exclusion lists**  | `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `eslint.config.js` all list `src/source/layers` and `src/duckdb`.                                                                                                                                                                                                                           |
| **Re-adding tsup entries**                      | `tsup.config.ts` has the future entries commented out with their milestone. Uncomment as each lands, and restore the matching `exports` entry in `package.json` — publint/attw will catch a mismatch.                                                                                                                                                   |
| **GitHub Pages cannot set COOP/COEP**           | `crossOriginIsolated` is false, so `SharedArrayBuffer` is unavailable and duckdb-wasm must land on a non-threaded bundle. Verify the fallback; pin the bundle explicitly if it misbehaves.                                                                                                                                                              |
| **`base: '/data-grid/'` leaks into the worker** | duckdb-wasm's worker is a `blob:` URL wrapping `importScripts`; the script URL must be absolute or base-prefixed or it 404s only in production.                                                                                                                                                                                                         |

---

## Phase 2 — the Cotera cut-over (not scheduled)

Described because **it is the design target**: every API decision above is only correct if
it makes this migration mechanical. Do not start it.

Two call sites in Cotera reach into _library-owned_ stores with jotai-only APIs and will
need changing — `preview/grid.tsx:716-717` (`useWatchableValue` on `rowSource.totalRows` and
`viewModel.filters`) and `preview/grid-view-model.ts:336,341` (`Watchable.from` over
`viewModel.sorts`/`filters`). Grepped exhaustively; those are the only two. Everything
flowing _into_ the library needs no adapter at all.

Also true and worth designing for: `preview/grid-source.tsx` should keep working with only
its import line changed, because `createPatchableRowSource({ rows, totalRows, hasMore,
isLoading })` typechecks unchanged when handed Cotera `Watchable`s. Do not break that.

**Watch item:** the original still exists at
`apps/client/src/app/components/ui/data-grid/`. If anyone edits those 31 files while this
library is being built, the change has to be replayed here and the L1 parity argument gets
weaker.

---

## Outstanding prerequisites (human, not agent)

1. **npm auth + `@cotera` publish rights** — `npm whoami` currently fails. Blocks L7 only.
2. **Create `coterahq/data-grid`** and enable Pages with source = _GitHub Actions_.
3. **Publishing mechanism** — recommend npm trusted publishing (OIDC) over a stored
   `NPM_TOKEN`; pairs with the `provenance: true` already in `package.json`, which needs
   `id-token: write`.

L2 through L6 need none of these.
