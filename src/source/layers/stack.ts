import { isDevelopment } from '../../internal/dev';
import type { DataGridColumn } from '../../core/types';
import type {
  EnrichedColumn,
  GridSourceLayer,
  LayerEnrichment,
  LayerGrid,
  LayerPresentation,
  LayerPresentationContext,
  LayerRowDetail,
} from './types';

export type ComposedPresentation<TRow> = {
  /** Leading columns, outermost layer first. */
  readonly columns: readonly DataGridColumn<TRow>[];
  /** Fans out to every layer that asked; one combined unsubscribe. */
  readonly subscribe: (grid: LayerGrid) => () => void;
  /** The winner of the first-wins rule, or null when no layer declared one. */
  readonly rowDetail: (LayerRowDetail<TRow> & { ownerId: string }) | null;
};

/**
 * A stack of layers, folded into what the grid needs from them.
 *
 * **The array is base-first.** `[operations, automations, selection]` is the
 * order enrichment runs in, the order mutations replay in, and the order
 * source wrapping nests in. Grid columns are the one exception — see
 * {@link present}.
 *
 * Engine-agnostic: this handles `present` and `enrich`, which are pure React
 * and grid concepts. `SqlLayerStack` in `./sql` extends it with the two slots
 * that require a query engine.
 */
export class LayerStack<TRow> {
  /**
   * Columns attached by enriching layers, in stack order.
   *
   * Forced to `sortable: false, filterable: false` here rather than trusted to
   * the layer. The type already removes both keys, so this is the runtime half
   * of the same rule — the grid holds one page of a result it did not run, and
   * ordering it by a field that was stapled on afterwards would reorder only
   * that page while looking like it worked.
   */
  readonly enrichedColumns: readonly DataGridColumn<TRow>[];

  protected readonly layers: readonly GridSourceLayer<TRow>[];

  private readonly enrichments: readonly {
    id: string;
    enrichment: LayerEnrichment<TRow>;
  }[];

  constructor(
    layers: readonly GridSourceLayer<TRow>[],
    options: { getRowId?: (row: TRow) => string | number } = {}
  ) {
    this.layers = layers;

    const getRowId =
      options.getRowId ??
      ((): never => {
        throw new Error(
          'LayerStack: an enriching layer needs `getRowId`, so it can match ' +
            'the page it is given against whatever it looks values up by.'
        );
      });

    // Resolved once, in the constructor, for the same reason the SQL stack
    // resolves projections there: `enrichedColumns` and `enrich` must not see
    // two different results from the same layer.
    this.enrichments = layers.flatMap((layer) => {
      if (layer.enrich === undefined) {
        return [];
      }
      return [{ id: layer.id, enrichment: layer.enrich({ getRowId }) }];
    });

    this.enrichedColumns = this.enrichments.flatMap(({ enrichment }) =>
      enrichment.columns.map((column: EnrichedColumn<TRow>) => ({
        ...column,
        sortable: false,
        filterable: false,
      }))
    );
  }

  /**
   * Runs every enriching layer over one page, in stack order.
   *
   * Sequential rather than parallel: a later layer is allowed to read fields an
   * earlier one attached, which is the same nesting property `wrapSource` gives
   * projections. A layer that needs no predecessor simply ignores them, and
   * pays one extra `await`.
   */
  async enrich(rows: readonly TRow[], signal?: AbortSignal): Promise<TRow[]> {
    let current: readonly TRow[] = rows;
    for (const { enrichment } of this.enrichments) {
      signal?.throwIfAborted();
      current = await enrichment.attach({ rows: current, signal });
    }
    return [...current];
  }

  present(context: LayerPresentationContext<TRow>): ComposedPresentation<TRow> {
    const presentations = this.layers.flatMap((layer) => {
      if (layer.present === undefined) {
        return [];
      }
      return [
        {
          id: layer.id,
          presentation: layer.present(
            context
          ) satisfies LayerPresentation<TRow>,
        },
      ];
    });

    /**
     * The grid can render exactly one row detail, so the first layer in
     * stack order that declares one owns it.
     *
     * First-wins rather than last-wins because presentation-only layers are
     * appended by *callers* — a picker tacks a selection layer on the end —
     * and a caller must not be able to steal the row detail from the model
     * that owns the data.
     */
    let rowDetail: (LayerRowDetail<TRow> & { ownerId: string }) | null = null;
    for (const { id, presentation } of presentations) {
      if (presentation.rowDetail === undefined) {
        continue;
      }
      if (rowDetail === null) {
        rowDetail = { ...presentation.rowDetail, ownerId: id };
        continue;
      }
      if (isDevelopment()) {
        console.warn(
          `Layer "${id}" declares a row detail, but "${rowDetail.ownerId}" ` +
            'already owns it and comes first in the stack. Only one can ' +
            'render, so this one is ignored.'
        );
      }
    }

    return {
      // Reversed: the array is base-first, but the outermost layer's column
      // belongs leftmost. With `[operations, automations, selection]` that
      // gives `[select, workflows, …dataset columns]`. This is the one place
      // stack order and visual order disagree.
      columns: [...presentations]
        .reverse()
        .flatMap(({ presentation }) => presentation.columns ?? []),
      subscribe: (grid) => {
        const unsubscribes = presentations.flatMap(({ presentation }) =>
          presentation.subscribe === undefined
            ? []
            : [presentation.subscribe(grid)]
        );
        return () => {
          for (const unsubscribe of unsubscribes) {
            unsubscribe();
          }
        };
      },
      rowDetail,
    };
  }
}
