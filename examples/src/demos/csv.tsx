import * as React from 'react';
import { DataGrid, createDataGridViewModel } from '../../../src';
import { createGridController } from '../../../src/source';
import type { GridController } from '../../../src/source';
import {
  createDuckDbDataSource,
  describeSource,
  duckDbStringLiteral,
  gridColumnsFromSource,
} from '../../../src/duckdb';
import { duckDbQuery } from '../duckdb';
import { asset } from '../asset';
import { DemoFrame } from '../demo-frame';

/**
 * Paste a CSV URL, get a grid.
 *
 * Nothing here knows anything about the file. `read_csv_auto` sniffs the
 * delimiter and the types, `describeSource` reads the resulting schema back
 * out, and `gridColumnsFromSource` turns it into columns. The whole
 * integration is the twenty lines of `load` below, and it would work the same
 * against a parquet or a JSON file by changing one function name.
 *
 * The default URL is same-origin on purpose. An arbitrary CSV only loads if
 * its server sends `Access-Control-Allow-Origin` — the browser is doing the
 * fetching, so the rules are the browser's — and a demo whose first impression
 * depends on a stranger's CORS policy is a demo that is broken half the time.
 * The error path below says so when it happens.
 */

type Row = Record<string, unknown>;

type Loaded = {
  controller: GridController<Row>;
  viewModel: ReturnType<typeof createDataGridViewModel<Row>>;
  columnCount: number;
};

export function CsvDemo(): React.ReactElement {
  const defaultUrl = asset('data/orders.csv');
  const [url, setUrl] = React.useState(defaultUrl);
  const [submitted, setSubmitted] = React.useState(defaultUrl);
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    let disposed = false;
    let live: GridController<Row> | null = null;
    setLoaded(null);
    setError(null);

    void (async () => {
      try {
        const query = await duckDbQuery();

        // A `read_csv_auto` call *is* a relation — no view, no registration.
        // `auto_detect` gets the delimiter, the header and the column types.
        const from =
          `read_csv_auto(${duckDbStringLiteral(submitted)}, ` +
          `auto_detect=true, sample_size=-1)`;

        const described = await describeSource(query, from);
        if (described.length === 0) {
          throw new Error('That URL parsed to zero columns.');
        }

        const source = createDuckDbDataSource<Row>({
          query,
          from,
          columns: described,
          // A CSV has no natural order, and a paged read with no ORDER BY is
          // undefined — rows can repeat or vanish between pages. The first
          // column is arbitrary but stable, which is what paging needs.
          defaultOrderBy: described[0]?.id ?? null,
        });

        if (disposed) {
          return;
        }
        const columns = gridColumnsFromSource<Row>(described);
        const viewModel = createDataGridViewModel<Row>({ columns });
        live = createGridController<Row>({
          source,
          viewModel,
          // No id column to rely on, so the row index stands in. Fine for a
          // read-only view; a grid with editing wants a real key.
          getRowId: (row) => JSON.stringify(row).slice(0, 120),
          pageSize: 200,
        });
        setLoaded({ controller: live, viewModel, columnCount: columns.length });
      } catch (thrown) {
        if (disposed) {
          return;
        }
        const raw = thrown instanceof Error ? thrown.message : String(thrown);
        setError(
          new Error(
            /failed to fetch|network|cors/i.test(raw)
              ? `${raw}\n\nThis is usually CORS: the browser does the fetching, ` +
                  'so the file has to be served with `Access-Control-Allow-Origin`. ' +
                  'Same-origin files and most object stores work; a random GitHub ' +
                  'HTML page does not.'
              : raw
          )
        );
      }
    })();

    return () => {
      disposed = true;
      live?.dispose();
    };
  }, [submitted]);

  return (
    <DemoFrame
      title="Any CSV, by URL"
      blurb={
        <>
          DuckDB reads the file, sniffs the delimiter and infers the types;{' '}
          <code>describeSource</code> reads that schema back and the columns
          build themselves. Paste your own URL — it needs to be served with CORS
          headers, because the fetch happens in your browser.
        </>
      }
      toolbar={
        <form
          className="url-form"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(url.trim());
          }}
        >
          <input
            type="url"
            value={url}
            aria-label="CSV URL"
            spellCheck={false}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
          />
          <button type="submit" className="toggle">
            Load
          </button>
        </form>
      }
      footnote={
        loaded === null
          ? undefined
          : `${String(loaded.columnCount)} columns, types inferred by DuckDB.`
      }
      error={error}
      pending={loaded === null && error === null ? 'Reading the CSV…' : null}
    >
      {loaded === null ? null : (
        <DataGrid<Row>
          {...loaded.controller.gridProps}
          getRowId={(row) => JSON.stringify(row).slice(0, 120)}
          viewModel={loaded.viewModel}
        />
      )}
    </DemoFrame>
  );
}
