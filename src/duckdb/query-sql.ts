import {
  isComparisonFilterValue,
  isStructuredFilterValue,
} from '../core/filters';
import { dataGridColumnTypeFromSqlType } from '../core/column-type';
import type {
  DataGridColumnDataType,
  DataGridComparisonFilterValue,
  DataGridFilter,
  DataGridFilterComparison,
  DataGridFilterScalar,
  DataGridSort,
} from '../core/types';
import { duckDbIdentifier, duckDbStringLiteral } from './sql';

/**
 * What the SQL builder needs to know about a column.
 *
 * `sqlType` is the engine's own type name and is what drives typed predicates
 * — a date column compares as a timestamp, a number as a number, everything
 * else as text. `type` overrides the inference when a caller knows better than
 * the type name suggests.
 *
 * Deliberately structural and tiny. In the original this was
 * `DatasetArtifactMetadataOutput['schema']['columns']`, a warehouse API's
 * response type, which made the SQL builder unusable against a parquet file
 * nobody had registered as an artifact.
 */
export type DuckDbColumnDescriptor = {
  readonly id: string;
  /** The engine's type name, e.g. `'VARCHAR'`, `'TIMESTAMP'`, `'DOUBLE'`. */
  readonly sqlType?: string | null;
  /** Overrides what `sqlType` would infer. */
  readonly type?: DataGridColumnDataType;
};

const gridTypeOf = (column: DuckDbColumnDescriptor): DataGridColumnDataType =>
  column.type ?? dataGridColumnTypeFromSqlType(column.sqlType);

const isTemporalColumn = (column: DuckDbColumnDescriptor): boolean => {
  const type = gridTypeOf(column);
  return type === 'date' || type === 'timestamp';
};

/**
 * Ordering, with a stable fallback.
 *
 * A paged read with no `ORDER BY` is undefined. DuckDB may hand back scan
 * order today, but nothing holds it steady across pages — least of all after
 * a mutating layer has issued UPDATEs and INSERTs against the table — so rows
 * can repeat or disappear between pages of the same result.
 *
 * `defaultOrderBy` is the column to fall back on. In the original this was a
 * hard-coded dataset ordering column; a source that has no such column passes
 * nothing and accepts that an unsorted page is only stable if the engine says
 * it is.
 */
export const buildOrderBySql = (
  sorts: readonly DataGridSort[],
  columns: readonly DuckDbColumnDescriptor[],
  defaultOrderBy?: string | null
): string => {
  const activeSorts = sorts.filter((sort) =>
    columns.some((column) => column.id === sort.columnId)
  );
  if (activeSorts.length === 0) {
    return defaultOrderBy === undefined || defaultOrderBy === null
      ? ''
      : ` ORDER BY ${duckDbIdentifier(defaultOrderBy)}`;
  }
  return ` ORDER BY ${activeSorts
    .map(
      (sort) =>
        `${duckDbIdentifier(sort.columnId)} ${sort.direction.toUpperCase()}`
    )
    .join(', ')}`;
};

const COMPARISON_OPERATORS: Record<DataGridFilterComparison, string | null> = {
  equals: '=',
  notEquals: '<>',
  greaterThan: '>',
  greaterThanOrEqual: '>=',
  lessThan: '<',
  lessThanOrEqual: '<=',
  // Handled ahead of the operator table, having no right-hand operand or no
  // single operator.
  contains: null,
  isNull: null,
  isNotNull: null,
};

/**
 * The two sides of a comparison, read as the column's own type: numbers stay
 * numbers, dates become timestamps, and everything else compares as text.
 * Null when the operand cannot be read that way — a half-typed number, say.
 */
const comparisonOperandsSql = (
  identifier: string,
  value: DataGridFilterScalar,
  column: DuckDbColumnDescriptor
): { subject: string; literal: string } | null => {
  if (isTemporalColumn(column)) {
    return {
      subject: `CAST(${identifier} AS TIMESTAMP)`,
      literal: `CAST(${duckDbStringLiteral(String(value))} AS TIMESTAMP)`,
    };
  }
  const type = gridTypeOf(column);
  if (type === 'boolean') {
    return {
      subject: identifier,
      literal: value === true || value === 'true' ? 'TRUE' : 'FALSE',
    };
  }
  if (type === 'number') {
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? { subject: identifier, literal: String(numeric) }
      : null;
  }
  return {
    subject: `${identifier}::VARCHAR`,
    literal: duckDbStringLiteral(String(value)),
  };
};

