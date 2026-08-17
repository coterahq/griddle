import { joinsIn } from '../source/layers/join';
import type { ResolvedJoin } from '../source/layers/join';
import type { GridSourceLayer } from '../source/layers/types';
import type { SqlProjectedColumn, SqlSourceLayer } from '../source/layers/sql';
import { inlineRowsRelation } from './ingest';
import { duckDbIdentifier } from './sql';

/*
 * `joinLayer` and `selectionLayer` live in core and are re-exported here,
 * because this is where somebody looks for them. Neither knows anything about
 * SQL: a join is a declaration, and compiling it is this file's job.
 */
export { joinLayer, selectionLayer } from '../source/layers/join';
export type {
  JoinColumn,
  JoinRelation,
  JoinSourceLayer,
  JoinSpec,
  SelectionLayerOptions,
} from '../source/layers/join';

/** The right-hand side of a join as an expression valid after `JOIN`. */
const relationSql = (join: ResolvedJoin): string =>
  join.relation.kind === 'sql'
    ? join.relation.expression
    : // Inline, so a `{ kind: 'rows' }` join needs no `CREATE VIEW` and no
      // `await` — the same layer object works on this adapter and on
      // `/memory`, which is the entire point of the relation being declarative.
      inlineRowsRelation(
        typeof join.relation.rows === 'function'
          ? join.relation.rows()
          : join.relation.rows
      );

/**
 * A declared join, compiled into a `project` layer.
 *
 * The projection becomes part of the page query, so the grid's own `WHERE` and
 * `ORDER BY` reach the joined columns exactly like native ones. That is what
 * makes sorting by a joined column return the right rows out of the whole
 * result instead of the right rows out of the loaded page.
 */
export const compileJoinToSqlLayer = <TRow>(
  join: ResolvedJoin
): SqlSourceLayer<TRow> => ({
  id: join.id,
  project: ({ baseAlias, alias }) => {
    // Minted from the layer's position in the stack, so two joins against the
    // same table do not collide.
    const joined = alias(`join_${join.id}`);
    const projected: SqlProjectedColumn[] = join.columns.map((column) => ({
      name: column.as,
      type: column.sqlType,
    }));

    return {
      selectExpressions: join.columns.map(
        (column) =>
          `${joined}.${duckDbIdentifier(column.name)} AS ${duckDbIdentifier(
            column.as
          )}`
      ),
      // The base side is qualified with `baseAlias`: an unqualified name would
      // be ambiguous the moment the joined relation has one of its own.
      joins: [
        `${join.kind} JOIN ${relationSql(join)} AS ${joined} ` +
          `ON ${joined}.${duckDbIdentifier(join.key.right)} = ` +
          `${baseAlias}.${duckDbIdentifier(join.key.left)}`,
      ],
      columns: projected,
    };
  },
});

/**
 * Normalises a mixed layer stack into one the SQL stack understands.
 *
 * Declared joins are compiled; hand-written `project` / `mutate` layers pass
 * through untouched; `present` and `enrich` layers are engine-agnostic and
 * also pass through.
 */
export const toSqlLayers = <TRow>(
  layers: readonly GridSourceLayer<TRow>[]
): SqlSourceLayer<TRow>[] => {
  const compiled = new Map(
    joinsIn(layers).map((join) => [join.id, compileJoinToSqlLayer<TRow>(join)])
  );
  return layers.map(
    (layer) => compiled.get(layer.id) ?? (layer as SqlSourceLayer<TRow>)
  );
};
