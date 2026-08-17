import { isDevelopment } from '../internal/dev';
import { createPatchableRowSource } from '../core/row-source';
import type { PatchableRowSource } from '../core/row-source';
import type {
  DataGridColumnStats,
  DataGridColumnStatsSource,
  DataGridFilter,
  DataGridRowId,
  DataGridSort,
} from '../core/types';
import type { DataGridViewModel } from '../core/view-model';
import { createGridStore } from '../store';
import type { GridStore, ReadonlyGridStore } from '../store';
import type { GridDataSource, GridQuery } from './types';

export type GridControllerStatus = 'idle' | 'loading' | 'ready' | 'error';

export type CreateGridControllerOptions<TRow> = {
  source: GridDataSource<TRow>;
  viewModel: DataGridViewModel<TRow>;
  getRowId: (row: TRow) => DataGridRowId;
  /** Rows per request, and the page-full heuristic's threshold. */
  pageSize?: number;
};

export type GridController<TRow> = {
  rowSource: PatchableRowSource<TRow>;
  columnStats: DataGridColumnStatsSource;
  status: ReadonlyGridStore<GridControllerStatus>;
  /** The last error, cleared when a later query succeeds. */
  error: ReadonlyGridStore<Error | null>;
  /** Spread onto `<DataGrid />`. See the note on why this is three keys. */
  gridProps: {
    rowSource: PatchableRowSource<TRow>;
    columnStatsSource: DataGridColumnStatsSource;
    onHeaderStatsVisible: (columnId: string) => void;
  };
  /** Re-run the current query from offset 0, keeping rows mounted meanwhile. */
  refresh: () => void;
  /** What the source declared it can order by; `null` when it said nothing. */
  sortableColumns: ReadonlySet<string> | null;
  dispose: () => void;
};

/** Thrown by `fetch` and by `AbortSignal.throwIfAborted`. */
const isAbort = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';

const asError = (thrown: unknown): Error =>
  thrown instanceof Error ? thrown : new Error(String(thrown));

/**
 * Drives a {@link GridDataSource} from a view model.
 *
 * ## Why it subscribes rather than taking callbacks
 *
 * Sorting and filtering reach the controller through `viewModel.sorts` and
 * `viewModel.filters`, not through the grid's `onSortChange` / `onFilterChange`
 * props. The controller is handed the view model, so it already has those
 * stores — routing the same information back out through a render prop and in
 * again would be a longer path to the same place, and it would consume the two
 * callbacks a host wants for analytics or URL sync.
 *
 * ## Why `gridProps` is three keys and not two
 *
 * `rowSource` and `columnStatsSource` are the data. The third,
 * `onHeaderStatsVisible`, is the lazy-load trigger, and it cannot be folded
 * into `columnStatsSource.get()`: the grid calls `get()` for every rendered
 * header whether or not stats are expanded, so fetching there would load stats
 * for every column on mount. `onHeaderStatsVisible` fires only when a header
 * actually shows its stats, which is the behaviour
 * `data-grid-stats.spec.tsx` pins.
 *
 * ## The four things that go wrong in hand-rolled versions
 *
 * Every one of these is load-bearing and each has its own spec:
 *
 * 1. **Stale responses.** A fast sort toggle has two requests in flight; the
 *    first can land second. Every query carries a generation, and a response
 *    from a superseded generation is dropped rather than rendered.
 * 2. **Aborts surfacing as errors.** Superseding a query aborts it, and the
 *    rejection that produces is *success* — it means the newer query won. A
 *    controller that reports it paints an error banner on every quick toggle.
 * 3. **Rows disappearing during a refetch.** Clearing rows before the request
 *    flashes an empty grid and drops scroll position. Rows stay mounted; the
 *    grid draws its own refreshing bar off `isLoading`.
 * 4. **Stats reloading on sort.** Sorting reorders the same population, so the
 *    stats are unchanged. Only a filter change invalidates them.
 */
