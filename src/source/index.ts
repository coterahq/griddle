export type { GridQuery, GridPage, GridDataSource } from './types';
export { createGridController } from './controller';
export type {
  GridController,
  GridControllerStatus,
  CreateGridControllerOptions,
} from './controller';

export { withLayers } from './with-layers';
export type { WithLayersOptions, LayeredSource } from './with-layers';

// Layers: the differentiating feature. `present` and `enrich` work against
// every adapter; `project` and `mutate` need a SQL engine and live on
// `SqlLayerStack`, which `/duckdb` re-exports.
export { LayerStack, SqlLayerStack } from './layers';
export type {
  ComposedPresentation,
  EnrichedColumn,
  GridSourceLayer,
  LayerEnrichment,
  LayerEnrichmentContext,
  LayerGrid,
  LayerPresentation,
  LayerPresentationContext,
  LayerRowDetail,
  SqlColumn,
  SqlMutation,
  SqlMutationContext,
  SqlProjectedColumn,
  SqlProjection,
  SqlProjectionContext,
  SqlSourceLayer,
} from './layers';
