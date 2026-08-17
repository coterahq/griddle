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
 * 609,698 real rows, and the argument made by somebody else's data model.
 *
 * Every other demo here runs on a fixture we generated, which means we chose
 * the shape, and choosing the shape is how a demo ends up proving only that it
 * was built to be proved. This one is NYC Taxi & Limousine Commission trip
 * records — yellow taxi, the first week of January 2024, exactly as published.
 *
 * The TLC did not design their schema for us, and it is the better argument
 * for it. A trip record says it started at `pickup_location_id` 132. It does
 * not say that 132 is JFK Airport; that lives in `taxi_zone_lookup`, a
 * different file, because normalising a 265-row lookup out of a 610k-row fact
 * table is what everybody does and should do.
 *
 * So "sort by pickup zone" is a question no client-side table can answer. The
 * name is not in the rows, and pulling a page and joining it in JavaScript
 * sorts the page, not the trips. Here it is a `joinLayer`, the join lands in
 * the page query, and the first row is genuinely the first row out of 609,698.
 *
 * Three ingestion paths again, at a scale where the difference is not academic:
 *
 *   trips     609,698 rows  8.7 MB parquet, read over HTTP range requests
 *   zones         265 rows  JSON, fetched by DuckDB, joined twice
 *   payments        6 rows  a literal array in this file, joined inline
 */

type Row = Record<string, unknown>;

/*
 * From the TLC's data dictionary, which ships as a PDF — so it is transcribed
 * here rather than fetched. Six rows is also a fair demonstration of the
 * smallest useful join: no file, no fetch, no `CREATE VIEW`. `joinLayer`
 * inlines a `{ kind: 'rows' }` relation straight into the query as a VALUES
 * list, and the grid can sort and filter on `payment` like any other column.
 *
 * Code 0 is not in the dictionary but is in the data — 28,098 trips carry it,
 * the same 28,098 that have no `passengers` recorded. It is what one vendor's
 * records look like when a field never got written, and a LEFT join would
 * leave it blank; naming it is more honest than an empty cell that reads like
 * a bug in the grid.
 */
const PAYMENT_TYPES = [
  { payment_type: 0, payment: 'not recorded' },
  { payment_type: 1, payment: 'credit card' },
  { payment_type: 2, payment: 'cash' },
  { payment_type: 3, payment: 'no charge' },
  { payment_type: 4, payment: 'dispute' },
  { payment_type: 5, payment: 'unknown' },
];

/*
 * Declared rather than read off the file with `describeSource`.
 *
 * The parquet demo does the automatic thing and this one does not, on purpose:
 * fourteen raw column names make a grid you can read but not skim. `Picked up`
 * beats `picked_up_at`, and the joined columns need widths that suit a zone
 * name rather than an integer. This is the cost of a hand-written column
 * array, and it is the trade a real app makes every time.
 */
const COLUMNS: DataGridColumn<Row>[] = [
  {
    id: 'trip_id',
    header: 'Trip',
    type: 'number',
    width: 96,
    pinned: 'left',
    getValue: (row) => row['trip_id'],
  },
  {
    id: 'picked_up_at',
    header: 'Picked up',
    type: 'timestamp',
    width: 170,
    getValue: (row) => row['picked_up_at'],
  },
  {
    id: 'pickup_borough',
    header: 'From borough',
    type: 'category',
    width: 130,
    getValue: (row) => row['pickup_borough'],
  },
  {
    id: 'pickup_zone',
    header: 'From zone',
    type: 'category',
    width: 200,
    getValue: (row) => row['pickup_zone'],
  },
  {
    id: 'dropoff_borough',
    header: 'To borough',
    type: 'category',
    width: 130,
    getValue: (row) => row['dropoff_borough'],
  },
  {
    id: 'dropoff_zone',
    header: 'To zone',
    type: 'category',
    width: 200,
    getValue: (row) => row['dropoff_zone'],
  },
  {
    id: 'distance_miles',
    header: 'Miles',
    type: 'number',
    width: 90,
    getValue: (row) => row['distance_miles'],
  },
  {
    id: 'passengers',
    header: 'Pax',
    type: 'number',
    width: 80,
    getValue: (row) => row['passengers'],
  },
  {
    id: 'fare_amount',
    header: 'Fare',
    type: 'number',
    width: 100,
    getValue: (row) => row['fare_amount'],
  },
  {
    id: 'tip_amount',
    header: 'Tip',
    type: 'number',
    width: 90,
    getValue: (row) => row['tip_amount'],
  },
  {
    id: 'tolls_amount',
    header: 'Tolls',
    type: 'number',
    width: 90,
    getValue: (row) => row['tolls_amount'],
  },
  {
    id: 'total_amount',
    header: 'Total',
    type: 'number',
    width: 110,
    getValue: (row) => row['total_amount'],
  },
  {
    id: 'payment',
    header: 'Payment',
    type: 'category',
    width: 130,
    getValue: (row) => row['payment'],
  },
  {
    id: 'dropped_off_at',
    header: 'Dropped off',
    type: 'timestamp',
    width: 170,
    getValue: (row) => row['dropped_off_at'],
  },
];

