export { LayerStack } from './stack';

// Joins. Declarative on purpose: a join is a relation, a key and some
// columns, and each adapter compiles that however it can. Nothing here knows
// about SQL.
export {
  applyJoin,
  applyJoins,
  joinLayer,
  joinedGridColumns,
  joinsIn,
  selectionLayer,
} from './join';
export type {
  JoinColumn,
  JoinRelation,
  JoinSourceLayer,
  JoinSpec,
  ResolvedJoin,
  ResolvedJoinColumn,
  SelectionLayerOptions,
} from './join';
export type { ComposedPresentation } from './stack';
export type {
  EnrichedColumn,
  GridSourceLayer,
  LayerEnrichment,
  LayerEnrichmentContext,
  LayerGrid,
  LayerPresentation,
  LayerPresentationContext,
  LayerRowDetail,
} from './types';

// SQL-only, and separated for a reason: `project` and `mutate` change the
// query the engine runs, so they are meaningless against an HTTP endpoint or
// an array. Nothing here imports DuckDB — it is SQL string composition — so
// `/duckdb` re-exports rather than owns it.
export { SqlLayerStack } from './sql';
export type {
  SqlColumn,
  SqlMutation,
  SqlMutationContext,
  SqlProjectedColumn,
  SqlProjection,
  SqlProjectionContext,
  SqlSourceLayer,
} from './sql';
