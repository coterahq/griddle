import * as React from 'react';
import { DataGrid, createDataGridViewModel } from '../../../src';
import { createGridController } from '../../../src/source';
import { createMemoryDataSource } from '../../../src/memory';
import { makeOrders, ORDER_COLUMNS } from '../data';
import type { Order } from '../data';
import { DemoFrame } from '../demo-frame';

/**
 * `/memory` — the path of least resistance.
 *
 * Ten thousand rows, everything in JavaScript, no backend. Sorting, filtering,
 * the header charts and paging all work, and the code below is the whole
 * integration: build the source, hand it to the controller, spread
 * `gridProps`.
 *
 * The point being made is about what a caller does *not* have to meet. There
 * is no store here, no page, no abort, no generation counter — those exist and
 * are load-bearing, but somebody with an array in hand should not have to
 * learn about them to put it on screen.
 */

const ROWS = makeOrders(10_000);

export function MemoryDemo(): React.ReactElement {
  const viewModel = React.useMemo(
    () => createDataGridViewModel<Order>({ columns: ORDER_COLUMNS }),
    []
  );

  const controller = React.useMemo(
    () =>
      createGridController<Order>({
        source: createMemoryDataSource<Order>({
          rows: ROWS,
          columns: ORDER_COLUMNS,
        }),
        viewModel,
        getRowId: (row) => row.id,
        pageSize: 250,
      }),
    [viewModel]
  );

  React.useEffect(
    () => () => {
      controller.dispose();
    },
    [controller]
  );

  return (
    <DemoFrame
      title="In memory"
      blurb={
        <>
          10,000 generated rows, sorted and filtered in JavaScript.{' '}
          <code>createMemoryDataSource</code> is also the reference
          implementation — it is what <code>/duckdb</code> and{' '}
          <code>/http</code> are checked against, row for row.
        </>
      }
      footnote="Click the chevron in the gutter to open the column stats; click a bar to filter."
    >
      <DataGrid<Order>
        {...controller.gridProps}
        getRowId={(row) => row.id}
        viewModel={viewModel}
      />
    </DemoFrame>
  );
}
