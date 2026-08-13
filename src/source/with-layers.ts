import { isDevelopment } from '../internal/dev';
import type { DataGridColumn, DataGridSort } from '../core/types';
import { LayerStack } from './layers/stack';
import type { GridSourceLayer } from './layers/types';
import type { GridDataSource } from './types';

export type WithLayersOptions<TRow> = {
  source: GridDataSource<TRow>;
  layers: readonly GridSourceLayer<TRow>[];
  getRowId: (row: TRow) => string | number;
};

export type LayeredSource<TRow> = {
  source: GridDataSource<TRow>;
  stack: LayerStack<TRow>;
  /**
   * The source's own columns with the layers' laid ahead of them, ready for
   * the view model.
   *
   * Order is presentation columns, then enriched columns, then the base — the
   * same outermost-first rule the stack applies internally, so a selection
   * checkbox lands left of a looked-up name, which lands left of the data.
   */
  columns: (
    baseColumns: readonly DataGridColumn<TRow>[]
  ) => DataGridColumn<TRow>[];
};

/**
 * Runs a layer stack's enrichment over every page a source returns.
 *
 * The wrapper is thin on purpose: enrichment is a `map` over a page that has
 * already been fetched, so there is no query to rewrite and no total to
 * adjust — the rows are the same rows, with more fields on them.
 *
 * What it also does is refuse to lie. If a sort or filter addresses an
 * enriched column, the grid is asking for something enrichment physically
 * cannot do — the page was chosen by the source before this layer ever saw it,
 * so reordering it here would reorder one page and look like it worked. The
 * request is dropped, with a dev-mode warning naming the column.
 *
 * That case should be unreachable: enriched columns are marked
 * `sortable: false, filterable: false` by {@link LayerStack}, and
 * `EnrichedColumn` removes both keys so a layer cannot ask for them. This is
 * the backstop for a caller who builds the column list by hand.
 */
export function withLayers<TRow>({
  source,
  layers,
  getRowId,
}: WithLayersOptions<TRow>): LayeredSource<TRow> {
  const stack = new LayerStack<TRow>(layers, { getRowId });
  const enrichedIds = new Set(stack.enrichedColumns.map((column) => column.id));

  const warnedFor = new Set<string>();
  const strip = <T extends { columnId: string }>(
    entries: readonly T[],
    what: 'sorted' | 'filtered'
  ): T[] =>
    entries.filter((entry) => {
      if (!enrichedIds.has(entry.columnId)) {
        return true;
      }
      if (isDevelopment() && !warnedFor.has(`${what}:${entry.columnId}`)) {
        warnedFor.add(`${what}:${entry.columnId}`);
        console.warn(
          `Column "${entry.columnId}" is attached by an enriching layer, so it ` +
            `cannot be ${what}: the grid holds one page of a result the source ` +
            'chose before the layer ran. Use a `project` layer on a SQL source ' +
            'if you need the engine to order or filter by this column.'
        );
      }
      return false;
    });

  return {
    stack,
    columns: (baseColumns) => [
      ...stack.present({
        gridHolder: { current: null },
        rowsHolder: { current: [] },
        getRowId,
      }).columns,
      ...stack.enrichedColumns,
      ...baseColumns,
    ],
    source: {
      ...source,
      async loadPage(query) {
        const page = await source.loadPage({
          ...query,
          sorts: strip<DataGridSort>(query.sorts, 'sorted'),
          filters: strip(query.filters, 'filtered'),
        });
        return {
          ...page,
          rows: await stack.enrich(page.rows, query.signal),
        };
      },
    },
  };
}
