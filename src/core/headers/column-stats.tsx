import React from 'react';
import { cn } from '../../ui/cn';
import { unreachable } from '../../internal/assert';
import { Tooltip } from '../../ui/tooltip';
import { filterSelectsValue } from '../filters';
import type {
  DataGridColumnStats,
  DataGridStatBucket,
  DataGridStructuredFilterValue,
} from '../types';

const compactNumber = (value: number): string =>
  new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);

const sharePercent = (bucket: DataGridStatBucket, total: number): number => {
  if (bucket.share !== undefined) {
    return bucket.share;
  }
  return total <= 0 ? 0 : bucket.count / total;
};

type MarkProps = {
  bucket: DataGridStatBucket;
  columnLabel: string;
  filterValue: unknown;
  onSelect: (value: DataGridStructuredFilterValue) => void;
  heightShare: number;
  orientation: 'vertical' | 'horizontal';
  total: number;
};

const markLabel = (
  bucket: DataGridStatBucket,
  columnLabel: string,
  selected: boolean
): string =>
  `${selected ? 'Remove filter' : 'Filter'} ${columnLabel} by ${
    bucket.label
  } (${compactNumber(bucket.count)})`;

/**
 * A single interactive stat mark. Marks are buttons so keyboard users get the
 * same tooltip and filter affordance as pointer users. The tooltip is the
 * shared hover-card one and renders through the app's portal, so it is never
 * clipped by the header and never swallows the click-to-filter interaction.
 */
const StatMark: React.FC<MarkProps> = ({
  bucket,
  columnLabel,
  filterValue,
  onSelect,
  heightShare,
  orientation,
  total,
}) => {
  const selected = filterSelectsValue(filterValue, bucket.filter);
  const interactive = bucket.filter !== undefined;
  const size = `${Math.max(4, Math.round(heightShare * 100))}%`;

  const handleSelect = (event: React.MouseEvent | React.KeyboardEvent) => {
    event.stopPropagation();
    if (bucket.filter !== undefined) {
      onSelect(bucket.filter);
    }
  };

  return (
    <Tooltip
      asChild
      side="top"
      openDelay={120}
      closeDelay={80}
      className="px-2 py-1"
      tooltipContent={
        <div className="whitespace-nowrap text-xs">
          <div className="font-medium text-foreground">{bucket.label}</div>
          <div className="text-muted-foreground">
            {compactNumber(bucket.count)} ·{' '}
            {Math.round(sharePercent(bucket, total) * 100)}%
          </div>
        </div>
      }
    >
      <button
        type="button"
        disabled={!interactive}
        aria-pressed={interactive ? selected : undefined}
        aria-label={markLabel(bucket, columnLabel, selected)}
        className={cn(
          'group/mark relative flex min-w-0 outline-none transition-colors',
          orientation === 'vertical'
            ? 'h-full flex-1 items-end rounded-[2px]'
            : // Horizontal marks carry a track so the unfilled remainder reads
              // as "share of the column" rather than a bare bar.
              'h-2 w-full items-center rounded-full bg-primary/10',
          interactive ? 'cursor-pointer' : 'cursor-default'
        )}
        onClick={handleSelect}
      >
        <span
          className={cn(
            'block transition-colors',
            orientation === 'vertical'
              ? 'w-full rounded-[2px]'
              : 'h-full rounded-full',
            selected
              ? 'bg-primary ring-1 ring-inset ring-primary'
              : 'bg-primary/45 group-hover/mark:bg-primary/70 group-focus/mark:bg-primary/70'
          )}
          style={
            orientation === 'vertical' ? { height: size } : { width: size }
          }
        />
      </button>
    </Tooltip>
  );
};

type ChartProps = {
  buckets: DataGridStatBucket[];
  columnLabel: string;
  filterValue: unknown;
  onSelect: (value: DataGridStructuredFilterValue) => void;
  total: number;
};

