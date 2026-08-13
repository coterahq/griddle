import type {
  DataGridColumn,
  DataGridColumnStats,
  DataGridFilter,
  DataGridSort,
  DataGridStatBucket,
} from '../core/types';
import type { GridDataSource, GridPage, GridQuery } from '../source/types';
import { compareValues, matchesFilterValue } from './filter';

export type CreateMemoryDataSourceOptions<TRow> = {
  rows: readonly TRow[] | (() => readonly TRow[]);
  /**
   * Used for value access, the declared type each filter and sort is evaluated
   * under, and the shape of the stats each column reports. The same array the
   * grid is given.
   */
  columns: readonly DataGridColumn<TRow>[];
  /** Buckets in a numeric or temporal histogram. */
  histogramBuckets?: number;
  /** Categories charted before the rest collapse into "+ N more". */
  topCategories?: number;
  /** Simulated latency, for exercising loading and abort paths in a demo. */
  delayMs?: number;
};

const DEFAULT_HISTOGRAM_BUCKETS = 12;
const DEFAULT_TOP_CATEGORIES = 5;

const isMissing = (value: unknown): boolean =>
  value === null || value === undefined;

/**
 * A value as a number a histogram can bucket, or `null` if it is not one.
 *
 * `temporal` is not a nicety: a date column almost always holds ISO strings,
 * and `Number('2025-01-05')` is `NaN`. Without the flag every date column
 * silently degraded to a categorical chart of distinct timestamps.
 */
