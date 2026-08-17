export { createDuckDbDataSource } from './source';
export type { CreateDuckDbDataSourceOptions, DuckDbDataSource } from './source';

export { createDuckDbWasmQuery } from './wasm';
export type { CreateDuckDbWasmQueryOptions } from './wasm';

export type { DuckDbQuery, DuckDbQueryResult } from './types';

/*
 * The flagship. Defined in core, re-exported here: a join is a declaration
 * that says nothing about SQL, and `/memory` compiles the same layer object
 * with a `Map`. This adapter's contribution is `compileJoinToSqlLayer`.
 */
export { joinLayer, selectionLayer, compileJoinToSqlLayer } from './join-layer';
export type {
  JoinColumn,
  JoinRelation,
  JoinSourceLayer,
  JoinSpec,
  SelectionLayerOptions,
} from './join-layer';
export { inlineRowsRelation } from './ingest';

// Ingestion — the step between "a parquet on S3" and "a grid".
export {
  describeSource,
  gridColumnsFromSource,
  registerArrowSource,
  registerJsonSource,
  registerParquetSource,
} from './ingest';
export type {
  RegisterArrowOptions,
  RegisterJsonOptions,
  RegisterParquetOptions,
} from './ingest';

/*
 * The clause builders individually, not just the whole source.
 *
 * A caller issuing their own query — a CSV export, an aggregate for a chart
 * beside the grid, a `COUNT(*)` for a badge — needs the same `WHERE` the grid
 * is showing. Rebuilding the filter translation slightly differently is
 * exactly how an export ends up disagreeing with the screen about what the
 * user asked for.
 */
export {
  buildCountSql,
  buildOrderBySql,
  buildPageSql,
  buildWhereSql,
} from './query-sql';
export type { BuildPageSqlInput, DuckDbColumnDescriptor } from './query-sql';
export {
  buildSourceSql,
  DuckDbQueryError,
  DUCKDB_CUSTOM_QUERY_ALIAS,
} from './source-sql';
export type { BuildSourceSqlInput } from './source-sql';

export { duckDbColumnStats } from './stats';

// Quoting. Every value this adapter puts into SQL goes through one of these,
// and a caller hand-writing a `project` layer must too — the fragments it
// returns are concatenated into the query verbatim.
export {
  duckDbIdentifier,
  duckDbStringLiteral,
  duckDbValueLiteral,
} from './sql';

export {
  fromArrowRow,
  fromArrowValue,
  parseRowCount,
  readNumber,
  readString,
} from './arrow';
export type { DuckDbCellValue } from './arrow';

/*
 * `dataGridColumnTypeFromSqlType` stays in core — a warehouse type name is not
 * a DuckDB concept and an HTTP source describing its columns needs it too —
 * but it is re-exported here, because this is where somebody goes looking.
 */
export { dataGridColumnTypeFromSqlType } from '../core/column-type';

/*
 * The SQL layer stack. Defined in `src/source/layers/sql.ts` because it
 * imports nothing from DuckDB — it is SQL string composition, so the same
 * stack drives any engine that speaks it — and re-exported here for
 * discoverability.
 */
export { SqlLayerStack } from '../source/layers/sql';
export type {
  SqlColumn,
  SqlMutation,
  SqlMutationContext,
  SqlProjectedColumn,
  SqlProjection,
  SqlProjectionContext,
  SqlSourceLayer,
} from '../source/layers/sql';
