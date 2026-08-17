import { describe, expect, it, vi } from 'vitest';
import type { DataGridColumn, DataGridColumnStats } from '../../core/types';
import { createDataGridViewModel } from '../../core/view-model';
import { createGridController } from '../controller';
import type { GridDataSource, GridPage, GridQuery } from '../types';

type Row = { id: number; name: string };

const COLUMNS: DataGridColumn<Row>[] = [
  { id: 'id', header: 'Id', type: 'number', getValue: (row) => row.id },
  { id: 'name', header: 'Name', type: 'text', getValue: (row) => row.name },
];

const rowsFrom = (count: number, offset = 0): Row[] =>
  Array.from({ length: count }, (_, index) => ({
    id: offset + index,
    name: `row-${String(offset + index)}`,
  }));

const viewModelFor = () => createDataGridViewModel<Row>({ columns: COLUMNS });

/** Lets a spec decide the order two in-flight requests resolve in. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
};

describe('grid controller — wiring', () => {
  it('loads the first page on construction and exposes it as a row source', async () => {
    const source: GridDataSource<Row> = {
      loadPage: () => Promise.resolve({ rows: rowsFrom(3), total: 3 }),
    };
    const controller = createGridController({
      source,
      viewModel: viewModelFor(),
      getRowId: (row) => row.id,
    });

    await flush();

    expect({
      rows: controller.rowSource.rows.snapshot().length,
      total: controller.rowSource.totalRows.snapshot(),
      status: controller.status.snapshot(),
      hasMore: controller.rowSource.hasMore.snapshot(),
    }).toMatchObject({ rows: 3, total: 3, status: 'ready', hasMore: false });

    controller.dispose();
  });

  // Sorting and filtering arrive by subscription, not through the grid's
  // `onSortChange` / `onFilterChange` props — those stay free for the host.
  it('reloads when the view model sorts change, without any prop wiring', async () => {
    const queries: GridQuery[] = [];
    const source: GridDataSource<Row> = {
      loadPage: (query) => {
        queries.push(query);
        return Promise.resolve({ rows: rowsFrom(2), total: 2 });
      },
    };
    const viewModel = viewModelFor();
    const controller = createGridController({
      source,
      viewModel,
      getRowId: (row) => row.id,
    });
    await flush();

    viewModel.setSort('name', 'desc');
    await flush();

    expect(queries.map((query) => query.sorts)).toMatchObject([
      [],
      [{ columnId: 'name', direction: 'desc' }],
    ]);

    controller.dispose();
  });

  it('does not reload when a sort is re-set to the value it already has', async () => {
    const loadPage = vi.fn(() =>
      Promise.resolve<GridPage<Row>>({ rows: rowsFrom(2), total: 2 })
    );
    const viewModel = viewModelFor();
    const controller = createGridController({
      source: { loadPage },
      viewModel,
      getRowId: (row) => row.id,
    });
    await flush();

    viewModel.setSort('name', 'asc');
    await flush();
    viewModel.setSort('name', 'asc');
    await flush();

    expect(loadPage).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
});

describe('grid controller — stale responses', () => {
  // The bug this prevents: toggle a sort twice quickly, the first request
  // lands second, and the grid renders the ordering the user already moved on
  // from. Every query carries a generation and the loser is dropped.
  it('discards a response from a superseded query', async () => {
    const first = deferred<GridPage<Row>>();
    const second = deferred<GridPage<Row>>();
    const pages = [first, second];
    let index = 0;

    const source: GridDataSource<Row> = {
      loadPage: () => {
        const page = pages[index]?.promise;
        index += 1;
        return page ?? Promise.resolve({ rows: [], total: 0 });
      },
    };
    const viewModel = viewModelFor();
    const controller = createGridController({
      source,
      viewModel,
      getRowId: (row) => row.id,
    });

    viewModel.setSort('name', 'asc');
    await flush();

    // Resolve out of order: the newer query first, then the one it replaced.
    second.resolve({ rows: [{ id: 99, name: 'newer' }], total: 1 });
    await flush();
    first.resolve({ rows: [{ id: 1, name: 'older' }], total: 1 });
    await flush();

    expect(controller.rowSource.rows.snapshot()).toMatchObject([
      { id: 99, name: 'newer' },
    ]);

    controller.dispose();
  });

  // The single most common bug in hand-rolled versions: superseding a query
  // aborts it, the abort rejects, and the controller paints an error banner
  // for what was actually a success.
  it('swallows an AbortError rather than surfacing it as an error', async () => {
    const source: GridDataSource<Row> = {
      loadPage: (query) =>
        new Promise((resolve, reject) => {
          query.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
          setTimeout(() => {
            resolve({ rows: rowsFrom(1), total: 1 });
          }, 5);
        }),
    };
    const viewModel = viewModelFor();
    const controller = createGridController({
      source,
      viewModel,
      getRowId: (row) => row.id,
    });

    // Supersede before the first can settle — this aborts it.
    viewModel.setSort('name', 'asc');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect({
      error: controller.error.snapshot(),
      status: controller.status.snapshot(),
    }).toMatchObject({ error: null, status: 'ready' });

    controller.dispose();
  });
});

describe('grid controller — loading and paging', () => {
  it('keeps rows mounted during a refetch', async () => {
    const pending = deferred<GridPage<Row>>();
    let call = 0;
    const source: GridDataSource<Row> = {
      loadPage: () => {
        call += 1;
        return call === 1
          ? Promise.resolve({ rows: rowsFrom(3), total: 3 })
          : pending.promise;
      },
    };
    const controller = createGridController({
      source,
      viewModel: viewModelFor(),
      getRowId: (row) => row.id,
    });
    await flush();

    controller.refresh();
    await flush();

    // Mid-refetch: the old rows are still on screen and `isLoading` is what
    // the grid draws its refreshing bar from.
    expect({
      rows: controller.rowSource.rows.snapshot().length,
      isLoading: controller.rowSource.isLoading.snapshot(),
    }).toMatchObject({ rows: 3, isLoading: true });

    pending.resolve({ rows: rowsFrom(2), total: 2 });
    await flush();
    expect(controller.rowSource.rows.snapshot()).toHaveLength(2);

    controller.dispose();
  });

  it('appends on loadMore and stops when the total is reached', async () => {
    const source: GridDataSource<Row> = {
      loadPage: (query) =>
        Promise.resolve({ rows: rowsFrom(2, query.offset), total: 4 }),
    };
    const controller = createGridController({
      source,
      viewModel: viewModelFor(),
      getRowId: (row) => row.id,
      pageSize: 2,
    });
    await flush();
    expect(controller.rowSource.hasMore.snapshot()).toBe(true);

    await controller.rowSource.loadMore();
    await flush();

    expect({
      ids: controller.rowSource.rows.snapshot().map((row) => row.id),
      hasMore: controller.rowSource.hasMore.snapshot(),
    }).toMatchObject({ ids: [0, 1, 2, 3], hasMore: false });

    controller.dispose();
  });

  // The grid calls loadMore from both a scroll handler and an
  // IntersectionObserver, so it arrives twice for one gesture.
  it('guards loadMore against re-entry while a page is in flight', async () => {
    const pending = deferred<GridPage<Row>>();
    let call = 0;
    const loadPage = vi.fn(() => {
      call += 1;
      return call === 1
        ? Promise.resolve<GridPage<Row>>({ rows: rowsFrom(2), total: 10 })
        : pending.promise;
    });
    const controller = createGridController({
      source: { loadPage },
      viewModel: viewModelFor(),
      getRowId: (row) => row.id,
      pageSize: 2,
    });
    await flush();

    await controller.rowSource.loadMore();
    await controller.rowSource.loadMore();
    await controller.rowSource.loadMore();

    expect(loadPage).toHaveBeenCalledTimes(2);
    pending.resolve({ rows: rowsFrom(2, 2), total: 10 });
    controller.dispose();
  });

  // With no total there is nothing to compare against, so the only evidence of
  // more rows is a page that came back full.
  it('infers hasMore from a full page when the total is null', async () => {
    const source: GridDataSource<Row> = {
      loadPage: (query) =>
        Promise.resolve({
          rows: rowsFrom(query.offset === 0 ? 2 : 1, query.offset),
          total: null,
        }),
    };
    const controller = createGridController({
      source,
      viewModel: viewModelFor(),
      getRowId: (row) => row.id,
      pageSize: 2,
    });
    await flush();
    expect(controller.rowSource.hasMore.snapshot()).toBe(true);

    await controller.rowSource.loadMore();
    await flush();
    // A short page ends the list.
    expect(controller.rowSource.hasMore.snapshot()).toBe(false);

    controller.dispose();
  });

  it('falls back to loadTotal when loadPage cannot count', async () => {
    const controller = createGridController({
      source: {
        loadPage: () => Promise.resolve({ rows: rowsFrom(2), total: null }),
        loadTotal: () => Promise.resolve(57),
      },
      viewModel: viewModelFor(),
      getRowId: (row) => row.id,
      pageSize: 2,
    });
    await flush();

    expect(controller.rowSource.totalRows.snapshot()).toBe(57);
    controller.dispose();
  });
});

describe('grid controller — errors', () => {
  // Clearing before the request flashes an empty grid on every failed refresh.
  // Rows survive until the failure is known, then go in one pass.
  it('empties once on failure rather than clearing then failing', async () => {
    const pending = deferred<GridPage<Row>>();
    let call = 0;
    const source: GridDataSource<Row> = {
      loadPage: () => {
        call += 1;
        return call === 1
          ? Promise.resolve({ rows: rowsFrom(3), total: 3 })
          : pending.promise;
      },
    };
    const controller = createGridController({
      source,
      viewModel: viewModelFor(),
      getRowId: (row) => row.id,
    });
    await flush();

    const seen: number[] = [];
    controller.rowSource.rows.subscribe((rows) => {
      seen.push(rows.length);
    });

    controller.refresh();
    await flush();
    pending.reject(new Error('backend exploded'));
    await flush();

    expect({
      transitions: seen,
      rows: controller.rowSource.rows.snapshot(),
      total: controller.rowSource.totalRows.snapshot(),
      hasMore: controller.rowSource.hasMore.snapshot(),
      status: controller.status.snapshot(),
      message: controller.error.snapshot()?.message,
    }).toMatchObject({
      transitions: [0],
      rows: [],
      total: 0,
      hasMore: false,
      status: 'error',
      message: 'backend exploded',
    });

    controller.dispose();
  });

  it('clears the error once a later query succeeds', async () => {
    let call = 0;
    const source: GridDataSource<Row> = {
      loadPage: () => {
        call += 1;
        return call === 1
          ? Promise.reject(new Error('nope'))
          : Promise.resolve({ rows: rowsFrom(1), total: 1 });
      },
    };
    const controller = createGridController({
      source,
      viewModel: viewModelFor(),
      getRowId: (row) => row.id,
    });
    await flush();
    expect(controller.status.snapshot()).toBe('error');

    controller.refresh();
    await flush();

    expect({
      status: controller.status.snapshot(),
      error: controller.error.snapshot(),
    }).toMatchObject({ status: 'ready', error: null });

    controller.dispose();
  });
});

describe('grid controller — column stats', () => {
  const statsSource = (
    loadColumnStats: GridDataSource<Row>['loadColumnStats']
  ): GridDataSource<Row> => ({
    loadPage: () => Promise.resolve({ rows: rowsFrom(1), total: 1 }),
    loadColumnStats,
  });

  it('loads a column lazily, once, when its header asks', async () => {
    const loadColumnStats = vi.fn(() =>
      Promise.resolve<DataGridColumnStats>({
        kind: 'summary',
        label: 'rows',
        value: 1,
      })
    );
    const controller = createGridController({
      source: statsSource(loadColumnStats),
      viewModel: viewModelFor(),
      getRowId: (row) => row.id,
    });
    await flush();

    // Reading the store does not fetch — the grid calls `get` for every
    // rendered header whether or not stats are expanded.
    expect(controller.columnStats.get('name').snapshot()).toBeUndefined();
    expect(loadColumnStats).not.toHaveBeenCalled();

    controller.gridProps.onHeaderStatsVisible('name');
    controller.gridProps.onHeaderStatsVisible('name');
    await flush();

    expect(loadColumnStats).toHaveBeenCalledTimes(1);
    expect(controller.columnStats.get('name').snapshot()).toMatchObject({
      kind: 'summary',
    });

    controller.dispose();
  });

  // Sorting reorders the same population, so a summary of it is unchanged.
  it('does not reload stats on a sort change', async () => {
    const loadColumnStats = vi.fn(() =>
      Promise.resolve<DataGridColumnStats>({ kind: 'loading' })
    );
    const viewModel = viewModelFor();
    const controller = createGridController({
      source: statsSource(loadColumnStats),
      viewModel,
      getRowId: (row) => row.id,
    });
    await flush();
    controller.gridProps.onHeaderStatsVisible('name');
    await flush();

    viewModel.setSort('name', 'asc');
    await flush();

    expect(loadColumnStats).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  // Filtering changes the population, so every summary of it is now wrong.
  it('reloads already-requested stats on a filter change', async () => {
    // Typed through the source, so `mock.calls` carries the real argument
    // tuple and the assertion below can read the filters it was given.
    const loadColumnStats: NonNullable<GridDataSource<Row>['loadColumnStats']> =
      vi.fn(() => Promise.resolve<DataGridColumnStats>({ kind: 'loading' }));
    const viewModel = viewModelFor();
    const controller = createGridController({
      source: statsSource(loadColumnStats),
      viewModel,
      getRowId: (row) => row.id,
    });
    await flush();
    controller.gridProps.onHeaderStatsVisible('name');
    await flush();

    viewModel.setFilter('name', 'row');
    await flush();

    expect(vi.mocked(loadColumnStats)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(loadColumnStats).mock.calls.at(-1)?.[0]).toMatchObject({
      columnId: 'name',
      filters: [{ columnId: 'name', value: 'row' }],
    });

    controller.dispose();
  });

  // A column that will not summarise says nothing about the rows, which are
  // fine — so it reports in the header rather than as a grid-level error.
  it('reports a stats failure on the column, not on the grid', async () => {
    const controller = createGridController({
      source: statsSource(() => Promise.reject(new Error('no histogram'))),
      viewModel: viewModelFor(),
      getRowId: (row) => row.id,
    });
    await flush();
    controller.gridProps.onHeaderStatsVisible('name');
    await flush();

    expect({
      columnStats: controller.columnStats.get('name').snapshot(),
      gridStatus: controller.status.snapshot(),
      gridError: controller.error.snapshot(),
    }).toMatchObject({
      columnStats: { kind: 'error', message: 'no histogram' },
      gridStatus: 'ready',
      gridError: null,
    });

    controller.dispose();
  });

  it('returns the same store for repeated gets, so headers stay subscribed', () => {
    const controller = createGridController({
      source: statsSource(undefined),
      viewModel: viewModelFor(),
      getRowId: (row) => row.id,
    });

    expect(controller.columnStats.get('name')).toBe(
      controller.columnStats.get('name')
    );
    controller.dispose();
  });
});

describe('grid controller — dispose', () => {
  it('stops responding to view model changes', async () => {
    const loadPage = vi.fn(() =>
      Promise.resolve<GridPage<Row>>({ rows: rowsFrom(1), total: 1 })
    );
    const viewModel = viewModelFor();
    const controller = createGridController({
      source: { loadPage },
      viewModel,
      getRowId: (row) => row.id,
    });
    await flush();

    controller.dispose();
    viewModel.setSort('name', 'asc');
    viewModel.setFilter('name', 'x');
    await flush();

    expect(loadPage).toHaveBeenCalledTimes(1);
  });
});

/**
 * Not every source can sort by every column.
 *
 * An engine can; an HTTP endpoint that accepts `sort=name|created` and
 * silently ignores anything else cannot. Sending it one anyway is the worst
 * outcome available: the backend returns its default order, the grid draws a
 * sort arrow, and the user reads a list they believe is sorted.
 */
