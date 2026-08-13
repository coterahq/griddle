import * as React from 'react';
import { DataGrid, createDataGridViewModel, useGridStore } from '../../../src';
import type { DataGridColumn } from '../../../src';
import { createGridController } from '../../../src/source';
import type { GridController } from '../../../src/source';
import {
  createDuckDbDataSource,
  joinLayer,
  registerJsonSource,
  registerParquetSource,
} from '../../../src/duckdb';
import { duckDbQuery, isolationState } from '../duckdb';
import { asset } from '../asset';
import { DemoFrame } from '../demo-frame';

/**
 * The landing demo, and the reason this library exists.
 *
 * Three sources, three genuinely different ingestion paths:
 *
 *   orders     20,000 rows  parquet, read over HTTP range requests
 *   users         400 rows  JSON, fetched by DuckDB
 *   shipments  15,667 rows  JSON, fetched by the app and handed over as an array
 *
 * One grid. Sorting by `user_name` — which lives in the JSON — or filtering on
 * `carrier` — which lives in the array — issues **one** DuckDB query across
 * all three and returns the right rows, not the right rows out of whatever
 * page happened to be loaded. That is the whole difference between a `project`
 * layer and stapling fields onto a fetched page, and it is what a client-side
 * table cannot do.
 */

type Row = Record<string, unknown>;

const COLUMNS: DataGridColumn<Row>[] = [
  {
    id: 'order_id',
    header: 'Order',
    type: 'number',
    width: 110,
    pinned: 'left',
    getValue: (row) => row['order_id'],
  },
  {
    id: 'user_name',
    header: 'Customer',
    type: 'text',
    width: 180,
    getValue: (row) => row['user_name'],
  },
  {
    id: 'tier',
    header: 'Tier',
    type: 'category',
    width: 110,
    getValue: (row) => row['tier'],
  },
  {
    id: 'status',
    header: 'Status',
    type: 'category',
    width: 120,
    getValue: (row) => row['status'],
  },
  {
    id: 'region',
    header: 'Region',
    type: 'category',
    width: 100,
    getValue: (row) => row['region'],
  },
  {
    id: 'channel',
    header: 'Channel',
    type: 'category',
    width: 110,
    getValue: (row) => row['channel'],
  },
  {
    id: 'total',
    header: 'Total',
    type: 'number',
    width: 130,
    getValue: (row) => row['total'],
  },
  {
    id: 'items',
    header: 'Items',
    type: 'number',
    width: 90,
    getValue: (row) => row['items'],
  },
  {
    id: 'carrier',
    header: 'Carrier',
    type: 'category',
    width: 120,
    getValue: (row) => row['carrier'],
  },
  {
    id: 'days_in_transit',
    header: 'Transit',
    type: 'number',
    width: 100,
    getValue: (row) => row['days_in_transit'],
  },
  {
    id: 'placed_at',
    header: 'Placed',
    type: 'date',
    width: 120,
    getValue: (row) => row['placed_at'],
  },
  {
    id: 'note',
    header: 'Note',
    type: 'text',
    width: 220,
    getValue: (row) => row['note'],
  },
];

const SOURCE_COLUMNS = [
  { id: 'order_id', sqlType: 'BIGINT' },
  { id: 'user_id', sqlType: 'BIGINT' },
  { id: 'status', sqlType: 'VARCHAR' },
  { id: 'region', sqlType: 'VARCHAR' },
  { id: 'channel', sqlType: 'VARCHAR' },
  { id: 'total', sqlType: 'DOUBLE' },
  { id: 'items', sqlType: 'BIGINT' },
  { id: 'note', sqlType: 'VARCHAR' },
  { id: 'placed_at', sqlType: 'DATE' },
];

export function ThreeSourcesDemo(): React.ReactElement {
  const viewModel = React.useMemo(
    () => createDataGridViewModel<Row>({ columns: COLUMNS }),
    []
  );
  const [controller, setController] =
    React.useState<GridController<Row> | null>(null);
  const [error, setError] = React.useState<Error | null>(null);
  const [sql, setSql] = React.useState('');

  React.useEffect(() => {
    let disposed = false;
    let live: GridController<Row> | null = null;

    void (async () => {
      try {
        const query = await duckDbQuery();

        const orders = await registerParquetSource(query, {
          name: 'orders',
          url: asset('data/orders.parquet'),
        });
        const users = await registerJsonSource(query, {
          name: 'users',
          url: asset('data/users.json'),
        });
        // Fetched by the app, then handed over — the path anything already in
        // memory takes, whether it came from an API or was computed here.
        const shipmentRows = (await (
          await fetch(asset('data/shipments.json'))
        ).json()) as unknown[];
        const shipments = await registerJsonSource(query, {
          name: 'shipments',
          rows: shipmentRows,
        });

        const source = createDuckDbDataSource<Row>({
          query,
          from: orders,
          columns: SOURCE_COLUMNS,
          defaultOrderBy: 'order_id',
          layers: [
            joinLayer({
              id: 'user',
              from: users,
              on: 'user_id',
              columns: ['user_name', 'email', 'tier'],
            }),
            joinLayer({
              id: 'shipment',
              from: shipments,
              on: { left: 'order_id', right: 'order_id' },
              columns: ['carrier', 'delivered', 'days_in_transit'],
            }),
          ],
        });

        if (disposed) {
          return;
        }
        setSql(source.sourceSql());
        live = createGridController<Row>({
          source,
          viewModel,
          getRowId: (row) => String(row['order_id']),
          pageSize: 200,
        });
        setController(live);
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
  }, [viewModel]);

  return (
    <DemoFrame
      title="Three sources, one grid"
      blurb={
        <>
          20,000 orders from a <strong>parquet</strong> read over HTTP range
          requests, 400 customers from a <strong>JSON file</strong> DuckDB
          fetches itself, and 15,667 shipments from an <strong>array</strong>{' '}
          this page already had in memory. Sort by Customer or filter by
          Carrier: one query, across all three.
        </>
      }
      footnote={isolationState()}
      details={
        sql === '' ? undefined : { label: 'Generated FROM clause', body: sql }
      }
      error={error}
      pending={controller === null && error === null ? 'Booting DuckDB…' : null}
    >
      {controller === null ? null : (
        <LoadedGrid controller={controller} viewModel={viewModel} />
      )}
    </DemoFrame>
  );
}

function LoadedGrid({
  controller,
  viewModel,
}: {
  controller: GridController<Row>;
  viewModel: ReturnType<typeof createDataGridViewModel<Row>>;
}): React.ReactElement {
  const status = useGridStore(controller.status);
  const error = useGridStore(controller.error);

  if (error !== null) {
    return <p className="demo-error">{error.message}</p>;
  }
  return (
    <>
      <DataGrid<Row>
        {...controller.gridProps}
        getRowId={(row) => String(row['order_id'])}
        viewModel={viewModel}
      />
      <span className="demo-status" data-status={status} />
    </>
  );
}