const comparisonClauseSql = (
  identifier: string,
  filter: DataGridComparisonFilterValue,
  column: DuckDbColumnDescriptor
): string | null => {
  if (filter.comparison === 'isNull') {
    return `${identifier} IS NULL`;
  }
  if (filter.comparison === 'isNotNull') {
    return `${identifier} IS NOT NULL`;
  }
  if (filter.comparison === 'contains') {
    return `${identifier}::VARCHAR ILIKE ${duckDbStringLiteral(
      `%${String(filter.value)}%`
    )}`;
  }
  const operator = COMPARISON_OPERATORS[filter.comparison];
  const operands = comparisonOperandsSql(identifier, filter.value, column);
  return operator === null || operands === null
    ? null
    : `${operands.subject} ${operator} ${operands.literal}`;
};

/**
 * Translates one grid filter into DuckDB. Scalar values keep the existing
 * substring behaviour; comparison values come from the header's filter form
 * and structured values from stat marks, translated as typed predicates.
 */
const filterClauseSql = (
  filter: DataGridFilter,
  column: DuckDbColumnDescriptor
): string | null => {
  const identifier = duckDbIdentifier(filter.columnId);
  const value = filter.value;

  if (isComparisonFilterValue(value)) {
    return comparisonClauseSql(identifier, value, column);
  }

  if (isStructuredFilterValue(value)) {
    if (value.kind === 'in') {
      const clauses: string[] = [];
      const nonNull = value.values.filter((entry) => entry !== null);
      if (nonNull.length > 0) {
        clauses.push(
          `${identifier}::VARCHAR IN (${nonNull
            .map((entry) => duckDbStringLiteral(String(entry)))
            .join(', ')})`
        );
      }
      if (value.values.some((entry) => entry === null)) {
        clauses.push(`${identifier} IS NULL`);
      }
      return clauses.length === 0 ? null : `(${clauses.join(' OR ')})`;
    }

    const upperOperator = value.inclusiveMax === true ? '<=' : '<';
    if (isTemporalColumn(column)) {
      return `(CAST(${identifier} AS TIMESTAMP) >= CAST(${duckDbStringLiteral(
        String(value.min)
      )} AS TIMESTAMP) AND CAST(${identifier} AS TIMESTAMP) ${upperOperator} CAST(${duckDbStringLiteral(
        String(value.max)
      )} AS TIMESTAMP))`;
    }
    const min = Number(value.min);
    const max = Number(value.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return null;
    }
    return `(${identifier} >= ${min} AND ${identifier} ${upperOperator} ${max})`;
  }

  return `${identifier}::VARCHAR ILIKE ${duckDbStringLiteral(
    `%${String(value)}%`
  )}`;
};

/**
 * The `WHERE` clause for a set of grid filters, leading space included.
 *
 * A filter naming a column that is not in `columns` is dropped rather than
 * guessed at — the alternative is a binder error that takes out the whole
 * page for a stale filter chip.
 */
export const buildWhereSql = (
  filters: readonly DataGridFilter[],
  columns: readonly DuckDbColumnDescriptor[]
): string => {
  const clauses = filters.flatMap((filter) => {
    const column = columns.find(
      (candidate) => candidate.id === filter.columnId
    );
    if (column === undefined || filter.value === null) {
      return [];
    }
    const clause = filterClauseSql(filter, column);
    return clause === null ? [] : [clause];
  });
  return clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
};

export type BuildPageSqlInput = {
  /** A source expression: a table name, or the layer stack's wrapped subquery. */
  readonly source: string;
  readonly columns: readonly DuckDbColumnDescriptor[];
  readonly sorts?: readonly DataGridSort[];
  readonly filters?: readonly DataGridFilter[];
  readonly offset?: number;
  readonly limit?: number;
  readonly defaultOrderBy?: string | null;
};

/**
 * One page of rows.
 *
 * Exported alongside {@link buildWhereSql} and {@link buildOrderBySql} rather
 * than only as part of the data source, because the clause builders are what a
 * caller needs when they are issuing their own query — a `COUNT(*)` over the
 * same predicate, a CSV export, an aggregate for a chart beside the grid — and
 * rebuilding a filter translation slightly differently is exactly how the grid
 * and the export end up disagreeing about what the user asked for.
 */
export const buildPageSql = ({
  source,
  columns,
  sorts = [],
  filters = [],
  offset = 0,
  limit = 200,
  defaultOrderBy,
}: BuildPageSqlInput): string =>
  `SELECT * FROM ${source} AS dg_source` +
  buildWhereSql(filters, columns) +
  buildOrderBySql(sorts, columns, defaultOrderBy) +
  ` LIMIT ${String(limit)} OFFSET ${String(offset)}`;

/** `COUNT(*)` under the same predicate a page would use. */
export const buildCountSql = ({
  source,
  columns,
  filters = [],
}: Pick<BuildPageSqlInput, 'source' | 'columns' | 'filters'>): string =>
  `SELECT count(*) AS dg_total FROM ${source} AS dg_source` +
  buildWhereSql(filters, columns);