/** Vertical mini histogram used for numeric and temporal distributions. */
const HistogramChart: React.FC<ChartProps> = ({
  buckets,
  columnLabel,
  filterValue,
  onSelect,
  total,
}) => {
  const maxCount = buckets.reduce(
    (max, bucket) => Math.max(max, bucket.count),
    0
  );

  return (
    <div className="flex h-6 items-end gap-[2px]">
      {buckets.map((bucket) => (
        <StatMark
          key={bucket.key}
          bucket={bucket}
          columnLabel={columnLabel}
          filterValue={filterValue}
          onSelect={onSelect}
          orientation="vertical"
          heightShare={maxCount <= 0 ? 0 : bucket.count / maxCount}
          total={total}
        />
      ))}
    </div>
  );
};

const CATEGORICAL_TOP_N = 3;

/** Shared row geometry so the "+ N more" row lines up with the real ones. */
const StatRow: React.FC<{
  label: React.ReactNode;
  bar: React.ReactNode;
  count: number;
  muted?: boolean;
}> = ({ label, bar, count, muted = false }) => (
  <div className="flex items-center gap-1.5">
    <span
      className={cn(
        'w-[45%] min-w-0 truncate text-[10px] font-normal leading-tight',
        muted ? 'text-muted-foreground/60' : 'text-foreground/80'
      )}
    >
      {label}
    </span>
    <div className="min-w-0 flex-1">{bar}</div>
    <span
      className={cn(
        'shrink-0 text-[10px] font-normal leading-tight tabular-nums',
        muted ? 'text-muted-foreground/60' : 'text-muted-foreground'
      )}
    >
      {compactNumber(count)}
    </span>
  </div>
);

/** Horizontal top-values bars used for categorical columns. */
const CategoricalChart: React.FC<
  ChartProps & { uniqueCount?: number; otherCount?: number }
> = ({
  buckets,
  columnLabel,
  filterValue,
  onSelect,
  total,
  uniqueCount,
  otherCount,
}) => {
  const shown = buckets.slice(0, CATEGORICAL_TOP_N);
  const categoryCount = uniqueCount ?? buckets.length;
  const remaining = Math.max(0, categoryCount - shown.length);
  // Bars are scaled against the largest count on screen, including the
  // remainder, so the "+ N more" row cannot overflow the others.
  const maxCount = [
    ...shown,
    ...(remaining > 0 ? [{ count: otherCount ?? 0 }] : []),
  ].reduce((max, bucket) => Math.max(max, bucket.count), 0);

  return (
    <div className="space-y-[3px]">
      <StatCaption>
        {categoryCount.toLocaleString()}{' '}
        {categoryCount === 1 ? 'category' : 'categories'}
        {remaining > 0 ? ` · top ${shown.length}` : ''}
      </StatCaption>
      {shown.map((bucket) => (
        <StatRow
          key={bucket.key}
          label={bucket.label}
          count={bucket.count}
          bar={
            <StatMark
              bucket={bucket}
              columnLabel={columnLabel}
              filterValue={filterValue}
              onSelect={onSelect}
              orientation="horizontal"
              heightShare={maxCount <= 0 ? 0 : bucket.count / maxCount}
              total={total}
            />
          }
        />
      ))}
      {remaining > 0 ? (
        <StatRow
          muted
          label={`+ ${remaining.toLocaleString()} more`}
          count={otherCount ?? 0}
          bar={
            <div
              aria-hidden
              className="h-2 w-full rounded-full bg-primary/10"
              title={`${remaining.toLocaleString()} more categories`}
            >
              <div
                className="h-full rounded-full bg-primary/20"
                style={{
                  width: `${
                    maxCount <= 0
                      ? 0
                      : Math.round(((otherCount ?? 0) / maxCount) * 100)
                  }%`,
                }}
              />
            </div>
          }
        />
      ) : null}
    </div>
  );
};

const StatFootnote: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <div className="mt-1 flex items-center justify-between gap-2 truncate text-[10px] font-normal leading-tight text-muted-foreground/80">
    {children}
  </div>
);

/** The eyebrow above every stats block; keeps headers visually aligned. */
const StatCaption: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="truncate text-[9px] font-medium uppercase tracking-wide text-muted-foreground/60">
    {children}
  </div>
);

export type DataGridColumnStatsViewProps = {
  stats: DataGridColumnStats | null;
  columnLabel: string;
  filterValue: unknown;
  onSelectStatFilter: (value: DataGridStructuredFilterValue) => void;
};

/**
 * Renders already-loaded stats. This never computes stats — it formats a
 * payload and routes mark interactions back into grid filter commands.
 */
