import type { SqlProjectedColumn, SqlSourceLayer } from '../source/layers/sql';
import { duckDbIdentifier } from './sql';

export type JoinLayerOptions = {
  /** Stable and unique within the stack; drives alias minting. */
  id: string;
  /** Table name, `read_parquet('…')`, or any expression valid after `JOIN`. */
  from: string;
  /**
   * The join key.
   *
   * A string means the same column name on both sides. `{ left, right }` when
   * they differ — `left` is the base source's column, `right` is the joined
   * one's.
   */
  on: string | { left: string; right: string };
  /**
   * Columns to bring across.
   *
   * A string takes the column under its own name; `{ name, as }` renames it,
   * which is how two joins that both have a `name` column coexist.
   */
  columns: readonly (
    string | { name: string; as?: string; sqlType?: string }
  )[];
  /** `LEFT` keeps unmatched base rows, which is almost always what you want. */
  kind?: 'LEFT' | 'INNER';
};

const normaliseColumn = (
  column: JoinLayerOptions['columns'][number]
): { name: string; as: string; sqlType: string | null } =>
  typeof column === 'string'
    ? { name: column, as: column, sqlType: null }
    : {
        name: column.name,
        as: column.as ?? column.name,
        sqlType: column.sqlType ?? null,
      };

/**
 * Joins another source into the grid.
 *
 * This is the headline feature, and it is a thin convenience over `project`
 * for a reason: a hand-written projection can do everything this does and
 * more, but nobody should have to write a JOIN fragment and mint aliases to
 * put a user's name next to their order.
 *
 * ```ts
 * createDuckDbDataSource({
 *   query,
 *   from: orders,
 *   columns: ORDER_COLUMNS,
 *   layers: [
 *     joinLayer({ id: 'user', from: users, on: 'user_id', columns: ['name', 'email'] }),
 *     joinLayer({ id: 'flags', from: flags, on: 'order_id', columns: ['is_flagged'] }),
 *   ],
 * });
 * ```
 *
 * Sorting by `name` or filtering on `is_flagged` then issues **one** DuckDB
 * query across all three sources and returns the right rows — not the right
 * rows out of the page that happened to be loaded. That is the difference
 * between this and `enrich`, and it is why joined columns are ordinary,
 * sortable, filterable grid columns while enriched ones are not.
 *
 * The parquet can be on S3, the users a JSON API's response inserted as a
 * table, the flags an in-memory array. DuckDB does not care which, and neither
 * does the grid.
 */
export function joinLayer<TRow>({
  id,
  from,
  on,
  columns,
  kind = 'LEFT',
}: JoinLayerOptions): SqlSourceLayer<TRow> {
  const key = typeof on === 'string' ? { left: on, right: on } : on;
  const resolved = columns.map(normaliseColumn);

  return {
    id,
    project: ({ baseAlias, alias }) => {
      // `alias` is minted from the layer's position in the stack, so two joins
      // against the same table do not collide.
      const joined = alias(`join_${id}`);
      const projected: SqlProjectedColumn[] = resolved.map((column) => ({
        name: column.as,
        type: column.sqlType,
      }));

      return {
        selectExpressions: resolved.map(
          (column) =>
            `${joined}.${duckDbIdentifier(column.name)} AS ${duckDbIdentifier(
              column.as
            )}`
        ),
        // The base side must be qualified with `baseAlias`: an unqualified
        // name would be ambiguous the moment the joined table has one too.
        joins: [
          `${kind} JOIN ${from} AS ${joined} ON ${joined}.${duckDbIdentifier(
            key.right
          )} = ${baseAlias}.${duckDbIdentifier(key.left)}`,
        ],
        columns: projected,
      };
    },
  };
}

export type SelectionLayerOptions<TRow> = {
  id?: string;
  /** Rendered in the leading column. Given the row and its id. */
  render: (input: { row: TRow; rowId: string | number }) => React.ReactNode;
  width?: number;
};

/**
 * A `present`-only layer contributing one leading column.
 *
 * Exists mostly as the worked example of the slot: it touches no SQL, so it
 * composes with an HTTP or in-memory source exactly as it does with DuckDB.
 * The rendering is the caller's — a checkbox, a drag handle, a row menu — so
 * this stays a layout concern rather than becoming a selection framework.
 */
export function selectionLayer<TRow>({
  id = 'selection',
  render,
  width = 44,
}: SelectionLayerOptions<TRow>): SqlSourceLayer<TRow> {
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
