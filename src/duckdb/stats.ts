import { dataGridColumnTypeFromSqlType } from '../core/column-type';
import type {
  DataGridColumnDataType,
  DataGridColumnStats,
  DataGridStatBucket,
} from '../core/types';
import { readNumber, readString } from './arrow';
import { duckDbIdentifier } from './sql';
import type { DuckDbQuery } from './types';

const STATS_BUCKET_COUNT = 12;
const STATS_TOP_VALUES = 5;
const STATS_CATEGORICAL_MAX_CARDINALITY = 50;

const epochToIso = (epochSeconds: number): string =>
  new Date(epochSeconds * 1000).toISOString();

const bucketRanges = (
  min: number,
  max: number
): { width: number; bucketCount: number } => {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { width: 1, bucketCount: 1 };
  }
  return {
    width: (max - min) / STATS_BUCKET_COUNT,
    bucketCount: STATS_BUCKET_COUNT,
  };
};

const histogramBuckets = ({
  rows,
  min,
  width,
  bucketCount,
  label,
  filterValue,
}: {
  rows: Record<string, unknown>[];
  min: number;
  width: number;
  bucketCount: number;
  label: (start: number, end: number) => string;
  filterValue: (
    start: number,
    end: number,
    isLast: boolean
  ) => DataGridStatBucket['filter'];
}): DataGridStatBucket[] => {
  const counts = new Map<number, number>();
  for (const row of rows) {
    const bucket = readNumber(row, 'bucket');
    const count = readNumber(row, 'bucket_count');
    if (bucket !== null && count !== null) {
      counts.set(bucket, count);
    }
  }
  return Array.from({ length: bucketCount }, (_, index) => {
    const start = min + index * width;
    const end = start + width;
    const isLast = index === bucketCount - 1;
    return {
      key: `bucket-${index}`,
      label: label(start, end),
      count: counts.get(index) ?? 0,
      filter: filterValue(start, end, isLast),
    };
  });
};

