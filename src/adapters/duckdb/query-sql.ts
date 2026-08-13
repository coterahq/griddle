import {
  duckDbIdentifier,
  duckDbStringLiteral,
} from '@cotera/client/app/etc/duckdb';
import {
  dataGridColumnTypeFromSqlType,
  isComparisonFilterValue,
  isStructuredFilterValue,
} from '@cotera/client/app/components/ui/data-grid';
import type {
  DataGridComparisonFilterValue,
  DataGridFilter,
  DataGridFilterComparison,
  DataGridFilterScalar,
  DataGridSort,
} from '@cotera/client/app/components/ui/data-grid';
import type { DatasetArtifactMetadataOutput } from '@cotera/client/app/etc/api/typed-client';
import { DATASET_PREVIEW_ORDER_COLUMN } from './operations';

export const sortSql = (
  sorts: DataGridSort[],
  columns: DatasetArtifactMetadataOutput['schema']['columns'],
  /**
   * Whether the source still carries {@link DATASET_PREVIEW_ORDER_COLUMN}, and
   * so can be given a stable default order.
   */
  ordered = false
): string => {
  const activeSorts = sorts.filter((sort) =>
    columns.some((column) => column.name === sort.columnId)
  );
  if (activeSorts.length === 0) {
    // A paged read with no ORDER BY is undefined: DuckDB may hand back scan
    // order today, but nothing holds it steady across pages, least of all
    // after the operation replay has issued UPDATEs and INSERTs against the
    // table. Without this, rows can repeat or disappear between pages, and
    // the fractional ordering that positions an inserted row does nothing at
    // all because nothing reads it.
    return ordered
      ? ` ORDER BY ${duckDbIdentifier(DATASET_PREVIEW_ORDER_COLUMN)}`
      : '';
  }
  return ` ORDER BY ${activeSorts
    .map(
      (sort) =>
        `${duckDbIdentifier(sort.columnId)} ${sort.direction.toUpperCase()}`
    )
    .join(', ')}`;
};

const isTemporalColumn = (
  column: DatasetArtifactMetadataOutput['schema']['columns'][number]
): boolean => {
  const type = dataGridColumnTypeFromSqlType(column.type);
  return type === 'date' || type === 'timestamp';
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
  column: DatasetArtifactMetadataOutput['schema']['columns'][number]
): { subject: string; literal: string } | null => {
  if (isTemporalColumn(column)) {
    return {
      subject: `CAST(${identifier} AS TIMESTAMP)`,
      literal: `CAST(${duckDbStringLiteral(String(value))} AS TIMESTAMP)`,
    };
  }
  const type = dataGridColumnTypeFromSqlType(column.type);
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
  column: DatasetArtifactMetadataOutput['schema']['columns'][number]
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
  column: DatasetArtifactMetadataOutput['schema']['columns'][number]
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

export const filterSql = (
  filters: DataGridFilter[],
  columns: DatasetArtifactMetadataOutput['schema']['columns']
): string => {
  const clauses = filters.flatMap((filter) => {
    const column = columns.find(
      (candidate) => candidate.name === filter.columnId
    );
    if (column === undefined || filter.value === null) {
      return [];
    }
    const clause = filterClauseSql(filter, column);
    return clause === null ? [] : [clause];
  });
  return clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
};