const numericOf = (value: unknown, temporal: boolean): number | null => {
  if (isMissing(value)) {
    return null;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (temporal) {
    const parsed =
      typeof value === 'number' ? value : Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const compactLabel = (value: number, temporal: boolean): string =>
  temporal
    ? new Date(value).toISOString().slice(0, 10)
    : Math.abs(value) >= 1000
      ? value.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : String(Math.round(value * 100) / 100);

/**
 * A {@link GridDataSource} over an array already in memory.
 *
 * Three jobs, in order of how much they matter.
 *
 * It is the **reference implementation**: every filter shape the grid can
 * produce is evaluated here, in `./filter.ts`, in plain readable JavaScript.
 * When `/duckdb` and `/http` disagree with it about what a filter means, they
 * are wrong — L5 proves its SQL row-for-row equal to this over a shared
 * fixture, and that test is only meaningful because this side is simple enough
 * to read and agree with.
 *
 * It is the **path of least resistance** for a caller with 500 rows and no
 * backend, who should not have to meet the words "page", "abort" or
 * "generation" to put an array on screen.
 *
 * And it is the **stats reference**: `loadColumnStats` derives a categorical,
 * numeric or temporal summary from `column.type`, under the active filters, so
 * the header charts have a working implementation to be compared against.
 *
 * Filtering and sorting run over the whole array on every query rather than
 * being cached. At in-memory sizes that is microseconds, and a cache would be
 * a correctness surface — the array is allowed to be a function, precisely so
 * a caller can hand over live data.
 */
export function createMemoryDataSource<TRow>({
  rows,
  columns,
  histogramBuckets = DEFAULT_HISTOGRAM_BUCKETS,
  topCategories = DEFAULT_TOP_CATEGORIES,
  delayMs = 0,
}: CreateMemoryDataSourceOptions<TRow>): GridDataSource<TRow> {
  const columnsById = new Map(columns.map((column) => [column.id, column]));
  const allRows = (): readonly TRow[] =>
    typeof rows === 'function' ? rows() : rows;

  const valueOf = (row: TRow, columnId: string): unknown =>
    columnsById.get(columnId)?.getValue(row);

  const applyFilters = (source: readonly TRow[], filters: DataGridFilter[]) =>
    filters.length === 0
      ? source
      : source.filter((row) =>
          filters.every((filter) =>
            matchesFilterValue(
              valueOf(row, filter.columnId),
              filter.value,
              columnsById.get(filter.columnId)?.type
            )
          )
        );

  /**
   * Multi-key and stable. `Array.prototype.sort` is stable in every engine
   * this runs on, so ties fall back to the previous ordering — which is what
   * makes "sort by region, then by total" behave as a user expects rather than
   * reshuffling within a region on every re-sort.
   *
   * Nulls last regardless of direction: a descending sort should not open with
   * a screen of empty cells.
   */
  const applySorts = (source: readonly TRow[], sorts: DataGridSort[]) => {
    if (sorts.length === 0) {
      return source;
    }
    return [...source].sort((left, right) => {
      for (const sort of sorts) {
        const type = columnsById.get(sort.columnId)?.type;
        const a = valueOf(left, sort.columnId);
        const b = valueOf(right, sort.columnId);
        const aMissing = isMissing(a);
        const bMissing = isMissing(b);
        if (aMissing || bMissing) {
          if (aMissing && bMissing) {
            continue;
          }
          return aMissing ? 1 : -1;
        }
        const order = compareValues(a, b, type);
        if (order !== null && order !== 0) {
          return sort.direction === 'asc' ? order : -order;
        }
      }
      return 0;
    });
  };

  const settle = async (signal: AbortSignal | undefined): Promise<void> => {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    // Even at zero delay this yields, so a caller that toggles a sort twice in
    // one tick genuinely has two queries in flight — which is the only way the
    // controller's generation handling gets exercised rather than assumed.
    await Promise.resolve();
    signal?.throwIfAborted();
  };

  const matching = (filters: DataGridFilter[]): readonly TRow[] =>
    applyFilters(allRows(), filters);

  const categoricalStats = (
    values: unknown[],
    nullCount: number
  ): DataGridColumnStats => {
    const counts = new Map<string, number>();
    for (const value of values) {
      const key = String(value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const ordered = [...counts].sort((a, b) => b[1] - a[1]);
    const top = ordered.slice(0, topCategories);
    const buckets: DataGridStatBucket[] = top.map(([label, count]) => ({
      key: label,
      label,
      count,
      filter: { kind: 'in', values: [label] },
    }));
    return {
      kind: 'categorical',
      buckets,
      uniqueCount: counts.size,
      nullCount,
      otherCount: ordered
        .slice(topCategories)
        .reduce((sum, [, count]) => sum + count, 0),
    };
  };

  const distributionStats = (
    numbers: number[],
    nullCount: number,
    temporal: boolean
  ): DataGridColumnStats => {
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    // A column with one distinct value still deserves a bar rather than a
    // divide-by-zero, so the width floors at 1.
    const width = (max - min) / histogramBuckets || 1;
    const buckets: DataGridStatBucket[] = Array.from(
      { length: histogramBuckets },
      (_, index) => {
        const low = min + index * width;
        const high = min + (index + 1) * width;
        const last = index === histogramBuckets - 1;
        return {
          key: `bucket-${String(index)}`,
          label: `${compactLabel(low, temporal)} – ${compactLabel(high, temporal)}`,
          count: numbers.filter(
            (value) => value >= low && (last ? value <= max : value < high)
          ).length,
          // Half-open, except the top bucket, so adjacent bars do not both
          // claim a value sitting exactly on their shared boundary.
          filter: {
            kind: 'between',
            min: temporal ? new Date(low).toISOString() : low,
            max: temporal ? new Date(high).toISOString() : high,
            inclusiveMax: last,
          },
        };
      }
    );

    if (temporal) {
      return {
        kind: 'temporalDistribution',
        buckets,
        min: new Date(min).toISOString(),
        max: new Date(max).toISOString(),
        nullCount,
      };
    }
    return {
      kind: 'numericDistribution',
      buckets,
      min,
      max,
      mean: numbers.reduce((sum, value) => sum + value, 0) / numbers.length,
      nullCount,
    };
  };

  return {
    async loadPage(queryInput: GridQuery): Promise<GridPage<TRow>> {
      await settle(queryInput.signal);
      const filtered = matching(queryInput.filters);
      const sorted = applySorts(filtered, queryInput.sorts);
      return {
        rows: sorted.slice(
          queryInput.offset,
          queryInput.offset + queryInput.limit
        ),
        // Always exact — counting an array is free, so the page-full heuristic
        // never has to run against this source.
        total: filtered.length,
      };
    },

    async loadTotal({ filters, signal }): Promise<number | null> {
      await settle(signal);
      return matching(filters).length;
    },

    async loadColumnStats({
      columnId,
      filters,
      signal,
    }): Promise<DataGridColumnStats> {
      await settle(signal);
      const column = columnsById.get(columnId);
      if (column === undefined) {
        return { kind: 'error', message: `Unknown column: ${columnId}` };
      }

      const population = matching(filters);
      const values = population.map((row) => column.getValue(row));
      const present = values.filter((value) => !isMissing(value));
      const nullCount = values.length - present.length;

      if (present.length === 0) {
        return {
          kind: 'textSummary',
          uniqueCount: 0,
          nullCount,
          totalCount: values.length,
        };
      }

      switch (column.type) {
        case 'number':
        case 'date':
        case 'timestamp': {
          const temporal = column.type !== 'number';
          const numbers = present
            .map((value) => numericOf(value, temporal))
            .filter((value): value is number => value !== null);
          // A "number" column holding unparseable values is not a
          // distribution; fall through to the categorical summary rather than
          // charting a histogram of NaN.
          if (numbers.length > 0) {
            return distributionStats(numbers, nullCount, temporal);
          }
          return categoricalStats(present, nullCount);
        }
        case 'boolean':
        case 'category':
          return categoricalStats(present, nullCount);
        case 'text':
        case 'unknown':
        case undefined: {
          const unique = new Set(present.map((value) => String(value)));
          // Low cardinality is worth charting; high cardinality is not — a bar
          // chart of 5,000 distinct order ids tells a reader nothing.
          if (unique.size <= topCategories * 2) {
            return categoricalStats(present, nullCount);
          }
          return {
            kind: 'textSummary',
            uniqueCount: unique.size,
            nullCount,
            totalCount: values.length,
            samples: [...unique].slice(0, 3),
          };
        }
        default:
          return { kind: 'summary', label: 'rows', value: values.length };
      }
    },
  };
}
