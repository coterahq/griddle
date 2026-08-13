import * as React from 'react';
import { BaseCell, DataGrid, createDataGridViewModel } from '../../../src';
import type {
  DataGridCellComponentProps,
  DataGridColumn,
  DataGridHeaderComponentProps,
} from '../../../src';
import { createGridController } from '../../../src/source';
import { createMemoryDataSource } from '../../../src/memory';
import { makeOrders, ORDER_COLUMNS } from '../data';
import type { Order } from '../data';
import { DemoFrame } from '../demo-frame';

/**
 * Component override slots.
 *
 * `CellComponent` and `HeaderComponent` replace the defaults wholesale rather
 * than accepting a config object, which is the trade this library makes
 * everywhere: a small number of total replacements instead of a large number
 * of options that each need documenting and keeping working.
 *
 * Both overrides below still paint with `--dg-*`, so they follow the theme
 * without knowing anything about it — which is the practical benefit of the
 * tokens being the vocabulary rather than a preprocessor's variables.
 */

const ROWS = makeOrders(300);

/** A deterministic wiggle per row, so the sparkline is stable across renders. */
const spark = (seed: string): number[] => {
  let value = 0;
  for (const character of seed) {
    value = (value * 31 + character.charCodeAt(0)) % 9973;
  }
  return Array.from({ length: 12 }, (_, index) => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return 0.15 + ((value >>> 8) % 1000) / 1000 / (1 + index * 0.02);
  });
};

function SparklineCell(props: DataGridCellComponentProps<Order>) {
  const { context, style } = props;
  if (context.column.id !== 'total') {
    return <BaseCell<Order> {...props} />;
  }

  const points = spark(context.address.rowId.toString());
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 100;
      const y = 22 - point * 20;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div
      role="gridcell"
      aria-colindex={context.address.columnIndex + 2}
      className="absolute flex h-full items-center gap-2 overflow-hidden border-b border-r border-(color:--dg-border-subtle) px-3"
      style={style}
    >
      <svg viewBox="0 0 100 24" className="h-5 w-20 shrink-0" aria-hidden>
        <path
          d={path}
          fill="none"
          stroke="var(--dg-chart-bar)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="truncate text-xs tabular-nums text-(color:--dg-fg)">
        {typeof context.value === 'number'
          ? context.value.toLocaleString(undefined, {
              style: 'currency',
              currency: 'USD',
            })
          : '—'}
      </span>
    </div>
  );
}

function CompactHeader({
  context,
  style,
}: DataGridHeaderComponentProps<Order>) {
  const label =
    typeof context.column.header === 'string'
      ? context.column.header
      : context.column.id;

  return (
    <div
      role="columnheader"
      aria-colindex={context.columnIndex + 2}
      aria-sort={
        context.sort === null
          ? 'none'
          : context.sort.direction === 'asc'
            ? 'ascending'
            : 'descending'
      }
      className="absolute flex h-full items-center gap-1 border-b border-r border-(color:--dg-border) bg-(--dg-header-bg) px-2"
      style={style}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1 truncate text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-(color:--dg-muted-fg) hover:text-(color:--dg-fg)"
        onClick={() => {
          context.commands.toggleSort(
            context.sort?.direction === 'asc' ? 'desc' : 'asc'
          );
        }}
      >
        <span className="truncate">{label}</span>
        {context.sort === null ? null : (
          <span className="shrink-0 text-(color:--dg-accent)">
            {context.sort.direction === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </button>
    </div>
  );
}

const COLUMNS: DataGridColumn<Order>[] = ORDER_COLUMNS.filter(
  (column) => column.id !== 'margin'
).map((column) =>
  // The sparkline eats most of the default width, leaving the value truncated
  // to "U…". A cell override changing what a column needs is the column
  // author's problem to notice, which is worth showing rather than hiding.
  column.id === 'total' ? { ...column, width: 210 } : column
);

export function OverridesDemo(): React.ReactElement {
  const [custom, setCustom] = React.useState(true);

  const viewModel = React.useMemo(
    () =>
      createDataGridViewModel<Order>({ columns: COLUMNS, headerHeight: 34 }),
    []
  );
  const controller = React.useMemo(
    () =>
      createGridController<Order>({
        source: createMemoryDataSource<Order>({ rows: ROWS, columns: COLUMNS }),
        viewModel,
        getRowId: (row) => row.id,
      }),
    [viewModel]
  );
  React.useEffect(
    () => () => {
      controller.dispose();
    },
    [controller]
  );

  return (
    <DemoFrame
      title="Component overrides"
      blurb={
        <>
          A <code>CellComponent</code> drawing an inline SVG sparkline in the
          Total column, and a <code>HeaderComponent</code> replacing the whole
          header. Both paint with <code>--dg-*</code>, so they follow the theme
          without knowing it exists.
        </>
      }
      toolbar={
        <button
          type="button"
          className="toggle"
          onClick={() => {
            setCustom((current) => !current);
          }}
        >
          {custom ? 'Show defaults' : 'Show overrides'}
        </button>
      }
    >
      <DataGrid<Order>
        {...controller.gridProps}
        getRowId={(row) => row.id}
        viewModel={viewModel}
        {...(custom
          ? { CellComponent: SparklineCell, HeaderComponent: CompactHeader }
          : {})}
      />
    </DemoFrame>
  );
}
