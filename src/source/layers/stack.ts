import type {
  DuckDbColumn,
  DuckDbLayerGrid,
  DuckDbPresentationContext,
  DuckDbProjectedColumn,
  DuckDbProjection,
  DuckDbRowDetail,
  DuckDbSourceLayer,
} from './types';
import type { DataGridColumn } from '@cotera/client/app/components/ui/data-grid';

export type ComposedDuckDbPresentation<TRow> = {
  /** Leading columns, outermost layer first. */
  readonly columns: readonly DataGridColumn<TRow>[];
  /** Fans out to every layer that asked; one combined unsubscribe. */
  readonly subscribe: (grid: DuckDbLayerGrid) => () => void;
  /** The winner of the first-wins rule, or null when no layer declared one. */
  readonly rowDetail: (DuckDbRowDetail<TRow> & { ownerId: string }) | null;
};

/**
 * A stack of layers, folded into the four things the grid needs from them.
 *
 * **The array is base-first.** `[operations, automations, selection]` is the
 * order mutations replay in and the order source wrapping nests in. Grid
 * columns are the one exception — see `present`.
 */
export class DuckDbLayerStack<TRow> {
  /** Every projected column, in stack order. Sorts, filters and stats read this. */
  readonly projectedColumns: readonly DuckDbProjectedColumn[];

  private readonly rowIdColumn: string | null;
  private readonly projections: readonly {
    baseAlias: string;
    projection: DuckDbProjection;
  }[];

  constructor(
    private readonly layers: readonly DuckDbSourceLayer<TRow>[],
    options: { rowIdColumn?: string | null } = {}
  ) {
    this.rowIdColumn = options.rowIdColumn ?? null;
    // Resolved once, in the constructor, rather than per call: `wrapSource`
    // and `projectedColumns` must not see two different projections of the
    // same layer, and a layer's `project` is free to be non-trivial. Being
    // constructor work rather than a memo makes calling it twice impossible.
    this.projections = this.layers.flatMap((layer, index) => {
      if (layer.project === undefined) {
        return [];
      }
      // Indexed by position in the stack, so two instances of the same layer
      // kind get different aliases instead of colliding.
      const baseAlias = `cotera_src_${index}`;
      const projection = layer.project({
        baseAlias,
        alias: (suffix) => `${baseAlias}_${suffix}`,
        rowIdColumn: this.rowIdColumn,
      });
      return [{ baseAlias, projection }];
    });
    this.projectedColumns = this.projections.flatMap(
      ({ projection }) => projection.columns
    );
  }

  /**
   * Runs every mutating layer in stack order against an already-created table.
   * Returns the schema the table ends up with.
   *
   * Takes an executor rather than a database so it can run inside a
   * `DuckDbTable.write` lock, alongside the statement that created the table —
   * the create and the replay have to be one unit, or a second run's
   * `CREATE OR REPLACE` lands in the middle of this one's statements.
   */
  async materialize({
    exec,
    tableName,
    baseColumns,
    resolveRowIdColumn,
  }: {
    exec: (sql: string) => Promise<void>;
    tableName: string;
    baseColumns: readonly DuckDbColumn[];
    resolveRowIdColumn?: (columns: readonly DuckDbColumn[]) => string | null;
  }): Promise<DuckDbColumn[]> {
    let columns: readonly DuckDbColumn[] = baseColumns;
    for (const layer of this.layers) {
      if (layer.mutate === undefined) {
        continue;
      }
      const mutation = layer.mutate({
        tableName,
        columns,
        // Re-resolved per layer when the caller says how: a layer that
        // renames or drops the id column changes what the next one
        // addresses rows by.
        rowIdColumn:
          resolveRowIdColumn === undefined
            ? this.rowIdColumn
            : resolveRowIdColumn(columns),
      });
      for (const statement of mutation.statements) {
        await exec(statement);
      }
      columns = mutation.columns;
    }
    return [...columns];
  }

  /**
   * Wraps a base source expression once per projecting layer, nesting rather
   * than emitting one flat wrap with N joins.
   *
   * Nesting is what lets layer *i+1* reference a column layer *i* produced —
   * a JOIN clause cannot see a SELECT alias, but it can see a subquery's
   * column — and it means each layer only ever reasons about one alias.
   * DuckDB flattens the nesting, so it costs nothing at runtime.
   *
   * An arrow property because it is handed to `datasetPreviewSourceSql` as a
   * value; a plain method would arrive without its `this`.
   */
  readonly wrapSource = (baseSql: string): string =>
    this.projections.reduce((sql, { baseAlias, projection }) => {
      if (projection.selectExpressions.length === 0) {
        return sql;
      }
      const joins =
        projection.joins.length === 0 ? '' : ` ${projection.joins.join(' ')}`;
      return `(SELECT ${baseAlias}.*, ${projection.selectExpressions.join(
        ', '
      )} FROM ${sql} AS ${baseAlias}${joins})`;
    }, baseSql);

  present(
    context: DuckDbPresentationContext<TRow>
  ): ComposedDuckDbPresentation<TRow> {
    const layers = this.layers;
    const presentations = layers.flatMap((layer) => {
      if (layer.present === undefined) {
        return [];
      }
      return [{ id: layer.id, presentation: layer.present(context) }];
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
    let rowDetail: (DuckDbRowDetail<TRow> & { ownerId: string }) | null = null;
    for (const { id, presentation } of presentations) {
      if (presentation.rowDetail === undefined) {
        continue;
      }
      if (rowDetail === null) {
        rowDetail = { ...presentation.rowDetail, ownerId: id };
        continue;
      }
      if (process.env['NODE_ENV'] !== 'production') {
        // eslint-disable-next-line no-console
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
