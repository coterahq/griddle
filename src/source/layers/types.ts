import type React from 'react';
import type {
  DataGridColumn,
  DataGridColumnStats,
  DataGridRowDetailContext,
  DataGridRowId,
  DataGridViewModel,
} from '@cotera/client/app/components/ui/data-grid';
import type { DuckDbCellValue } from '../arrow';

/**
 * A layer is one thing laid over a parquet file loaded into DuckDB-wasm.
 *
 * There are two physically different ways to lay something over a parquet
 * table, and neither collapses into the other:
 *
 *  - **Mutate** the materialized table. Right for a bounded, replayable edit
 *    log: it can ALTER the schema and it can position an inserted row relative
 *    to a row an earlier statement inserted, neither of which a projection can
 *    express.
 *  - **Project** extra columns at read time from a side table. Right for data
 *    that changes constantly and independently of the parquet: a re-materialize
 *    would wipe it, so the join has to exist regardless.
 *
 * What they share is everything else — how they are composed, how their
 * columns reach the grid, how they push live updates into rows already on
 * screen — and that is what this type is. The three slots are optional and
 * independent: a layer fills in the ones it needs. The row-select checkbox
 * fills only `present`; the operation replay fills only `mutate`; the
 * automations overlay fills `project` and `present`.
 *
 * **No connection-scoped state.** `CoteraDuckDB.rawQuery` takes an arbitrary
 * connection from a pool, so a `CREATE TEMP TABLE`, a temp view, a prepared
 * statement handle or a `SET`/`PRAGMA` issued by a layer is invisible to the
 * next read. Anything a layer needs to persist belongs in a real table.
 */
export type DuckDbSourceLayer<TRow> = {
  /**
   * Stable and unique within a stack. Drives join-alias derivation, the
   * row-detail conflict warning, and the dev check that catches a layer being
   * rebuilt on every render.
   */
  readonly id: string;
  readonly mutate?: (context: DuckDbMutationContext) => DuckDbMutation;
  readonly project?: (context: DuckDbProjectionContext) => DuckDbProjection;
  readonly present?: (
    context: DuckDbPresentationContext<TRow>
  ) => DuckDbPresentation<TRow>;
};

/** A column of a materialized table or a projected source. */
export type DuckDbColumn = { name: string; type: string | null };

// ---------------------------------------------------------------- slot 1: mutate

export type DuckDbMutationContext = {
  /** Raw (unquoted) name of the table being built. */
  readonly tableName: string;
  /** The schema this layer inherits from the layers before it. */
  readonly columns: readonly DuckDbColumn[];
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
export type DuckDbMutation = {
  /** Executed in order, immediately after the table is created. */
  readonly statements: readonly string[];
  /** The schema the table has once they have run. */
  readonly columns: readonly DuckDbColumn[];
};

// -------------------------------------------------------------- slot 2: project

export type DuckDbProjectionContext = {
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

export type DuckDbProjectedColumn = {
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

export type DuckDbProjection = {
  /** `expr AS "alias"` fragments appended to `SELECT <baseAlias>.*`. */
  readonly selectExpressions: readonly string[];
  /** JOIN clauses placed after `FROM <source> AS <baseAlias>`. */
  readonly joins: readonly string[];
  /** Declared so sorts, filters and header stats can address them. */
  readonly columns: readonly DuckDbProjectedColumn[];
};

// -------------------------------------------------------------- slot 3: present

/** The grid's side of a layer's live channel. */
export type DuckDbLayerGrid = {
  /** Applies new values to one loaded row. A miss is a no-op. */
  readonly patch: (
    rowId: DataGridRowId,
    values: Record<string, DuckDbCellValue>
  ) => void;
  /**
   * Adds a row to the loaded set, at the end of it.
   *
   * At the end because that is the only position this can honestly claim: where
   * a row belongs is decided by the active sort, and the grid holds one page of
   * a result it does not re-run. The row is reported as drifted when a sort or
   * filter is active, which is what the "rows changed" chip offers a re-query
   * for — the same treatment {@link patch} gets when it moves a sorted value.
   */
  readonly insertRow: (row: Record<string, DuckDbCellValue>) => void;
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

export type DuckDbPresentationContext<TRow> = {
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
export type DuckDbRowDetail<TRow> = {
  readonly height: number;
  readonly render: (context: DataGridRowDetailContext<TRow>) => React.ReactNode;
};

export type DuckDbPresentation<TRow> = {
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
  readonly subscribe?: (grid: DuckDbLayerGrid) => () => void;
  readonly rowDetail?: DuckDbRowDetail<TRow>;
};
