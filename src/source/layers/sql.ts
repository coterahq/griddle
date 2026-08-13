import type { DataGridColumnStats } from '../../core/types';
import { LayerStack } from './stack';
import type { GridSourceLayer } from './types';

/**
 * The two layer slots that only a SQL engine can serve.
 *
 * They are separated from {@link GridSourceLayer} because `present` and
 * `enrich` work against any adapter and these do not — they change the query
 * the engine runs rather than the rows that came back. An HTTP source has no
 * `FROM` clause to wrap and no table to `ALTER`.
 *
 * Nothing here imports DuckDB. This is SQL string composition, so the same
 * stack drives any engine that speaks it; `/duckdb` re-exports these for
 * discoverability rather than owning them.
 */
export type SqlSourceLayer<TRow> = GridSourceLayer<TRow> & {
  /**
   * **Mutate** the materialized table. Right for a bounded, replayable edit
   * log: it can ALTER the schema and it can position an inserted row relative
   * to a row an earlier statement inserted, neither of which a projection can
   * express.
   */
  readonly mutate?: (context: SqlMutationContext) => SqlMutation;
  /**
   * **Project** extra columns at read time from a side table. Right for data
   * that changes constantly and independently of the base: a re-materialize
   * would wipe it, so the join has to exist regardless.
   *
   * Unlike `enrich`, a projected column *is* part of the query, so the grid's
   * own `WHERE` and `ORDER BY` address it exactly like a native one.
   */
  readonly project?: (context: SqlProjectionContext) => SqlProjection;
};

/** A column of a materialized table or a projected source. */
export type SqlColumn = { name: string; type: string | null };

// ---------------------------------------------------------------- slot: mutate

export type SqlMutationContext = {
  /** Raw (unquoted) name of the table being built. */
  readonly tableName: string;
  /** The schema this layer inherits from the layers before it. */
  readonly columns: readonly SqlColumn[];
  /** Resolved from {@link columns}; null when the source has no durable id. */
  readonly rowIdColumn: string | null;
};

/**
 * Statements and the resulting schema, from one call.
 *
 * Deliberately one return rather than two methods: a layer that taught the
 * replay about a new operation and forgot to teach the schema projection about
 * it was the single most expensive bug shape in this code.
 */
export type SqlMutation = {
  /** Executed in order, immediately after the table is created. */
  readonly statements: readonly string[];
  /** The schema the table has once they have run. */
  readonly columns: readonly SqlColumn[];
};

// --------------------------------------------------------------- slot: project

export type SqlProjectionContext = {
  /**
   * Alias of the source this layer wraps. Qualify base columns with it — a
   * join's ON clause must reference `<baseAlias>."col"`, never a bare name.
   */
  readonly baseAlias: string;
  /**
   * Mints an alias unique across the whole stack, so two instances of the same
   * layer kind can be stacked without colliding.
   */
  readonly alias: (suffix: string) => string;
  readonly rowIdColumn: string | null;
};

export type SqlProjectedColumn = {
  readonly name: string;
  /** SQL type name; drives grid type inference and typed filter translation. */
  readonly type: string | null;
  /**
   * Replaces the type-derived header stats, which are right for a real column
   * and wrong for a synthesised one. Receives the fully resolved source — every
   * layer wrapped, the active WHERE applied — so a stat built from it describes
   * exactly the rows on screen.
   */
  readonly loadStats?: (params: {
    sourceSql: string;
  }) => Promise<DataGridColumnStats>;
};

export type SqlProjection = {
  /** `expr AS "alias"` fragments appended to `SELECT <baseAlias>.*`. */
  readonly selectExpressions: readonly string[];
  /** JOIN clauses placed after `FROM <source> AS <baseAlias>`. */
  readonly joins: readonly string[];
  /** Declared so sorts, filters and header stats can address them. */
  readonly columns: readonly SqlProjectedColumn[];
};

/**
 * A {@link LayerStack} that also composes SQL.
 *
 * **No connection-scoped state.** A query function is free to take an
 * arbitrary connection from a pool, so a `CREATE TEMP TABLE`, a temp view, a
 * prepared statement handle or a `SET`/`PRAGMA` issued by a layer is invisible
 * to the next read. Anything a layer needs to persist belongs in a real table.
 */
export class SqlLayerStack<TRow> extends LayerStack<TRow> {
  /** Every projected column, in stack order. Sorts, filters and stats read this. */
  readonly projectedColumns: readonly SqlProjectedColumn[];

  private readonly rowIdColumn: string | null;
  private readonly projections: readonly {
    baseAlias: string;
    projection: SqlProjection;
  }[];

  constructor(
    private readonly sqlLayers: readonly SqlSourceLayer<TRow>[],
    options: {
      rowIdColumn?: string | null;
      getRowId?: (row: TRow) => string | number;
    } = {}
  ) {
    super(sqlLayers, options);
    this.rowIdColumn = options.rowIdColumn ?? null;
    // Resolved once, in the constructor, rather than per call: `wrapSource`
    // and `projectedColumns` must not see two different projections of the
    // same layer, and a layer's `project` is free to be non-trivial. Being
    // constructor work rather than a memo makes calling it twice impossible.
    this.projections = this.sqlLayers.flatMap((layer, index) => {
      if (layer.project === undefined) {
        return [];
      }
      // Indexed by position in the stack, so two instances of the same layer
      // kind get different aliases instead of colliding.
      const baseAlias = `cotera_src_${String(index)}`;
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
   * Takes an executor rather than a database so it can run inside whatever
   * write lock the caller holds, alongside the statement that created the
   * table — the create and the replay have to be one unit, or a second run's
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
    baseColumns: readonly SqlColumn[];
    resolveRowIdColumn?: (columns: readonly SqlColumn[]) => string | null;
  }): Promise<SqlColumn[]> {
    let columns: readonly SqlColumn[] = baseColumns;
    for (const layer of this.sqlLayers) {
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
   * An arrow property because it is handed to the page-SQL builder as a value;
   * a plain method would arrive without its `this`.
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
}
