import type React from 'react';
import { dataGridColumnTypeFromSqlType } from '../../core/column-type';
import type {
  DataGridColumn,
  DataGridColumnDataType,
  DataGridRowId,
} from '../../core/types';
import type { GridSourceLayer } from './types';

/**
 * Where the right-hand side of a join comes from.
 *
 * `rows` works against every adapter that can see its whole population. `sql`
 * only means something to an engine, and an adapter that cannot read it says
 * so at construction instead of quietly doing something else.
 */
export type JoinRelation =
  | {
      readonly kind: 'rows';
      readonly rows:
        | readonly Record<string, unknown>[]
        | (() => readonly Record<string, unknown>[]);
    }
  | { readonly kind: 'sql'; readonly expression: string };

export type JoinColumn =
  | string
  | {
      readonly name: string;
      /** Rename on the way in, so two joins can both bring a `name` across. */
      readonly as?: string;
      readonly sqlType?: string;
      readonly type?: DataGridColumnDataType;
    };

export type JoinSpec = {
  /** Stable and unique within a stack; drives alias minting. */
  readonly id: string;
  /** A relation, or a bare string as shorthand for `{ kind: 'sql' }`. */
  readonly from: JoinRelation | string;
  /** Same column name on both sides, or `{ left, right }` when they differ. */
  readonly on: string | { readonly left: string; readonly right: string };
  readonly columns: readonly JoinColumn[];
  /** `LEFT` keeps unmatched base rows, which is almost always what you want. */
  readonly kind?: 'LEFT' | 'INNER';
};

export type ResolvedJoinColumn = {
  readonly name: string;
  readonly as: string;
  readonly sqlType: string | null;
  readonly type: DataGridColumnDataType | undefined;
};

export type ResolvedJoin = {
  readonly id: string;
  readonly relation: JoinRelation;
  readonly key: { readonly left: string; readonly right: string };
  readonly columns: readonly ResolvedJoinColumn[];
  readonly kind: 'LEFT' | 'INNER';
};

/** A layer carrying a join an adapter is expected to compile. */
export type JoinSourceLayer<TRow> = GridSourceLayer<TRow> & {
  readonly join: ResolvedJoin;
};

const resolveColumn = (column: JoinColumn): ResolvedJoinColumn =>
  typeof column === 'string'
    ? { name: column, as: column, sqlType: null, type: undefined }
    : {
        name: column.name,
        as: column.as ?? column.name,
        sqlType: column.sqlType ?? null,
        type: column.type,
      };

/**
 * Joins another source into the grid.
 *
 * The headline feature, and it says nothing about SQL. A join is a
 * *declaration* — this relation, that key, these columns — and each adapter
 * compiles it however it can:
 *
 *   `/memory`   builds a lookup and attaches the fields to the whole array
 *               before it filters, sorts or pages
 *   `/duckdb`   compiles a `JOIN` into the page query
 *
 * Both produce columns the grid can sort and filter like any other, because
 * both apply the join *before* the page is chosen. That is the only property
 * that matters, and it has nothing to do with having an engine — it needs the
 * adapter to be able to see the whole population, which an array and a
 * database both can and one page of an HTTP response cannot.
 *
 * ```ts
 * joinLayer({
 *   id: 'user',
 *   from: { kind: 'rows', rows: users },
 *   on: 'user_id',
 *   columns: ['name', 'email'],
 * })
 * ```
 *
 * That layer works unchanged on either adapter. `{ kind: 'sql' }` (or a bare
 * string, which is shorthand for it) is the escape hatch for data already
 * living in the warehouse, and only DuckDB can honour it.
 *
 * For a source that genuinely cannot join — an HTTP endpoint the server owns —
 * use an `enrich` layer instead, and accept that its columns cannot be sorted
 * or filtered. That restriction is the honest consequence of decorating a page
 * somebody else already chose.
 */
export function joinLayer<TRow>({
  id,
  from,
  on,
  columns,
  kind = 'LEFT',
}: JoinSpec): JoinSourceLayer<TRow> {
  return {
    id,
    join: {
      id,
      relation:
        typeof from === 'string' ? { kind: 'sql', expression: from } : from,
      key: typeof on === 'string' ? { left: on, right: on } : on,
      columns: columns.map(resolveColumn),
      kind,
    },
  };
}