/*
 * The base table's own columns, for the SQL builder.
 *
 * Only the ones the grid can filter or sort on need to be here — the joined
 * columns are declared by their layers, which is how `pickup_zone` ends up
 * sortable without this array ever mentioning it.
 */
const SOURCE_COLUMNS = [
  { id: 'trip_id', sqlType: 'BIGINT' },
  { id: 'picked_up_at', sqlType: 'TIMESTAMP' },
  { id: 'dropped_off_at', sqlType: 'TIMESTAMP' },
  { id: 'pickup_location_id', sqlType: 'INTEGER' },
  { id: 'dropoff_location_id', sqlType: 'INTEGER' },
  { id: 'passengers', sqlType: 'INTEGER' },
  { id: 'distance_miles', sqlType: 'DOUBLE' },
  { id: 'fare_amount', sqlType: 'DOUBLE' },
  { id: 'tip_amount', sqlType: 'DOUBLE' },
  { id: 'tolls_amount', sqlType: 'DOUBLE' },
  { id: 'total_amount', sqlType: 'DOUBLE' },
  { id: 'payment_type', sqlType: 'INTEGER' },
  { id: 'vendor_id', sqlType: 'INTEGER' },
  { id: 'store_and_fwd_flag', sqlType: 'VARCHAR' },
];

export function TaxiDemo(): React.ReactElement {
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

        const trips = await registerParquetSource(query, {
          name: 'taxi_trips',
          url: asset('data/taxi-trips.parquet'),
        });
        const zones = await registerJsonSource(query, {
          name: 'taxi_zones',
          url: asset('data/taxi-zones.json'),
        });

        const source = createDuckDbDataSource<Row>({
          query,
          from: trips,
          columns: SOURCE_COLUMNS,
          defaultOrderBy: 'trip_id',
          layers: [
            /*
             * The same 265-row relation, joined twice on different keys.
             * `as` is doing the work — both sides bring a `borough` and a
             * `zone` across, and without the rename the second would collide
             * with the first. The aliases DuckDB sees are minted per layer, so
             * the two joins do not collide in SQL either.
             */
            joinLayer({
              id: 'pickup',
              from: zones,
              on: { left: 'pickup_location_id', right: 'location_id' },
              columns: [
                { name: 'borough', as: 'pickup_borough' },
                { name: 'zone', as: 'pickup_zone' },
              ],
            }),
            joinLayer({
              id: 'dropoff',
              from: zones,
              on: { left: 'dropoff_location_id', right: 'location_id' },
              columns: [
                { name: 'borough', as: 'dropoff_borough' },
                { name: 'zone', as: 'dropoff_zone' },
              ],
            }),
            // Six rows held in this file, inlined into the query. No fetch, no
            // registration, no adapter-specific anything.
            joinLayer({
              id: 'payment',
              from: { kind: 'rows', rows: PAYMENT_TYPES },
              on: 'payment_type',
              columns: [{ name: 'payment', sqlType: 'VARCHAR' }],
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
          getRowId: (row) => String(row['trip_id']),
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
      title="609,698 real rows"
      blurb={
        <>
          Every NYC yellow taxi trip in the first week of January 2024, as the
          TLC published it. The trips are an 8.7 MB <strong>parquet</strong>;
          the borough and zone names are in a separate 265-row{' '}
          <strong>JSON lookup</strong>, joined twice — once for pickup, once for
          dropoff. Sort by <strong>From zone</strong>: the name is not in the
          parquet, so that ordering exists only because the join is in the
          query.
        </>
      }
      footnote={`Real data, left as published: 28,098 trips have no passenger count and 8,178 have a negative total — refunds and disputes. ${isolationState()}`}
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
        getRowId={(row) => String(row['trip_id'])}
        viewModel={viewModel}
      />
      <span className="demo-status" data-status={status} />
    </>
  );
}
