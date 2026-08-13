import type {
  DataGridColumnStats,
  DataGridFilter,
  DataGridSort,
} from '../core/types';

/**
 * One page request, fully described.
 *
 * Everything an adapter needs to build a query is here, which is what lets the
 * same controller drive an in-memory array, an HTTP endpoint and a DuckDB
 * table without knowing which it has. `sorts` and `filters` arrive as the grid
 * holds them — resolving what a filter *value* means is the adapter's job,
 * because only the adapter knows whether a substring match is `ILIKE` or
 * `String.includes`.
 */
export type GridQuery = {
  offset: number;
  limit: number;
  sorts: DataGridSort[];
  filters: DataGridFilter[];
  /**
   * Aborted when a newer query supersedes this one. Forward it to `fetch` and
   * to any cancellable driver; an adapter that ignores it still works, it just
   * does wasted work on a fast sort toggle.
   */
  signal?: AbortSignal;
};

export type GridPage<TRow> = {
  rows: TRow[];
  /**
   * Rows matching the filters, ignoring `offset`/`limit`. `null` for a source
   * that cannot count without scanning — the controller then infers "is there
   * more" from whether the page came back full, which is why returning a wrong
   * number is worse than returning `null`.
   */
  total: number | null;
};

/**
 * What the grid needs from a backing store.
 *
 * Only `loadPage` is required. The optional members exist because some sources
 * can answer them cheaply and others cannot: DuckDB computes a histogram in
 * one query, an HTTP endpoint usually cannot, and neither should be forced to
 * pretend.
 */
export type GridDataSource<TRow> = {
  loadPage(query: GridQuery): Promise<GridPage<TRow>>;

  /**
   * Stats for one column, under the current filters.
   *
   * Filters are passed because the stats describe what the grid is showing,
   * not the whole table — a histogram that ignored an active filter would
   * disagree with the rows underneath it.
   */
  loadColumnStats?(input: {
    columnId: string;
    filters: DataGridFilter[];
    signal?: AbortSignal;
  }): Promise<DataGridColumnStats>;

  /**
   * An exact count when `loadPage` returned `null` for it — a source that can
   * count, but not in the same round trip as the page.
   */
  loadTotal?(input: {
    filters: DataGridFilter[];
    signal?: AbortSignal;
  }): Promise<number | null>;
};