const isJoinLayer = <TRow>(
  layer: GridSourceLayer<TRow>
): layer is JoinSourceLayer<TRow> =>
  'join' in layer && (layer as { join?: unknown }).join !== undefined;

export const joinsIn = <TRow>(
  layers: readonly GridSourceLayer<TRow>[]
): ResolvedJoin[] => layers.filter(isJoinLayer).map((layer) => layer.join);

/**
 * Grid columns for everything the joins bring across.
 *
 * Ordinary columns: sortable and filterable, unlike the ones an `enrich` layer
 * attaches, because the adapter applied the join before choosing a page.
 */
export const joinedGridColumns = <TRow>(
  layers: readonly GridSourceLayer<TRow>[]
): DataGridColumn<TRow>[] =>
  joinsIn(layers).flatMap((join) =>
    join.columns.map((column) => ({
      id: column.as,
      header: column.as,
      type: column.type ?? dataGridColumnTypeFromSqlType(column.sqlType),
      getValue: (row: TRow) =>
        (row as Record<string, unknown>)[column.as] ?? null,
    }))
  );

/**
 * The join, done in JavaScript.
 *
 * Used by `/memory`, and exported because it is also the answer for anyone
 * holding two arrays who would rather not think about adapters at all.
 *
 * One pass to index the right-hand side, one pass over the left. Keys are
 * compared as text, matching how the rest of the library compares a filter
 * value to a cell: `1` and `'1'` are the same key, which is what a JSON
 * payload and a database row disagreeing about a numeric id needs.
 */
export const applyJoin = <TRow>(
  rows: readonly TRow[],
  join: ResolvedJoin
): TRow[] => {
  if (join.relation.kind !== 'rows') {
    throw new Error(
      `joinLayer("${join.id}"): this source can only join \`{ kind: 'rows' }\` ` +
        'relations. A `sql` relation needs an engine — use the DuckDB adapter, ' +
        'or load the rows and pass them directly.'
    );
  }

  const right =
    typeof join.relation.rows === 'function'
      ? join.relation.rows()
      : join.relation.rows;

  const index = new Map<string, Record<string, unknown>>();
  for (const entry of right) {
    const key = entry[join.key.right];
    if (key !== null && key !== undefined) {
      // First match wins, which mirrors a join against a unique key. A
      // right-hand side with duplicates is a fan-out this cannot express and
      // the caller almost certainly did not intend.
      const asText = String(key);
      if (!index.has(asText)) {
        index.set(asText, entry);
      }
    }
  }

  const joined: TRow[] = [];
  for (const row of rows) {
    const key = (row as Record<string, unknown>)[join.key.left];
    const match =
      key === null || key === undefined ? undefined : index.get(String(key));

    if (match === undefined && join.kind === 'INNER') {
      continue;
    }

    const attached: Record<string, unknown> = { ...(row as object) };
    for (const column of join.columns) {
      attached[column.as] = match?.[column.name] ?? null;
    }
    joined.push(attached as TRow);
  }
  return joined;
};

export const applyJoins = <TRow>(
  rows: readonly TRow[],
  joins: readonly ResolvedJoin[]
): TRow[] =>
  joins.reduce<TRow[]>((current, join) => applyJoin(current, join), [...rows]);

export type SelectionLayerOptions<TRow> = {
  id?: string;
  /** Rendered in the leading column. Given the row and its id. */
  render: (input: { row: TRow; rowId: DataGridRowId }) => React.ReactNode;
  width?: number;
};

/**
 * A `present`-only layer contributing one leading column.
 *
 * The worked example of the slot: it touches no data at all, so it composes
 * with every adapter identically. The rendering is the caller's — a checkbox,
 * a drag handle, a row menu — so this stays a layout concern instead of
 * becoming a selection framework.
 */
export function selectionLayer<TRow>({
  id = 'selection',
  render,
  width = 44,
}: SelectionLayerOptions<TRow>): GridSourceLayer<TRow> {
  return {
    id,
    present: ({ getRowId }) => ({
      columns: [
        {
          id,
          header: '',
          width,
          pinned: 'left',
          sortable: false,
          filterable: false,
          getValue: () => null,
          renderCell: ({ row }) => render({ row, rowId: getRowId(row) }),
        },
      ],
    }),
  };
}
