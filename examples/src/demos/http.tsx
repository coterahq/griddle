import * as React from 'react';
import { DataGrid, createDataGridViewModel } from '../../../src';
import { createGridController } from '../../../src/source';
import type { GridController } from '../../../src/source';
import { createHttpDataSource } from '../../../src/http';
import { ORDER_COLUMNS } from '../data';
import type { Order } from '../data';
import { startMockApi } from '../mock-api';
import { DemoFrame } from '../demo-frame';

/**
 * `/http` — against a real HTTP endpoint.
 *
 * The endpoint is a Mock Service Worker, which matters: it intercepts at the
 * network layer, so this is a genuine `fetch` to `/api/orders`, a genuine
 * query string, genuine `X-Total-Count` headers and a genuine abort when a
 * sort supersedes an in-flight request. Injecting the adapter's own `fetch`
 * option would have been easier and would have proved nothing — the escape
 * hatch cannot be the thing under test.
 *
 * The handler parses the query string with `parseSorts` and `parseFilters`
 * exported from `/http`, and evaluates the filters with `/memory`. That is the
 * argument for exporting them: a server can be exactly compatible by importing
 * the same functions rather than reimplementing an encoding from prose.
 */

export function HttpDemo(): React.ReactElement {
  const viewModel = React.useMemo(
    () => createDataGridViewModel<Order>({ columns: ORDER_COLUMNS }),
    []
  );
  const [controller, setController] =
    React.useState<GridController<Order> | null>(null);
  const [error, setError] = React.useState<Error | null>(null);
  const [log, setLog] = React.useState<string[]>([]);

  React.useEffect(() => {
    let disposed = false;
    let live: GridController<Order> | null = null;

    void (async () => {
      try {
        await startMockApi((line) => {
          setLog((current) => [line, ...current].slice(0, 6));
        });
        if (disposed) {
          return;
        }
        live = createGridController<Order>({
          source: createHttpDataSource<Order>({ url: '/api/orders' }),
          viewModel,
          getRowId: (row) => row.id,
          pageSize: 100,
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
      title="Over HTTP"
      blurb={
        <>
          A real <code>fetch</code> to <code>/api/orders</code>, answered by a
          service worker that decodes the query string with the same{' '}
          <code>parseSorts</code> and <code>parseFilters</code> the library
          exports. Sort twice quickly and watch the first request abort — with
          no error on screen, because it succeeded in being superseded.
        </>
      }
      details={
        log.length === 0
          ? undefined
          : { label: 'Recent requests', body: log.join('\n') }
      }
      error={error}
      pending={
        controller === null && error === null
          ? 'Starting the service worker…'
          : null
      }
    >
      {controller === null ? null : (
        <DataGrid<Order>
          {...controller.gridProps}
          getRowId={(row) => row.id}
          viewModel={viewModel}
        />
      )}
    </DemoFrame>
  );
}