export function createGridController<TRow>({
  source,
  viewModel,
  getRowId,
  pageSize = 200,
}: CreateGridControllerOptions<TRow>): GridController<TRow> {
  const status = createGridStore<GridControllerStatus>('idle');
  const error = createGridStore<Error | null>(null);

  const rows = createGridStore<TRow[]>([]);
  const totalRows = createGridStore<number | null>(null);
  const hasMore = createGridStore(false);
  const isLoading = createGridStore(false);

  /**
   * Incremented by anything that invalidates the current result set. A
   * response tagged with an older generation is discarded, which is the only
   * defence against out-of-order completion.
   */
  let generation = 0;
  let inFlight: AbortController | null = null;
  let disposed = false;

  const statsStores = new Map<
    string,
    GridStore<DataGridColumnStats | undefined>
  >();
  /** Columns a header has asked for, so a filter change knows what to redo. */
  const statsRequested = new Set<string>();
  const statsGeneration = new Map<string, number>();
  const statsInFlight = new Map<string, AbortController>();

  const statsStoreFor = (
    columnId: string
  ): GridStore<DataGridColumnStats | undefined> => {
    const existing = statsStores.get(columnId);
    if (existing !== undefined) {
      return existing;
    }
    const created = createGridStore<DataGridColumnStats | undefined>(undefined);
    statsStores.set(columnId, created);
    return created;
  };

  /**
   * What the source says it can order by, or `null` for "anything".
   *
   * Read once: a capability is a property of the backend, not of the moment.
   */
  const sortable: ReadonlySet<string> | null = (() => {
    const declared = source.sortableColumns?.();
    return declared === undefined ? null : new Set(declared);
  })();

  const warnedSorts = new Set<string>();

  /**
   * Drops sorts the source cannot honour.
   *
   * Sending one anyway is worse than dropping it: an endpoint that ignores an
   * unknown `sort` parameter returns its default order, the grid draws an
   * arrow on the column, and the user reads a list they believe is sorted.
   * Dropping it leaves the arrow off and the order honest.
   */
  const supportedSorts = (sorts: DataGridSort[]): DataGridSort[] => {
    if (sortable === null) {
      return sorts;
    }
    return sorts.filter((sort) => {
      if (sortable.has(sort.columnId)) {
        return true;
      }
      if (isDevelopment() && !warnedSorts.has(sort.columnId)) {
        warnedSorts.add(sort.columnId);
        console.warn(
          `Column "${sort.columnId}" is not in this source's ` +
            '`sortableColumns()`, so the sort was dropped rather than sent and ' +
            'silently ignored. Mark the column `sortable: false` to stop the ' +
            'grid offering it.'
        );
      }
      return false;
    });
  };

  const query = (offset: number, signal: AbortSignal): GridQuery => ({
    offset,
    limit: pageSize,
    sorts: supportedSorts(viewModel.sorts.snapshot()),
    filters: viewModel.filters.snapshot(),
    signal,
  });

  /**
   * `total === null` means the source cannot count, so the only evidence of
   * more rows is a page that came back full. A short page ends the list.
   */
  const inferHasMore = (
    total: number | null,
    loaded: number,
    pageLength: number
  ): boolean => (total === null ? pageLength === pageSize : loaded < total);

  const fail = (thrown: unknown): void => {
    if (isAbort(thrown)) {
      return;
    }
    // One pass, at the end. Clearing before the request would flash an empty
    // grid on every failed refresh; clearing in stages would render twice.
    rows.set([]);
    totalRows.set(0);
    hasMore.set(false);
    error.set(asError(thrown));
    status.set('error');
  };

  const loadFirstPage = (): void => {
    generation += 1;
    const current = generation;
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    isLoading.set(true);
    status.set('loading');

    void (async () => {
      try {
        const page = await source.loadPage(query(0, controller.signal));
        if (current !== generation || disposed) {
          return;
        }

        // `loadPage` may return null for a total the source cannot compute in
        // the same round trip. `loadTotal` is the second chance; a source
        // offering neither falls through to the page-full heuristic.
        let total = page.total;
        if (total === null && source.loadTotal !== undefined) {
          total = await source.loadTotal({
            filters: viewModel.filters.snapshot(),
            signal: controller.signal,
          });
          if (current !== generation || disposed) {
            return;
          }
        }

        rows.set(page.rows);
        totalRows.set(total);
        hasMore.set(inferHasMore(total, page.rows.length, page.rows.length));
        error.set(null);
        status.set('ready');
      } catch (thrown) {
        if (current !== generation || disposed) {
          return;
        }
        fail(thrown);
      } finally {
        if (current === generation) {
          isLoading.set(false);
        }
      }
    })();
  };

  const loadMore = (): void => {
    // Re-entrancy guard. The grid fires `loadMore` from both a scroll handler
    // and an IntersectionObserver, so it arrives twice for one gesture.
    if (isLoading.snapshot() || !hasMore.snapshot() || disposed) {
      return;
    }

    const current = generation;
    const controller = new AbortController();
    // Tracked so a sort or filter landing mid-page aborts this rather than
    // leaving it to run to completion and be thrown away on generation check.
    inFlight = controller;
    const offset = rows.snapshot().length;
    isLoading.set(true);

    void (async () => {
      try {
        const page = await source.loadPage(query(offset, controller.signal));
        // A sort or filter landed while this page was in flight; appending it
        // would interleave rows from two different orderings.
        if (current !== generation || disposed) {
          return;
        }

        const next = [...rows.snapshot(), ...page.rows];
        rows.set(next);
        const total = page.total ?? totalRows.snapshot();
        totalRows.set(total);
        hasMore.set(inferHasMore(total, next.length, page.rows.length));
        error.set(null);
        status.set('ready');
      } catch (thrown) {
        if (current !== generation || disposed) {
          return;
        }
        fail(thrown);
      } finally {
        if (current === generation) {
          isLoading.set(false);
        }
      }
    })();
  };

  const loadStats = (columnId: string): void => {
    const load = source.loadColumnStats;
    if (load === undefined || disposed) {
      return;
    }

    const store = statsStoreFor(columnId);
    const current = generation;
    statsGeneration.set(columnId, current);
    // Filters can change twice before one histogram returns. Same problem as
    // the page query, same fix, scoped per column so one slow column does not
    // cancel its neighbours.
    statsInFlight.get(columnId)?.abort();
    const controller = new AbortController();
    statsInFlight.set(columnId, controller);
    store.set({ kind: 'loading' });

    void (async () => {
      try {
        const stats = await load({
          columnId,
          filters: viewModel.filters.snapshot(),
          signal: controller.signal,
        });
        if (statsGeneration.get(columnId) !== current || disposed) {
          return;
        }
        store.set(stats);
      } catch (thrown) {
        if (statsGeneration.get(columnId) !== current || disposed) {
          return;
        }
        if (isAbort(thrown)) {
          return;
        }
        // Reported in the header rather than as a grid-level error: failing to
        // summarise a column says nothing about the rows, which are fine.
        store.set({ kind: 'error', message: asError(thrown).message });
      }
    })();
  };

  const onHeaderStatsVisible = (columnId: string): void => {
    if (statsRequested.has(columnId)) {
      return;
    }
    statsRequested.add(columnId);
    loadStats(columnId);
  };

  const sameSorts = (left: DataGridSort[], right: DataGridSort[]): boolean =>
    left.length === right.length &&
    left.every(
      (sort, index) =>
        sort.columnId === right[index]?.columnId &&
        sort.direction === right[index]?.direction
    );

  const sameFilters = (
    left: DataGridFilter[],
    right: DataGridFilter[]
  ): boolean =>
    left.length === right.length &&
    left.every(
      (filter, index) =>
        filter.columnId === right[index]?.columnId &&
        // Filter values are opaque to the grid — structured objects, scalars,
        // whatever an adapter understands. JSON is the only comparison
        // available that does not require knowing the shape.
        JSON.stringify(filter.value) === JSON.stringify(right[index]?.value)
    );

  let lastSorts = viewModel.sorts.snapshot();
  let lastFilters = viewModel.filters.snapshot();

  const unsubscribeSorts = viewModel.sorts.subscribe((next) => {
    if (sameSorts(lastSorts, next)) {
      return;
    }
    lastSorts = next;
    loadFirstPage();
  });

  const unsubscribeFilters = viewModel.filters.subscribe((next) => {
    if (sameFilters(lastFilters, next)) {
      return;
    }
    lastFilters = next;
    loadFirstPage();
    // A filter changes the population, so every summary of it is now wrong.
    // Only the columns a header has actually asked for get redone — the rest
    // will load on demand, against the new filters, when they are shown.
    for (const columnId of statsRequested) {
      loadStats(columnId);
    }
  });

  const rowSource = createPatchableRowSource<TRow>({
    getRowId,
    loadMore,
    rows,
    totalRows,
    hasMore,
    isLoading,
  });

  const columnStats: DataGridColumnStatsSource = {
    get: (columnId) => statsStoreFor(columnId),
  };

  /*
   * Fold the capability into the columns, so the header stops offering a sort
   * the source cannot perform.
   *
   * Intersected, never widened: a column the caller marked `sortable: false`
   * stays that way regardless of what the source can do. The capability can
   * only take a sort away.
   */
  const applySortCapability = (): void => {
    if (sortable === null) {
      return;
    }
    const columns = viewModel.columns.snapshot();
    let changed = false;
    const next = columns.map((column) => {
      const allowed = sortable.has(column.id);
      if (!allowed && column.sortable !== false) {
        changed = true;
        return { ...column, sortable: false };
      }
      return column;
    });
    if (changed) {
      viewModel.columns.set(next);
    }
  };

  applySortCapability();
  const unsubscribeColumns = viewModel.columns.subscribe(applySortCapability);

  loadFirstPage();

  return {
    rowSource,
    columnStats,
    status,
    error,
    gridProps: {
      rowSource,
      columnStatsSource: columnStats,
      onHeaderStatsVisible,
    },
    refresh: loadFirstPage,
    sortableColumns: sortable,
    dispose: () => {
      disposed = true;
      inFlight?.abort();
      for (const controller of statsInFlight.values()) {
        controller.abort();
      }
      unsubscribeSorts();
      unsubscribeFilters();
      unsubscribeColumns();
    },
  };
}