const numericColumnStats = async ({
  query,
  sourceSql,
  identifier,
}: {
  query: DuckDbQuery;
  sourceSql: string;
  identifier: string;
}): Promise<DataGridColumnStats> => {
  // TRY_CAST rather than the bare column: the artifact's declared type and the
  // parquet column's physical type do not always agree, and a binder error
  // here would take out the whole header.
  const numeric = `TRY_CAST(${identifier} AS DOUBLE)`;
  const summaryTable = await query(
    `SELECT min(${numeric}) AS min_value, max(${numeric}) AS max_value,
            avg(${numeric}) AS mean_value,
            count(*) FILTER (WHERE ${numeric} IS NULL) AS null_count
     FROM ${sourceSql} AS dataset_stats`
  );
  const summary = summaryTable.toArray()[0] as
    Record<string, unknown> | undefined;
  const min = readNumber(summary, 'min_value');
  const max = readNumber(summary, 'max_value');
  const mean = readNumber(summary, 'mean_value') ?? 0;
  const nullCount = readNumber(summary, 'null_count') ?? 0;
  if (min === null || max === null) {
    return { kind: 'textSummary', uniqueCount: 0, nullCount, totalCount: 0 };
  }

  const { width, bucketCount } = bucketRanges(min, max);
  const bucketTable = await query(
    `SELECT CAST(least(${
      bucketCount - 1
    }, floor((${numeric} - ${min}) / ${width})) AS INTEGER) AS bucket,
            count(*) AS bucket_count
     FROM ${sourceSql} AS dataset_stats
     WHERE ${numeric} IS NOT NULL
     GROUP BY 1 ORDER BY 1`
  );

  return {
    kind: 'numericDistribution',
    min,
    max,
    mean,
    nullCount,
    buckets: histogramBuckets({
      rows: bucketTable.toArray() as Record<string, unknown>[],
      min,
      width,
      bucketCount,
      label: (start, end) =>
        `${start.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })} – ${end.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      filterValue: (start, end, isLast) => ({
        kind: 'between',
        min: start,
        max: end,
        inclusiveMax: isLast,
      }),
    }),
  };
};

const temporalColumnStats = async ({
  query,
  sourceSql,
  identifier,
}: {
  query: DuckDbQuery;
  sourceSql: string;
  identifier: string;
}): Promise<DataGridColumnStats> => {
  const cast = `TRY_CAST(${identifier} AS TIMESTAMP)`;
  const summaryTable = await query(
    `SELECT epoch(min(${cast})) AS min_epoch, epoch(max(${cast})) AS max_epoch,
            CAST(min(${cast}) AS VARCHAR) AS min_label,
            CAST(max(${cast}) AS VARCHAR) AS max_label,
            count(*) FILTER (WHERE ${cast} IS NULL) AS null_count
     FROM ${sourceSql} AS dataset_stats`
  );
  const summary = summaryTable.toArray()[0] as
    Record<string, unknown> | undefined;
  const minEpoch = readNumber(summary, 'min_epoch');
  const maxEpoch = readNumber(summary, 'max_epoch');
  const nullCount = readNumber(summary, 'null_count') ?? 0;
  if (minEpoch === null || maxEpoch === null) {
    return { kind: 'textSummary', uniqueCount: 0, nullCount, totalCount: 0 };
  }

  const { width, bucketCount } = bucketRanges(minEpoch, maxEpoch);
  const bucketTable = await query(
    `SELECT CAST(least(${
      bucketCount - 1
    }, floor((epoch(${cast}) - ${minEpoch}) / ${width})) AS INTEGER) AS bucket,
            count(*) AS bucket_count
     FROM ${sourceSql} AS dataset_stats
     WHERE ${cast} IS NOT NULL
     GROUP BY 1 ORDER BY 1`
  );

  return {
    kind: 'temporalDistribution',
    min: readString(summary, 'min_label') ?? epochToIso(minEpoch),
    max: readString(summary, 'max_label') ?? epochToIso(maxEpoch),
    nullCount,
    buckets: histogramBuckets({
      rows: bucketTable.toArray() as Record<string, unknown>[],
      min: minEpoch,
      width,
      bucketCount,
      label: (start, end) =>
        `${epochToIso(start).slice(0, 10)} – ${epochToIso(end).slice(0, 10)}`,
      filterValue: (start, end, isLast) => ({
        kind: 'between',
        min: epochToIso(start),
        max: epochToIso(end),
        inclusiveMax: isLast,
      }),
    }),
  };
};

const categoricalColumnStats = async ({
  query,
  sourceSql,
  identifier,
}: {
  query: DuckDbQuery;
  sourceSql: string;
  identifier: string;
}): Promise<DataGridColumnStats> => {
  const [summaryTable, topTable] = await Promise.all([
    query(
      `SELECT count(*) AS total_count,
              count(*) FILTER (WHERE ${identifier} IS NULL) AS null_count,
              count(DISTINCT ${identifier}) AS unique_count
       FROM ${sourceSql} AS dataset_stats`
    ),
    query(
      `SELECT ${identifier}::VARCHAR AS value, count(*) AS value_count
       FROM ${sourceSql} AS dataset_stats
       WHERE ${identifier} IS NOT NULL
       GROUP BY 1 ORDER BY value_count DESC, value ASC
       LIMIT ${STATS_TOP_VALUES}`
    ),
  ]);
  const summary = summaryTable.toArray()[0] as
    Record<string, unknown> | undefined;
  const totalCount = readNumber(summary, 'total_count') ?? 0;
  const nullCount = readNumber(summary, 'null_count') ?? 0;
  const uniqueCount = readNumber(summary, 'unique_count') ?? 0;
  const topRows = topTable.toArray() as Record<string, unknown>[];
  const buckets: DataGridStatBucket[] = topRows.flatMap((row) => {
    const value = readString(row, 'value');
    const count = readNumber(row, 'value_count');
    if (value === null || count === null) {
      return [];
    }
    return [
      {
        key: value,
        label: value,
        count,
        share: totalCount === 0 ? 0 : count / totalCount,
        filter: { kind: 'in' as const, values: [value] },
      },
    ];
  });

  if (uniqueCount > STATS_CATEGORICAL_MAX_CARDINALITY) {
    return {
      kind: 'textSummary',
      uniqueCount,
      nullCount,
      totalCount,
      samples: buckets.slice(0, 2).map((bucket) => bucket.label),
    };
  }

  const covered = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  return {
    kind: 'categorical',
    buckets,
    uniqueCount,
    nullCount,
    otherCount: Math.max(0, totalCount - nullCount - covered),
  };
};

/**
 * Header stats for one column, computed by the engine.
 *
 * `sourceSql` is the fully resolved source — every layer wrapped, the active
 * `WHERE` applied — so a histogram here describes exactly the rows on screen
 * rather than the whole table.
 */
export const duckDbColumnStats = async ({
  query,
  sourceSql,
  columnName,
  columnType,
  gridType,
}: {
  query: DuckDbQuery;
  sourceSql: string;
  columnName: string;
  columnType?: string | null;
  /** Overrides what `columnType` would infer. */
  gridType?: DataGridColumnDataType;
}): Promise<DataGridColumnStats> => {
  const identifier = duckDbIdentifier(columnName);
  const type = gridType ?? dataGridColumnTypeFromSqlType(columnType);
  switch (type) {
    case 'number':
      return numericColumnStats({ query, sourceSql, identifier });
    case 'date':
    case 'timestamp':
      return temporalColumnStats({ query, sourceSql, identifier });
    default:
      return categoricalColumnStats({ query, sourceSql, identifier });
  }
};