export const DataGridColumnStatsView: React.FC<
  DataGridColumnStatsViewProps
> = ({ stats, columnLabel, filterValue, onSelectStatFilter }) => {
  if (stats === null) {
    return null;
  }

  switch (stats.kind) {
    case 'loading':
      return (
        <div className="space-y-1" aria-label={`Loading ${columnLabel} stats`}>
          <div className="h-4 w-full animate-pulse rounded bg-muted-foreground/15" />
          <div className="h-2 w-1/2 animate-pulse rounded bg-muted-foreground/10" />
        </div>
      );
    case 'error':
      return (
        <Tooltip
          asChild
          side="top"
          className="max-w-80"
          tooltipContent={
            <span className="text-xs text-muted-foreground">
              {stats.message ?? 'Could not load stats'}
            </span>
          }
        >
          <div className="w-fit cursor-help truncate text-[10px] font-normal leading-tight text-muted-foreground/70 underline decoration-dotted underline-offset-2">
            Stats unavailable
          </div>
        </Tooltip>
      );
    case 'summary':
      return (
        <div className="truncate text-[11px] font-normal text-muted-foreground">
          {stats.label}: {stats.value}
        </div>
      );
    case 'custom':
      return <>{stats.content}</>;
    case 'textSummary':
      return (
        <div className="space-y-1">
          <StatCaption>
            {compactNumber(stats.uniqueCount)} unique
            {stats.totalCount > 0
              ? ` · ${Math.round(
                  (stats.uniqueCount / stats.totalCount) * 100
                )}% distinct`
              : ''}
          </StatCaption>
          {stats.samples !== undefined && stats.samples.length > 0 ? (
            <div className="space-y-[3px]">
              {stats.samples.slice(0, CATEGORICAL_TOP_N).map((sample) => (
                <div
                  key={sample}
                  className="truncate text-[10px] font-normal leading-tight text-foreground/70"
                >
                  {sample}
                </div>
              ))}
            </div>
          ) : null}
          {stats.nullCount > 0 ? (
            <StatFootnote>
              <span>{compactNumber(stats.nullCount)} null</span>
            </StatFootnote>
          ) : null}
        </div>
      );
    case 'categorical': {
      const total = stats.buckets.reduce(
        (sum, bucket) => sum + bucket.count,
        stats.otherCount ?? 0
      );
      return (
        <CategoricalChart
          buckets={stats.buckets}
          columnLabel={columnLabel}
          filterValue={filterValue}
          onSelect={onSelectStatFilter}
          total={total}
          uniqueCount={stats.uniqueCount}
          otherCount={stats.otherCount}
        />
      );
    }
    case 'numericDistribution': {
      const total = stats.buckets.reduce(
        (sum, bucket) => sum + bucket.count,
        0
      );
      return (
        <div className="space-y-1">
          <StatCaption>
            Distribution · μ {compactNumber(stats.mean)}
          </StatCaption>
          <HistogramChart
            buckets={stats.buckets}
            columnLabel={columnLabel}
            filterValue={filterValue}
            onSelect={onSelectStatFilter}
            total={total}
          />
          <StatFootnote>
            <span className="truncate">{compactNumber(stats.min)}</span>
            {stats.nullCount !== undefined && stats.nullCount > 0 ? (
              <span className="truncate">
                {compactNumber(stats.nullCount)} null
              </span>
            ) : null}
            <span className="truncate">{compactNumber(stats.max)}</span>
          </StatFootnote>
        </div>
      );
    }
    case 'temporalDistribution': {
      const total = stats.buckets.reduce(
        (sum, bucket) => sum + bucket.count,
        0
      );
      return (
        <div className="space-y-1">
          <StatCaption>Timeline</StatCaption>
          <HistogramChart
            buckets={stats.buckets}
            columnLabel={columnLabel}
            filterValue={filterValue}
            onSelect={onSelectStatFilter}
            total={total}
          />
          <StatFootnote>
            <span className="truncate">{stats.min.slice(0, 10)}</span>
            <span className="truncate">{stats.max.slice(0, 10)}</span>
          </StatFootnote>
        </div>
      );
    }
    default:
      return unreachable(stats);
  }
};
