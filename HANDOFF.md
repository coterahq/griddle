# `@cotera/griddle` — handoff

**L0 through L7 are done and green.** What remains is three things outside this
repo — see [Outstanding](#outstanding-human-not-agent).

Green: `format:check`, `lint`, `typecheck`, `test` (217 specs), `build`,
`publint`, `attw` (all four resolution modes, all five entry points).

Nothing under `src/` is excluded from typecheck, lint or test any more.

---

## What this is

A React data grid extracted from `apps/client/src/app/components/ui/data-grid/`
in the Cotera monorepo, now a standalone npm package. ~7,500 lines of grid —
virtualization, column pinning/resize/reorder, multi-sort, structured filters,
column stats charts, cell editing, row detail panels, keyboard nav — with **zero
domain types in it**.

**The differentiating feature is layers: joining multiple data sources into one
grid.** Point it at a parquet on S3, a JSON API and an in-memory array; get one
grid with real cross-source sort and filter. That is L4/L5 and it is the
product. `src/duckdb/__tests__/join-oracle.spec.ts` is the proof.

```
src/
  index.ts        the package entry ("@cotera/griddle")
  core/           the grid
  store/          createGridStore / derivedGridStore / useGridStore
  ui/             vendored primitives: cn, icons, tooltip, dialog,
                  dropdown-menu, controls, portal, modal-host, theme-scope
  internal/       assert, dev
  source/         GridDataSource, createGridController, withLayers, layers/
  memory/         the reference implementation
  duckdb/         the join engine
  http/           the HTTP adapter
styles/           grid.css + themes/{cotera,light,dark,dark-auto}.css
examples/         the demo site (never ships — `files: ["dist"]`)
test/             setup.ts (observer stubs), modal-host.tsx (test host)
```

```bash
bun install
bun run test            # vitest, jsdom, 217 specs
bun run typecheck
bun run lint
bun run build           # tsup (js + bundled dts) then scripts/build-css.mjs
bun run check:package   # publint + attw --pack

bun run examples:dev          # the demo site
bun run examples:build
bun run examples:screenshots  # visual baseline, needs examples:build first
node scripts/build-fixtures.mjs   # regenerate the demo's parquet/JSON
```

---

## Ground rules

1. **Do not rewrite imported source to satisfy a lint rule.** The extraction's
   whole defence is that it is behaviour-preserving. If `strictTypeChecked`
   flags imported code, relax the rule in `eslint.config.js` with a comment
   explaining why — eight rules are already relaxed that way, each with
   rationale.
2. **Specs are the contract.** The ported Cotera specs under
   `src/core/__tests__/`, `src/source/layers/__tests__/layers.spec.ts` and
   `src/duckdb/__tests__/query-sql.spec.ts` are Cotera's, with only import lines
   (and, where an API changed, fixture shapes) altered. Do not "improve" their
   assertions. Add new specs in new files.
3. **Bun for install and scripts; vitest-on-node for tests.** `bun test`
   registers happy-dom, and the grid measures itself entirely from
   `ResizeObserver` / `IntersectionObserver` with heavy `getBoundingClientRect`
   and scroll geometry — exactly where the two DOM shims diverge. The DuckDB
   oracle additionally needs Node for `@duckdb/node-api`'s native N-API binding.
4. **Every new portal goes through `DataGridThemeScope`**, and gets a case in
   `src/ui/__tests__/theme-scope.spec.tsx`. See [traps](#traps).
5. Conventional commits. Explicit `=== undefined` comparisons, exhaustive
   switches with `unreachable()` from `src/internal/assert`, `toMatchObject()`
   in tests, never cast to `any`/`unknown`.

---

## Verified facts — do not re-derive these

Each of these cost real digging or was corrected by evidence.

1. **`{ snapshot; subscribe; set }` is a strict structural subset of Cotera's
   `Watchable`.** That is why the store contract is drawn this small: an app
   already holding `Watchable`s passes them into the grid with no adapter.
   `src/store/store.spec.ts` asserts it against a `Watchable`-shaped mock — if
   that stops compiling, the boundary has grown. **Do not add members to
   `ReadonlyGridStore`.** (`isGridStore` is a standalone function, not a member,
   deliberately.)
2. **`derivedGridStore` must watch its dependencies from construction, not from
   first listener.** React calls `getSnapshot` _during render_, before
   subscribing, so the cache cannot be conditional on being subscribed. Getting
   this wrong produces "The result of getSnapshot should be cached to avoid an
   infinite loop". It also needs a baseline seeded on first `subscribe`. Both
   are tested.
3. **Declarations come from tsup's bundled dts, not `tsc`.** `rollup-plugin-dts`
   does _not_ mangle `DataGridColumn<TRow, TValue, TMeta>` or its four
   render-prop callbacks. `tsc`'s per-file emit _fails_ `attw`, because
   extensionless relative imports in `.d.ts` are unresolvable under node16 from
   ESM. Bundling leaves no internal imports to resolve.
4. **The exports map needs types nested per condition** (`import.types` →
   `.d.ts`, `require.types` → `.d.cts`) _plus_ legacy `main`/`module`/`types`
   for node10, _plus_ `typesVersions` for the four subpaths — node10 cannot read
   `exports` at all, so `./memory` and friends resolve only through it.
5. **No `@vitejs/plugin-react` in `vitest.config.ts`.** Vitest resolves its own
   nested Vite, so a plugin built against the top-level one is a structurally
   different `Plugin` type and will not typecheck. The examples app has its own
   Vite config and does use the plugin.
6. **Tailwind 4.3 compiles `bg-primary/10` to
   `color-mix(in oklab, var(--color-primary) 10%, transparent)`.** The tier-2
   tokens are that identical expression, which is what makes pixel parity a
   claim rather than a hope.
7. **Zero interpolated `className` strings in the grid.** Every class is a
   static literal, so Tailwind `@source` scanning is complete and no safelist is
   needed.
8. **`sort-asc` mapped to a Z→A glyph and `sort-desc` to A→Z in the original** —
   inverted. Corrected in `src/ui/icons.tsx` with a comment. Deliberate
   divergence.
9. **`attw` below 0.18 crashes on this package.** 0.16.4 keeps only the last
   gunzip chunk when unpacking, so it fails on any tarball above one chunk with
   "Cannot read properties of undefined (reading 'filename')". It is pinned to
   `^0.18.5`, and the CSS exports are excluded explicitly — a stylesheet has no
   types and is out of scope for a types checker.
10. **DuckDB's default null order is NULLS LAST in both directions**, which is
    what `/memory` does deliberately, so the two agree without either being
    configured. Their text collation does _not_ agree: DuckDB is binary,
    `/memory` uses `Intl.Collator` with numeric collation. The oracle fixture
    avoids case and embedded digits on purpose.
11. **`bun add -d` on a name already listed as an optional peer empties the peer
    range and installs nothing.** `@duckdb/duckdb-wasm` is written into both
    `peerDependencies` and `devDependencies` by hand for this reason.

---

## What each milestone delivered

### L2 — theming

153 colour sites across 14 files now use `--dg-*`. Nine tier-1 tokens are the
whole theming surface; 39 tier-2 role tokens derive from them with
`color-mix(in oklab, …)`. Two rules govern tier 2 and they are different: one
_derivation_ per `(semantic, alpha)` pair, which is what parity rests on; one
_token_ per role, so moving a focused cell's ring does not move a hovered
histogram bar.

The library emits no dark-mode rules. `themes/cotera.css` is nine lines of
`var(--background)` indirection and follows a host's `.dark` for free.

`scripts/build-css.mjs` enforces four things, each of which otherwise produces a
valid-but-wrong stylesheet:

- a missing `(color:…)` hint on `text-`/`border-`/`ring-` compiles to
  `font-size: var(--dg-fg)`
- an opacity modifier on an arbitrary var re-derives an alpha at the call site
- a `--dg-*` a utility reads but the base layer never defines renders
  transparent
- any `:root`/`:host` surviving the rescope leaks globals into the host page

The grid also ships a **scoped preflight**. Skipping Tailwind's keeps the
library out of the host's business, but the grid's own `<button>` headers
arrived in native OS chrome without one.

### L3 — `GridDataSource`, the controller, `/memory`

`createGridController` handles the four things that go wrong when this is
hand-rolled: stale responses discarded by generation, `AbortError` swallowed
rather than surfaced, rows staying mounted through a refetch, and stats
invalidated by filters but not by sorts. It subscribes to `viewModel.sorts` /
`filters` directly, so the host's `onSortChange` / `onFilterChange` stay free.

`gridProps` is **three** keys, not the two originally predicted — the third is
`onHeaderStatsVisible`, and it cannot fold into `columnStatsSource.get()`
because the grid calls `get()` for every rendered header whether or not stats
are expanded.

`src/memory/filter.ts` is the written definition of what every
`DataGridFilterValue` shape means. `/duckdb` and `/http` are checked against it.

### L4 — layers in core

`present` and `enrich` are engine-agnostic and live in `src/source/layers/`.
`project` and `mutate` are SQL-only and live on `SqlLayerStack` — which is in
`src/source/layers/sql.ts` rather than `/duckdb`, because it imports nothing
from DuckDB. `/duckdb` re-exports it.

**`enrich` cannot be sorted or filtered**, enforced three ways: `EnrichedColumn`
removes both keys, `LayerStack` sets them `false`, and `withLayers` drops any
sort or filter that reaches one with a dev warning.

### L5 — `/duckdb`

`createDuckDbDataSource`, `joinLayer`, `selectionLayer`, the ingestion helpers,
and the clause builders exported individually so a caller's own export query
uses the same `WHERE` the grid is showing.

No `apache-arrow` dependency: `{ toArray(): unknown[] }` is the whole type
surface. The library does not own DuckDB setup — `query` is injected.

The oracle in `src/duckdb/__tests__/join-oracle.spec.ts` builds three sources in
node DuckDB and checks every result against an equivalent hand-written
single-table query, plus twelve filter and sort shapes against `/memory`.

### L6 — `/http`

`GET {url}?offset&limit&sort=name:asc&filter=<urlencoded JSON>`. Filters go as
JSON because flattening a `between` loses `inclusiveMax`. Total discovery:
`parseTotal` → `X-Total-Count` → `body.total` → `null`. Escape hatches layered
smallest-first. No built-in retry — inject `fetch`.

The URL goes to `fetch` as a string rather than wrapped in a `Request`:
`new Request('/api/rows')` throws outside a browser.

### L7 — `examples/` and publish

Five demos at `bun run examples:dev`, all static. `.github/workflows/pages.yml`
deploys with `--base=/griddle/`.

`examples/src/duckdb.ts` is worth reading before touching anything wasm — both
the worker script URL _and_ the wasm module URL must be absolutised, because
everything the blob worker fetches resolves against the blob.

---

## Traps

| Trap                                        | Why it bites                                                                                                                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A portal without `DataGridThemeScope`**   | `--dg-*` lives on `.cotera-griddle`, and a portal to `document.body` is outside it. Renders unstyled — invisible against a host that defines the same tokens. `theme-scope.spec.tsx` covers the four sites. |
| **Missing `(color:…)` hint**                | `text-`/`border-`/`ring-` are ambiguous. `build-css` fails the build on it.                                                                                                                                 |
| **Opacity modifier on an arbitrary var**    | Breaks the `color-mix` pixel-parity argument. `build-css` fails the build on it.                                                                                                                            |
| **Adding a member to `ReadonlyGridStore`**  | Silently breaks structural compatibility with Cotera's `Watchable`. `store.spec.ts` catches it.                                                                                                             |
| **Reaching for a Node global in `src/`**    | `@types/node` is installed for the DuckDB oracle spec, so `process` and `Buffer` typecheck everywhere. `no-restricted-globals` is what stops one shipping.                                                  |
| **Adding an entry point**                   | Four places: `tsup.config.ts`, `package.json` `exports`, `package.json` `typesVersions`, and the `check:package` exclusions if it is CSS. publint/attw catch a mismatch.                                    |
| **`--virtual-time-budget` and duckdb-wasm** | The flag freezes the clock the worker handshake needs, so a headless capture hangs on "Booting DuckDB…" and looks like a bug in the worker URLs. `capture-screenshots` skips that demo.                     |
| **A relative URL reaching a worker**        | Both the duckdb-wasm worker script and the wasm module resolve against the `blob:`, not the document. Works under a dev server at `/`; 404s only under a deployment base.                                   |
| **GitHub Pages cannot set COOP/COEP**       | `crossOriginIsolated` is false, so `SharedArrayBuffer` is unavailable. The `coi` bundle is left out of the bundle map entirely, so the fallback is structural rather than hoped for.                        |

---

## Phase 2 — the Cotera cut-over (not scheduled)

Described because **it is the design target**: every API decision above is only
correct if it makes this migration mechanical. Do not start it.

Two call sites in Cotera reach into _library-owned_ stores with jotai-only APIs
and will need changing — `preview/grid.tsx:716-717` (`useWatchableValue` on
`rowSource.totalRows` and `viewModel.filters`) and
`preview/grid-view-model.ts:336,341` (`Watchable.from` over
`viewModel.sorts`/`filters`). Grepped exhaustively; those are the only two.
Everything flowing _into_ the library needs no adapter at all.

Also true and worth designing for: `preview/grid-source.tsx` should keep working
with only its import line changed, because `createPatchableRowSource({ rows,
totalRows, hasMore, isLoading })` typechecks unchanged when handed Cotera
`Watchable`s. Do not break that.

**Watch item:** the original still exists at
`apps/client/src/app/components/ui/data-grid/`. If anyone edits those 31 files,
the change has to be replayed here and the L1 parity argument gets weaker.

---

## Outstanding (human, not agent)

1. **npm auth + `@cotera` publish rights** — `npm whoami` fails. Blocks
   publishing `0.1.0-beta.1`; everything else is ready.
2. **Create `coterahq/griddle`** and enable Pages with source = _GitHub
   Actions_. `.github/workflows/pages.yml` is waiting for it.
3. **Publishing mechanism** — recommend npm trusted publishing (OIDC) over a
   stored `NPM_TOKEN`; pairs with the `provenance: true` already in
   `package.json`, which needs `id-token: write`.
