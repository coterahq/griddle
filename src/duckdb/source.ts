import type {
  DataGridColumn,
  DataGridColumnStats,
  DataGridFilter,
} from '../core/types';
import { dataGridColumnTypeFromSqlType } from '../core/column-type';
import { SqlLayerStack } from '../source/layers/sql';
import type { SqlSourceLayer } from '../source/layers/sql';
import type { GridDataSource, GridPage, GridQuery } from '../source/types';
import { fromArrowRow, parseRowCount } from './arrow';
import type { DuckDbCellValue } from './arrow';
import { buildCountSql, buildPageSql, buildWhereSql } from './query-sql';
import type { DuckDbColumnDescriptor } from './query-sql';
import { buildSourceSql } from './source-sql';
import type { DuckDbQuery } from './types';

export type CreateDuckDbDataSourceOptions<TRow> = {
  query: DuckDbQuery;
  /**
   * Table name, `read_parquet('…')`, or any expression valid after `FROM`.
   * Quote it yourself if it needs quoting — `duckDbIdentifier` is exported.
   */
  from: string;
  /** The columns the grid will show, including any a layer projects. */
  columns: readonly DuckDbColumnDescriptor[];
  /** Rows arrive as `Record<string, DuckDbCellValue>`; map them if TRow differs. */
  mapRow?: (row: Record<string, DuckDbCellValue>) => TRow;
  /**
   * Column to `ORDER BY` when the grid has no sort of its own.
   *
   * Worth setting. A paged read with no ordering is undefined, so without one
   * rows can repeat or vanish between pages of the same result.
   */
  defaultOrderBy?: string | null;
  /** Header stats. `false` turns them off; omit for the built-in aggregates. */
  stats?: boolean;
  layers?: readonly SqlSourceLayer<TRow>[];
  /** An ad-hoc read-only statement selecting from `source`. */
  customSelectSql?: string;
};

export type DuckDbDataSource<TRow> = GridDataSource<TRow> & {
  /** The resolved `FROM` expression, layers wrapped. Useful for a custom query. */
  sourceSql: () => string;
  /** Source columns plus every column the layer stack projects. */
  columns: readonly DuckDbColumnDescriptor[];
  /** Grid columns for the projected ones, so a caller can append them. */
  projectedGridColumns: readonly DataGridColumn<TRow>[];
  stack: SqlLayerStack<TRow>;
};

/**
 * A {@link GridDataSource} backed by DuckDB.
 *
 * The engine does the work: one query per page, with the grid's sorts and
 * filters compiled into `ORDER BY` and `WHERE`. That is what separates this
 * from fetching rows and sorting them in JavaScript — sorting by a column that
 * came from a *different source* through a `joinLayer` is one query across all
 * of them, and it returns the right rows rather than the right rows out of the
 * page that happened to be loaded.
 *
 * The library does not own the database. `query` is injected, because bundle
 * selection, worker hosting and CSP differ per deployment and a library that
 * guessed would be wrong for somebody on every guess.
 */
export function createDuckDbDataSource<TRow = Record<string, DuckDbCellValue>>({
  query,
  from,
  columns,
  mapRow,
  defaultOrderBy,
  stats = true,
  layers = [],
  customSelectSql = '',
}: CreateDuckDbDataSourceOptions<TRow>): DuckDbDataSource<TRow> {
  const stack = new SqlLayerStack<TRow>(layers);

  // Projected columns are addressable by the grid exactly like native ones —
  // that is the whole difference between `project` and `enrich`.
  const allColumns: readonly DuckDbColumnDescriptor[] = [
    ...columns,
    ...stack.projectedColumns.map((column) => ({
      id: column.name,
      sqlType: column.type,
    })),
  ];

  const projectedGridColumns: readonly DataGridColumn<TRow>[] =
    stack.projectedColumns.map((column) => ({
      id: column.name,
      header: column.name,
      type: dataGridColumnTypeFromSqlType(column.type),
      getValue: (row: TRow) =>
        (row as Record<string, unknown>)[column.name] ?? null,
    }));

  const sourceSql = (): string =>
    buildSourceSql({ from, customSelectSql, wrapSource: stack.wrapSource });

  const toRow = (raw: unknown): TRow => {
    const normalised = fromArrowRow(raw);
    return mapRow === undefined ? (normalised as TRow) : mapRow(normalised);
  };

  const loadTotal = async ({
    filters,
    signal,
  }: {
    filters: DataGridFilter[];
    signal?: AbortSignal;
  }): Promise<number | null> => {
    const result = await query(
      buildCountSql({ source: sourceSql(), columns: allColumns, filters })
    );
    signal?.throwIfAborted();
    const row = result.toArray()[0];
    return parseRowCount(
      (row as Record<string, unknown> | undefined)?.['dg_total']
    );
  };

  const source: DuckDbDataSource<TRow> = {
    stack,
    columns: allColumns,
    projectedGridColumns,
    sourceSql,

    async loadPage(gridQuery: GridQuery): Promise<GridPage<TRow>> {
      const resolved = sourceSql();
      const sql = buildPageSql({
        source: resolved,
        columns: allColumns,
        sorts: gridQuery.sorts,
        filters: gridQuery.filters,
        offset: gridQuery.offset,
        limit: gridQuery.limit,
        defaultOrderBy,
      });
      const result = await query(sql);
      // DuckDB has no cancellation on this path, so the abort is honoured
      // after the fact: the work is wasted either way, but the controller must
      // not be handed a page it no longer wants.
      gridQuery.signal?.throwIfAborted();
      const rows = result.toArray().map(toRow);

      // `null`, always. Counting here would run a second aggregate on every
      // page to answer a question that does not change between them; the
      // controller calls `loadTotal` once per generation instead.
      return { rows, total: null };
    },

    loadTotal,
  };

  if (stats) {
    // Imported lazily-ish: assigning rather than declaring keeps the stats
    // aggregate queries out of a build that turned them off.
    source.loadColumnStats = async ({
      columnId,
      filters,
      signal,
    }): Promise<DataGridColumnStats> => {
      const column = allColumns.find((candidate) => candidate.id === columnId);
      if (column === undefined) {
        return { kind: 'error', message: `Unknown column: ${columnId}` };
      }

      // A projected column may bring its own stats loader — the type-derived
      // aggregate is right for a real column and wrong for a synthesised one.
      const projected = stack.projectedColumns.find(
        (candidate) => candidate.name === columnId
      );

      // Filtered, so the histogram describes the rows on screen rather than
      // the whole table. Layers wrapped, so a joined column resolves.
      const filteredSource = `(SELECT * FROM ${sourceSql()} AS dg_stats${buildWhereSql(
        filters,
        allColumns
      )})`;

      if (projected?.loadStats !== undefined) {
        return projected.loadStats({ sourceSql: filteredSource });
      }

      const { duckDbColumnStats } = await import('./stats');
      const result = await duckDbColumnStats({
        query,
        sourceSql: filteredSource,
        columnName: columnId,
        columnType: column.sqlType,
        gridType: column.type,
      });
      signal?.throwIfAborted();
      return result;
    };
  }

  return source;
}
