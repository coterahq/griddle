import { defineConfig } from 'tsup';

export default defineConfig({
  // Entries are added as their milestones land — a missing one is a hard build
  // error, and a stub one would publish an empty subpath that consumers could
  // import. The exports map in package.json is the full intended surface.
  entry: {
    index: 'src/index.ts',
    // 'source/index': 'src/source/index.ts',   // L3
    // 'memory/index': 'src/memory/index.ts',   // L3
    // 'http/index':   'src/http/index.ts',     // L6
    // 'duckdb/index': 'src/duckdb/index.ts',   // L5
  },
  format: ['esm', 'cjs'],
  // Shared core lands in one chunk instead of being duplicated into all five
  // entries. Without this the duckdb entry would carry its own copy of the grid.
  splitting: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  /**
   * Bundled declarations, one flat `.d.ts` + `.d.cts` per entry.
   *
   * The plan called for `tsc --emitDeclarationOnly` instead, on the theory that
   * rollup-plugin-dts mangles deeply generic re-exports. Two things overruled
   * that. It does not mangle them — `DataGridColumn<TRow, TValue, TMeta>` and
   * all four of its render-prop callbacks survive intact, checked in the
   * emitted output. And tsc's per-file emit *fails* `attw`: the declarations
   * carry extensionless relative imports, which node16 resolution rejects from
   * ESM ("Internal resolution error"). Bundling removes every internal import,
   * so there is nothing left to resolve.
   *
   * The cost is losing declaration maps, so go-to-definition lands in the
   * bundled `.d.ts` rather than in library source.
   */
  dts: { resolve: false },
  external: ['react', 'react-dom', '@duckdb/duckdb-wasm'],
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});
