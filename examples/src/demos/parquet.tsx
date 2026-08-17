import * as React from 'react';
import { DataGrid, createDataGridViewModel } from '../../../src';
import type { DataGridColumn } from '../../../src';
import { createGridController } from '../../../src/source';
import type { GridController } from '../../../src/source';
import {
  createDuckDbDataSource,
  describeSource,
  gridColumnsFromSource,
  registerParquetSource,
} from '../../../src/duckdb';
import { duckDbQuery } from '../duckdb';
import { asset } from '../asset';
import { DemoFrame } from '../demo-frame';

/**
 * One parquet file. Nothing else.
 *
 * The simplest thing the library does, and the one worth leading with: a
 * 177 kB file on a CDN, 20,000 rows, sorted and filtered by DuckDB over HTTP
 * range requests. Nothing is downloaded up front — DuckDB reads the footer,
 * then only the row groups and columns a query actually touches.
 *
 * The columns are not declared anywhere. `describeSource` asks the engine what
 * the file contains and `gridColumnsFromSource` turns that into grid columns,
 * so pointing this at a different parquet is a one-line change.
 */

type Row = Record<string, unknown>;

export function ParquetDemo(): React.ReactElement {
  const [state, setState] = React.useState<{
    controller: GridController<Row>;
    viewModel: ReturnType<typeof createDataGridViewModel<Row>>;
    columns: DataGridColumn<Row>[];
  } | null>(null);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    let disposed = false;
    let live: GridController<Row> | null = null;

    void (async () => {
      try {
        const query = await duckDbQuery();
        const from = await registerParquetSource(query, {
          name: 'orders_only',
          url: asset('data/orders.parquet'),
        });

        // The schema comes from the file, not from this file.
        const described = await describeSource(query, from);
        const columns = gridColumnsFromSource<Row>(described);

        const source = createDuckDbDataSource<Row>({
          query,
          from,
          columns: described,
          defaultOrderBy: 'order_id',
        });

        if (disposed) {
          return;
        }
        const viewModel = createDataGridViewModel<Row>({ columns });
        live = createGridController<Row>({
          source,
          viewModel,
          getRowId: (row) => String(row['order_id']),
          pageSize: 200,
        });
        setState({ controller: live, viewModel, columns });
      } catch (thrown) {
        if (!disposed) {
          setError(
            thrown instanceof Error ? thrown : new Error(String(thrown))
          );
        }
      }
    })();

    return () => {
      disposed = true;
      live?.dispose();
    };
  }, []);

  return (
    <DemoFrame
      title="A parquet file"
      blurb={
        <>
          20,000 rows in a 177 kB parquet on the CDN. Sort a column and DuckDB
          issues one query over HTTP <strong>range requests</strong>, reading
          only the row groups it needs — the file is never downloaded. The
          columns below were not declared; <code>describeSource</code> asked the
          engine what was in the file.
        </>
      }
      footnote="Open the column stats from the gutter chevron: those histograms are aggregates, computed by DuckDB over the whole file."
      error={error}
      pending={state === null && error === null ? 'Booting DuckDB…' : null}
    >
      {state === null ? null : (
        <DataGrid<Row>
          {...state.controller.gridProps}
          getRowId={(row) => String(row['order_id'])}
          viewModel={state.viewModel}
        />
      )}
    </DemoFrame>
  );
}
