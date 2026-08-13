import type React from 'react';
import type {
  DataGridCellValue,
  DataGridColumn,
  DataGridRowDetailContext,
  DataGridRowId,
} from '../../core/types';
import type { DataGridViewModel } from '../../core/view-model';

/**
 * A layer is one thing laid over a data source.
 *
 * There are three physically different ways to lay something over a source,
 * and none collapses into another:
 *
 *  - **Present.** Grid columns laid ahead of the source's own, a live channel
 *    for patching rows already on screen, a row detail panel. Pure React and
 *    grid concepts, so it works against every adapter.
 *  - **Enrich.** Given a page the source already returned, attach fields to
 *    each row from somewhere else. The non-SQL join — an HTTP lookup, a
 *    `Map`, a second grid source.
 *  - **Project** and **mutate** (see `./sql`). SQL-only, because they change
 *    the query the engine runs rather than the rows that came back.
 *
 * What they share is how they compose, how their columns reach the grid, and
 * how they push live updates into loaded rows. That is what this type is. The
 * slots are optional and independent: a row-select checkbox fills only
 * `present`; a user-name lookup fills only `enrich`; an automations overlay
 * fills `project` and `present`.
 *
 * ## Enrich is not project, and the difference is not cosmetic
 *
 * `project` adds columns to the query, so the grid's own `WHERE` and
 * `ORDER BY` address them exactly like native ones — sorting by a joined
 * `name` re-runs one query across every source and returns the right rows.
 *
 * `enrich` attaches fields to a page that has already been fetched. The grid
 * is holding one page of a result it did not run, so sorting by an enriched
 * column could only reorder *that page* — which looks like it worked and is
 * wrong. Filtering on one could only hide rows from the page, leaving a short
 * page and a total that disagrees with it.
 *
 * So enriched columns are not sortable or filterable, and that is enforced
 * rather than documented: {@link EnrichedColumn} removes both keys, so a layer
 * cannot ask for them, and {@link LayerStack} sets them `false` on the way
 * out. Silent wrong ordering is the worst outcome available here.
 */
export type GridSourceLayer<TRow> = {
  /**
   * Stable and unique within a stack. Drives join-alias derivation, the
   * row-detail conflict warning, and the dev check that catches a layer being
   * rebuilt on every render.
   */
  readonly id: string;
  readonly present?: (
    context: LayerPresentationContext<TRow>
  ) => LayerPresentation<TRow>;
  readonly enrich?: (
    context: LayerEnrichmentContext<TRow>
  ) => LayerEnrichment<TRow>;
};

// --------------------------------------------------------------- slot: present

/** The grid's side of a layer's live channel. */
export type LayerGrid = {
  /** Applies new values to one loaded row. A miss is a no-op. */
  readonly patch: (
    rowId: DataGridRowId,
    values: Record<string, DataGridCellValue>
  ) => void;
  /**
   * Adds a row to the loaded set, at the end of it.
   *
   * At the end because that is the only position this can honestly claim:
   * where a row belongs is decided by the active sort, and the grid holds one
   * page of a result it does not re-run. The row is reported as drifted when a
   * sort or filter is active, which is what a "rows changed" affordance offers
   * a re-query for — the same treatment {@link patch} gets when it moves a
   * sorted value.
   */
  readonly insertRow: (row: Record<string, DataGridCellValue>) => void;
  /**
   * Removes a row from the loaded set. A miss is a no-op.
   *
   * Unlike {@link insertRow} this needs no caveat: a row that is gone is gone
   * under every sort and filter, so removing it can only make the page more
   * true than leaving it.
   */
  readonly deleteRow: (rowId: DataGridRowId) => void;
  /**
   * Row ids currently loaded, read at call time rather than captured — paging
   * and re-queries change this constantly.
   */
  readonly loadedRowIds: () => DataGridRowId[];
};

export type LayerPresentationContext<TRow> = {
  /**
   * The holders exist because a column's `renderCell` runs long after the view
   * model is built and needs to reach the live grid and the current rows —
   * neither of which exists yet at construction time.
   */
  readonly gridHolder: { current: DataGridViewModel<TRow> | null };
  readonly rowsHolder: { current: TRow[] };
  readonly getRowId: (row: TRow) => DataGridRowId;
};

/**
 * An inline detail panel for an expanded row.
 *
 * Height and renderer travel together so a renderer can no longer be supplied
 * without one: the grid positions rows from the height, and a missing height
 * silently left every row unexpandable while the renderer looked fine.
 */
export type LayerRowDetail<TRow> = {
  readonly height: number;
  readonly render: (context: DataGridRowDetailContext<TRow>) => React.ReactNode;
};

export type LayerPresentation<TRow> = {
  /**
   * Real grid columns, laid out ahead of the source's own.
   *
   * Real, not chrome drawn on top of the row: the grid positions data cells
   * absolutely from `item.x`, so a column it did not lay out would be painted
   * over.
   */
  readonly columns?: readonly DataGridColumn<TRow>[];
  /**
   * Lets a layer push new cell values into rows already on screen, so it can
   * repaint the affected cells without the page query re-running and
   * reordering rows under the cursor.
   *
   * Returns an unsubscribe.
   */
  readonly subscribe?: (grid: LayerGrid) => () => void;
  readonly rowDetail?: LayerRowDetail<TRow>;
};

// ---------------------------------------------------------------- slot: enrich

/**
 * A column attached to an already-fetched page.
 *
 * `sortable` and `filterable` are removed rather than defaulted, so declaring
 * one is a compile error rather than a runtime surprise. See the note on
 * {@link GridSourceLayer} for why: the grid holds one page of a result it did
 * not run, so sorting on this could only reorder that page — which looks like
 * it worked.
 */
export type EnrichedColumn<TRow> = Omit<
  DataGridColumn<TRow>,
  'sortable' | 'filterable'
>;

export type LayerEnrichmentContext<TRow> = {
  readonly getRowId: (row: TRow) => DataGridRowId;
};

export type LayerEnrichment<TRow> = {
  /** Declared once, at construction, so the grid can lay them out. */
  readonly columns: readonly EnrichedColumn<TRow>[];
  /**
   * Given the page the source returned, return it with this layer's fields
   * attached.
   *
   * Called once per page with the whole page rather than once per row, so an
   * implementation can issue one batched lookup for every id it needs instead
   * of N round trips. Returning the input unchanged is a valid no-op.
   */
  readonly attach: (input: {
    readonly rows: readonly TRow[];
    readonly signal?: AbortSignal;
  }) => TRow[] | Promise<TRow[]>;
};
