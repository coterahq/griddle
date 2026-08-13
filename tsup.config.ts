import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'source/index': 'src/source/index.ts',
    'memory/index': 'src/memory/index.ts',
    'http/index': 'src/http/index.ts',
    'duckdb/index': 'src/duckdb/index.ts',
  },
  format: ['esm', 'cjs'],
  // Shared core lands in one chunk instead of being duplicated into all five
  // entries. Without this the duckdb entry would carry its own copy of the grid.
  splitting: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  // Declarations come from `tsc -p tsconfig.build.json`, not from tsup's
  // rollup-plugin-dts: the four render-prop callbacks on DataGridColumn each
  // close over DataGridCellContext<TRow, TValue, TMeta>, which is the shape
  // that plugin historically mangles. tsc also gives us declaration maps, so
  // go-to-definition lands in library source.
  dts: false,
  external: ['react', 'react-dom', '@duckdb/duckdb-wasm'],
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});
