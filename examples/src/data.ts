import type { DataGridColumn, DataGridColumnStats } from '../../src';

/**
 * A fixture chosen to exercise decoration, not to look plausible.
 *
 * Every visual the theming milestone touches needs a row that triggers it:
 * a pinned column, a numeric column wide enough for the in-cell bar, a
 * low-cardinality column for the categorical chart, a numeric one for the
 * histogram, an editable column, and nulls. A prettier dataset that skipped
 * any of those would make the screenshots useless as a baseline.
 */
export type Order = {
  id: string;
  customer: string;
  status: string;
  region: string;
  total: number;
  items: number;
  placedAt: string;
  note: string | null;
};

const STATUSES = ['Fulfilled', 'Pending', 'Cancelled', 'Refunded'];
const REGIONS = ['NA', 'EMEA', 'APAC', 'LATAM'];
const NAMES = [
  'Acme Industrial',
  'Blue Harbour',
  'Cinder & Co',
  'Delta Freight',
  'Eastgate Labs',
  'Fenwick Supply',
  'Granite Works',
  'Halcyon Metals',
];

/**
 * Deterministic, because these rows back screenshots that get diffed. A
 * `Math.random()` fixture would make every capture a new baseline.
 */
const mulberry32 = (seed: number) => (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const makeOrders = (count: number): Order[] => {
  const random = mulberry32(42);
  return Array.from({ length: count }, (_, index) => {
    const day = Math.floor(random() * 240);
    return {
      id: `ORD-${String(10_000 + index)}`,
      customer: NAMES[Math.floor(random() * NAMES.length)] ?? 'Acme Industrial',
      status: STATUSES[Math.floor(random() * STATUSES.length)] ?? 'Pending',
      region: REGIONS[Math.floor(random() * REGIONS.length)] ?? 'NA',
      total: Math.round(random() * 48_000) / 100,
      items: 1 + Math.floor(random() * 24),
      placedAt: new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10),
      // Roughly a third null, so the muted `null` cell rendering is on screen.
      note: random() < 0.34 ? null : 'Priority handling requested',
    };
  });
};

export const ORDER_COLUMNS: DataGridColumn<Order>[] = [
  {
    id: 'id',
    header: 'Order',
    type: 'text',
    width: 130,
    pinned: 'left',
    getValue: (row) => row.id,
  },
  {
    id: 'customer',
    header: 'Customer',
    type: 'text',
    width: 190,
    editable: true,
    getValue: (row) => row.customer,
  },
  {
    id: 'status',
    header: 'Status',
    type: 'text',
    typeLabel: 'enum',
    width: 130,
    editable: true,
    editorKind: 'select',
    getEditOptions: () => STATUSES,
    getValue: (row) => row.status,
  },
  {
    id: 'region',
    header: 'Region',
    type: 'text',
    width: 110,
    getValue: (row) => row.region,
  },
  {
    id: 'total',
    header: 'Total',
    type: 'number',
    width: 140,
    getValue: (row) => row.total,
  },
  {
    id: 'items',
    header: 'Items',
    type: 'number',
    width: 100,
    getValue: (row) => row.items,
  },
  {
    id: 'placedAt',
    header: 'Placed',
    type: 'date',
    width: 130,
    getValue: (row) => row.placedAt,
  },
  {
    id: 'note',
    header: 'Note',
    type: 'text',
    width: 220,
    getValue: (row) => row.note,
  },
  {
    id: 'margin',
    header: 'Margin',
    type: 'number',
    computed: true,
    width: 120,
    getValue: (row) => Math.round(row.total * 0.18 * 100) / 100,
  },
];

const countBy = (values: string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
};

/**
 * Stats computed in the browser, which is exactly what `/memory` will do
 * properly at L3. Here they exist so the header charts have something to draw
 * — the histogram, the categorical bars and the null footnote are all
 * colour-heavy and all need to be in the baseline screenshots.
 */
export const orderStats = (
  rows: Order[]
): Record<string, DataGridColumnStats | undefined> => {
  const totals = rows.map((row) => row.total);
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  const bucketCount = 12;
  const size = (max - min) / bucketCount || 1;
  const histogram = Array.from({ length: bucketCount }, (_, index) => {
    const low = min + index * size;
    const high = min + (index + 1) * size;
    return {
      key: `bucket-${String(index)}`,
      label: `${Math.round(low).toLocaleString()}–${Math.round(high).toLocaleString()}`,
      count: totals.filter(
        (value) =>
          value >= low &&
          (index === bucketCount - 1 ? value <= max : value < high)
      ).length,
      filter: {
        kind: 'between' as const,
        min: low,
        max: high,
        inclusiveMax: index === bucketCount - 1,
      },
    };
  });

  const categorical = (key: 'status' | 'region'): DataGridColumnStats => ({
    kind: 'categorical',
    buckets: [...countBy(rows.map((row) => row[key]))]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({
        key: label,
        label,
        count,
        // A mark click filters the column to this bucket, which is the path
        // that paints the filtered-header wash.
        filter: { kind: 'in' as const, values: [label] },
      })),
    uniqueCount: new Set(rows.map((row) => row[key])).size,
    nullCount: 0,
  });

  return {
    id: {
      kind: 'textSummary',
      uniqueCount: rows.length,
      nullCount: 0,
      totalCount: rows.length,
    },
    customer: {
      kind: 'textSummary',
      uniqueCount: new Set(rows.map((row) => row.customer)).size,
      nullCount: 0,
      totalCount: rows.length,
      samples: [...new Set(rows.map((row) => row.customer))].slice(0, 3),
    },
    status: categorical('status'),
    region: categorical('region'),
    total: {
      kind: 'numericDistribution',
      buckets: histogram,
      min,
      max,
      mean: totals.reduce((sum, value) => sum + value, 0) / totals.length,
      nullCount: 0,
    },
    items: {
      kind: 'summary',
      label: 'avg',
      value: (
        rows.reduce((sum, row) => sum + row.items, 0) / rows.length
      ).toFixed(1),
    },
    placedAt: {
      kind: 'summary',
      label: 'range',
      value: `${rows[0]?.placedAt ?? ''} → ${rows.at(-1)?.placedAt ?? ''}`,
    },
    note: {
      kind: 'textSummary',
      uniqueCount: 1,
      nullCount: rows.filter((row) => row.note === null).length,
      totalCount: rows.length,
    },
    margin: { kind: 'error', message: 'Computed columns have no stats' },
  };
};