describe('grid controller — sortableColumns', () => {
  const sourceThatSorts = (
    sortableColumns: string[] | undefined,
    loadPage = vi.fn(() =>
      Promise.resolve<GridPage<Row>>({ rows: rowsFrom(2), total: 2 })
    )
  ): GridDataSource<Row> =>
    sortableColumns === undefined
      ? { loadPage }
      : { loadPage, sortableColumns: () => sortableColumns };

  it('sends every sort when the source declares nothing', async () => {
    const queries: GridQuery[] = [];
    const viewModel = viewModelFor();
    const controller = createGridController({
      source: {
        loadPage: (q) => {
          queries.push(q);
          return Promise.resolve({ rows: rowsFrom(1), total: 1 });
        },
      },
      viewModel,
      getRowId: (row) => row.id,
    });
    await flush();
    viewModel.setSort('name', 'asc');
    await flush();

    expect(queries.at(-1)?.sorts).toMatchObject([
      { columnId: 'name', direction: 'asc' },
    ]);
    expect(controller.sortableColumns).toBeNull();
    controller.dispose();
  });

  it('drops a sort the source cannot honour', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const queries: GridQuery[] = [];
    const viewModel = viewModelFor();
    const controller = createGridController({
      source: {
        loadPage: (q) => {
          queries.push(q);
          return Promise.resolve({ rows: rowsFrom(1), total: 1 });
        },
        sortableColumns: () => ['id'],
      },
      viewModel,
      getRowId: (row) => row.id,
    });
    await flush();

    viewModel.setSort('name', 'asc');
    await flush();

    // The query goes out unsorted rather than carrying a sort the backend
    // would ignore.
    expect(queries.at(-1)?.sorts).toMatchObject([]);
    expect(warn.mock.calls[0]?.[0]).toContain('name');
    warn.mockRestore();
    controller.dispose();
  });

  it('keeps a sort the source does declare', async () => {
    const queries: GridQuery[] = [];
    const viewModel = viewModelFor();
    const controller = createGridController({
      source: {
        loadPage: (q) => {
          queries.push(q);
          return Promise.resolve({ rows: rowsFrom(1), total: 1 });
        },
        sortableColumns: () => ['id', 'name'],
      },
      viewModel,
      getRowId: (row) => row.id,
    });
    await flush();
    viewModel.setSort('name', 'desc');
    await flush();

    expect(queries.at(-1)?.sorts).toMatchObject([
      { columnId: 'name', direction: 'desc' },
    ]);
    controller.dispose();
  });

  // The header should not offer a control that cannot work.
  it('marks unsupported columns unsortable on the view model', async () => {
    const viewModel = viewModelFor();
    const controller = createGridController({
      source: sourceThatSorts(['id']),
      viewModel,
      getRowId: (row) => row.id,
    });
    await flush();

    expect(
      viewModel.columns.snapshot().map((c) => [c.id, c.sortable])
    ).toMatchObject([
      ['id', undefined],
      ['name', false],
    ]);
    controller.dispose();
  });

  // Intersection, not replacement: a capability can take a sort away and never
  // hand one back that the caller disabled.
  it('never re-enables a column the caller marked unsortable', async () => {
    const viewModel = createDataGridViewModel<Row>({
      columns: [
        { id: 'id', header: 'Id', sortable: false, getValue: (r) => r.id },
        { id: 'name', header: 'Name', getValue: (r) => r.name },
      ],
    });
    const controller = createGridController({
      source: sourceThatSorts(['id', 'name']),
      viewModel,
      getRowId: (row) => row.id,
    });
    await flush();

    expect(viewModel.columns.snapshot()[0]?.sortable).toBe(false);
    controller.dispose();
  });

  it('applies the capability to columns added later', async () => {
    const viewModel = viewModelFor();
    const controller = createGridController({
      source: sourceThatSorts(['id']),
      viewModel,
      getRowId: (row) => row.id,
    });
    await flush();

    viewModel.columns.set([
      ...viewModel.columns.snapshot(),
      { id: 'late', header: 'Late', getValue: () => null },
    ]);

    expect(viewModel.columns.snapshot().at(-1)?.sortable).toBe(false);
    controller.dispose();
  });

  it('exposes the declared set', async () => {
    const controller = createGridController({
      source: sourceThatSorts(['id', 'name']),
      viewModel: viewModelFor(),
      getRowId: (row) => row.id,
    });
    await flush();

    expect([...(controller.sortableColumns ?? [])]).toMatchObject([
      'id',
      'name',
    ]);
    controller.dispose();
  });
});
