import React from 'react';
import type { ReadonlyGridStore } from '../store';
import { createGridStore, isGridStore, useGridStore } from '../store';
import { cn } from '../ui/cn';
import { Icon } from '../ui/icons';
import { DATA_GRID_THEME_CLASS } from '../ui/theme-scope';
import {
  DATA_GRID_DEFAULT_COLUMN_WIDTH,
  getDataGridColumnLayout,
} from './column-layout';
import { BaseCell } from './cells/base-cell';
import { describeFilterValue, toggleStructuredFilterValue } from './filters';
import { DataGridHeader } from './headers/header';
import {
  DATA_GRID_GUTTER_CHEVRON_CLASS,
  RowNumberHeader,
} from './headers/row-number-header';
import { getAddressForCell, getKeyboardAction } from './keyboard';
import { DataGridOverlay, useDataGridOverlay } from './overlay';
import {
  getVirtualizedColumns,
  getVirtualizedRangeWithOffsets,
} from './virtualization';
import { createRowOffsetIndex } from './row-offsets';
import { DEFAULT_DATA_GRID_DISPLAY_OPTIONS } from './types';
import { dataGridEditKey } from './types';
import type {
  DataGridCellAddress,
  DataGridCellComponentProps,
  DataGridCellContext,
  DataGridCellEdit,
  DataGridCellRange,
  DataGridColumnDisplayOptions,
  DataGridColumnLayout,
  DataGridColumnLayoutItem,
  DataGridColumnStats,
  DataGridColumnStatsSource,
  DataGridFooterProps,
  DataGridHeaderComponentProps,
  DataGridHeaderContext,
  DataGridProps,
  DataGridRowComponentProps,
  DataGridRowId,
  DataGridSort,
  DataGridSortDirection,
  DataGridTopBarProps,
  DataGridVisibleWindow,
} from './types';
import type { DataGridViewModel } from './view-model';

const FALSE_WATCHABLE = createGridStore(false);
const NULL_TOTAL = createGridStore<number | null>(null);
const EMPTY_STATS = createGridStore<
  Record<string, DataGridColumnStats | undefined>
>({});
const EMPTY_COLUMN_STATS = createGridStore<DataGridColumnStats | undefined>(
  undefined
);

const columnLabelFor = (
  columns: { id: string; header: React.ReactNode }[],
  columnId: string
): string => {
  const column = columns.find((candidate) => candidate.id === columnId);
  return typeof column?.header === 'string' ? column.header : columnId;
};

function DefaultTopBar<TRow>({
  columns,
  totalRows,
  totalLoadedRows,
  isLoading,
  hiddenColumns,
  setColumnVisible,
}: DataGridTopBarProps<TRow>) {
  // Counts what is on screen: hidden columns are reachable from the badges.
  const visibleColumnCount = columns.filter(
    (column) => column.visible !== false
  ).length;

  return (
    <div className="flex min-h-9 items-center gap-2 border-b border-(color:--dg-border) bg-(--dg-bg) px-3 py-2 text-[11px] uppercase tracking-wider text-(color:--dg-muted-fg)">
      <span className="shrink-0 tabular-nums">
        {totalRows !== null
          ? `${totalRows.toLocaleString()} rows`
          : `${totalLoadedRows.toLocaleString()} rows loaded`}{' '}
        · {visibleColumnCount.toLocaleString()} columns
      </span>
      {/* Sorting and filtering are shown on the columns themselves; the only
          state that has nowhere else to live is a hidden column. */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {hiddenColumns.map((column) => (
          <button
            key={`hidden-${column.id}`}
            type="button"
            aria-label={`Show ${
              typeof column.header === 'string' ? column.header : column.id
            } column`}
            className="flex shrink-0 items-center gap-1 rounded-full border border-(color:--dg-border) bg-(--dg-chip-bg) py-0.5 pl-2 pr-1.5 text-[11px] hover:bg-(--dg-muted) hover:text-(color:--dg-fg)"
            onClick={() => {
              setColumnVisible(column.id, true);
            }}
          >
            <Icon icon="eye-slash" size="small" className="opacity-60" />
            <span className="max-w-40 truncate">
              {typeof column.header === 'string' ? column.header : column.id}
            </span>
          </button>
        ))}
      </div>
      {isLoading ? (
        <span className="shrink-0 text-[11px] text-(color:--dg-muted-fg-soft)">
          Loading…
        </span>
      ) : null}
    </div>
  );
}

/** Shared chip for an active filter, clickable to clear it. */
export function DataGridFilterChip({
  label,
  value,
  onClear,
}: {
  label: string;
  value: unknown;
  onClear: () => void;
}) {
  const described = describeFilterValue(value);
  return (
    <button
      type="button"
      aria-label={`Clear ${label} filter`}
      className="flex shrink-0 items-center gap-1 rounded-full border border-(color:--dg-chip-accent-border) bg-(--dg-chip-accent-bg) px-2 py-0.5 text-[10px] uppercase tracking-wider text-(color:--dg-accent) transition-colors hover:bg-(--dg-chip-accent-hover-bg)"
      onClick={onClear}
    >
      <span className="max-w-48 truncate">
        {label}
        {described === '' ? '' : `: ${described}`}
      </span>
      <Icon icon="x-mark" size="small" className="opacity-70" />
    </button>
  );
}

/** One active sort, clickable to remove just that sort. */
export function DataGridSortChip({
  label,
  direction,
  onClear,
}: {
  label: string;
  direction: DataGridSortDirection;
  onClear: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Clear ${label} sort`}
      className="flex shrink-0 items-center gap-1 rounded-full border border-(color:--dg-border) bg-(--dg-chip-bg) px-2 py-0.5 text-[10px] uppercase tracking-wider text-(color:--dg-muted-fg) transition-colors hover:bg-(--dg-muted) hover:text-(color:--dg-fg)"
      onClick={onClear}
    >
      <span className="max-w-48 truncate">{label}</span>
      <span className="font-normal">{direction === 'asc' ? '↑' : '↓'}</span>
      <Icon icon="x-mark" size="small" className="opacity-60" />
    </button>
  );
}

export function DataGridSortChips({
  columns,
  sorts,
  clearSort,
}: {
  columns: { id: string; header: React.ReactNode }[];
  sorts: DataGridSort[];
  clearSort: (columnId: string) => void;
}) {
  if (sorts.length === 0) {
    return (
      <span className="shrink-0 text-(color:--dg-muted-fg-faint)">No sort</span>
    );
  }
  return (
    <>
      {sorts.map((sort) => (
        <DataGridSortChip
          key={`sort-${sort.columnId}`}
          label={columnLabelFor(columns, sort.columnId)}
          direction={sort.direction}
          onClear={() => {
            clearSort(sort.columnId);
          }}
        />
      ))}
    </>
  );
}

function DefaultFooter<TRow>({
  columns,
  sorts,
  filters,
  clearSort,
  clearFilter,
}: DataGridFooterProps<TRow>) {
  return (
    <div className="flex min-h-8 items-center gap-3 border-t border-(color:--dg-border) bg-(--dg-bg) px-3 py-2 text-[11px] uppercase tracking-wider text-(color:--dg-muted-fg)">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {filters.map((filter) => (
          <DataGridFilterChip
            key={`filter-${filter.columnId}`}
            label={columnLabelFor(columns, filter.columnId)}
            value={filter.value}
            onClear={() => {
              clearFilter(filter.columnId);
            }}
          />
        ))}
        <DataGridSortChips
          columns={columns}
          sorts={sorts}
          clearSort={clearSort}
        />
      </div>
    </div>
  );
}

/**
 * A row's stripe / selection wash. Deliberately translucent and deliberately
 * separate from the opaque base it sits on: the pinned groups repaint the same
 * tint over their own background so a pinned cell matches the row it belongs
 * to without inheriting its transparency.
 */
const rowTintClass = (rowIndex: number, selected: boolean): string =>
  selected
    ? 'bg-(--dg-row-selected-bg)'
    : rowIndex % 2 === 0
      ? ''
      : 'bg-(--dg-row-stripe-bg)';

function DefaultRow<TRow>({
  children,
  rowIndex,
  selected,
  style,
  onClick,
}: DataGridRowComponentProps<TRow>) {
  const tint = rowTintClass(rowIndex, selected);
  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 2}
      aria-selected={selected}
      className={cn(
        'absolute border-(color:--dg-border-faint)',
        tint === '' ? 'bg-(--dg-bg)' : tint
      )}
      style={style}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

const getColumnIdForIndex = <TRow,>(
  columns: DataGridColumnLayoutItem<TRow>[],
  columnIndex: number
): string | null => columns[columnIndex]?.column.id ?? null;

const isCellInRange = (
  address: DataGridCellAddress,
  range: DataGridCellRange
): boolean => {
  const minRow = Math.min(range.start.rowIndex, range.end.rowIndex);
  const maxRow = Math.max(range.start.rowIndex, range.end.rowIndex);
  const minColumn = Math.min(range.start.columnIndex, range.end.columnIndex);
  const maxColumn = Math.max(range.start.columnIndex, range.end.columnIndex);
  return (
    address.rowIndex >= minRow &&
    address.rowIndex <= maxRow &&
    address.columnIndex >= minColumn &&
    address.columnIndex <= maxColumn
  );
};

const isCellSelected = (
  address: DataGridCellAddress,
  ranges: DataGridCellRange[]
): boolean => ranges.some((range) => isCellInRange(address, range));

/**
 * Regular columns are absolutely positioned at their layout `x` so the
 * horizontal virtualizer can mount and unmount them freely. Pinned columns sit
 * in the normal flow of their `DataGridPinnedGroup`, which lays them out
 * contiguously and is itself the single sticky element for that side.
 */
const styleForColumn = <TRow,>({
  item,
  height,
}: {
  item: DataGridColumnLayoutItem<TRow>;
  height: number;
}): React.CSSProperties => {
  if (item.pinned !== null) {
    return {
      position: 'relative',
      width: item.width,
      height,
      flexShrink: 0,
    };
  }

  return {
    position: 'absolute',
    left: item.x,
    top: 0,
    width: item.width,
    height,
  };
};

/**
 * The sticky pane holding one side's pinned columns. Sticking the group rather
 * than each individual cell is what makes pinning opaque: cells and headers are
 * translucent by design (the stripe lives on the row, the header wash is
 * `--dg-header-bg`), so a stuck *cell* lets the regular columns scrolling beneath
 * it read straight through. The group supplies one opaque backdrop for the
 * whole band, plus the row's tint on top of it so the band still stripes.
 *
 * No `top` is set — a vertical sticky offset would let the band slide within
 * its row as the row scrolls under the header.
 */
function DataGridPinnedGroup({
  side,
  width,
  height,
  tintClass,
  children,
}: {
  side: 'left' | 'right';
  width: number;
  height: number;
  tintClass?: string;
  children: React.ReactNode;
}) {
  const style: React.CSSProperties = {
    position: 'sticky',
    // Load-bearing rather than cosmetic: pinned columns are in normal flow.
    display: 'flex',
    width,
    height,
    flexShrink: 0,
    zIndex: 20,
    ...(side === 'left'
      ? { left: 0 }
      : // Pushes the group to the end of the flow line, past the absolutely
        // positioned regular columns that contribute no width to it.
        { right: 0, marginLeft: 'auto' }),
  };

  return (
    <div className="bg-(--dg-bg)" style={style}>
      {tintClass !== undefined && tintClass !== '' ? (
        <div
          aria-hidden
          className={cn('pointer-events-none absolute inset-0', tintClass)}
        />
      ) : null}
      {children}
    </div>
  );
}

/**
 * Grid keyboard navigation binds Space, Enter, the arrows and Home/End, and
 * preventDefault()s them. Top bar / footer / cell editors live inside the grid
 * root, so their keystrokes bubble here — typing in one must not be treated as
 * navigation.
 */
const isTextEntryTarget = (target: EventTarget | null): boolean => {
  if (target === null || !(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
};

const minColumnIndex = <TRow,>(
  items: DataGridColumnLayoutItem<TRow>[]
): number =>
  items.reduce(
    (min, item) => Math.min(min, item.columnIndex),
    items[0]?.columnIndex ?? 0
  );

const maxColumnIndex = <TRow,>(
  items: DataGridColumnLayoutItem<TRow>[]
): number =>
  items.reduce(
    (max, item) => Math.max(max, item.columnIndex),
    items[0]?.columnIndex ?? 0
  );

type HeaderCellProps<TRow> = {
  item: DataGridColumnLayoutItem<TRow>;
  headerHeight: number;
  viewModel: DataGridViewModel<TRow>;
  sorts: DataGridSort[];
  sortIndex: number | null;
  filterValue: { columnId: string; value: unknown } | null;
  statsFromMap: DataGridColumnStats | null;
  statsSource: DataGridColumnStatsSource | undefined;
  statsExpanded: boolean;
  displayOptions: DataGridColumnDisplayOptions;
  onHeaderStatsVisible: ((columnId: string) => void) | undefined;
  renderActions:
    ((context: DataGridHeaderContext<TRow>) => React.ReactNode) | undefined;
  HeaderComponent: React.ComponentType<DataGridHeaderComponentProps<TRow>>;
};

/**
 * Wraps one rendered header so it can subscribe to its own stats watchable and
 * announce that it is on screen. Because only pinned + horizontally visible
 * columns are rendered, mounting here is exactly the "stats became visible"
 * signal the host needs.
 */
function HeaderCell<TRow>({
  item,
  headerHeight,
  viewModel,
  sorts,
  sortIndex,
  filterValue,
  statsFromMap,
  statsSource,
  statsExpanded,
  displayOptions,
  onHeaderStatsVisible,
  renderActions,
  HeaderComponent,
}: HeaderCellProps<TRow>) {
  const columnId = item.column.id;
  const statsWatchable = React.useMemo(
    () => statsSource?.get(columnId) ?? EMPTY_COLUMN_STATS,
    [columnId, statsSource]
  );
  const perColumnStats = useGridStore(statsWatchable);
  const stats =
    statsSource !== undefined ? (perColumnStats ?? null) : statsFromMap;

  const requestStatsLoad = React.useCallback(() => {
    if (viewModel.headersExpanded.snapshot()) {
      onHeaderStatsVisible?.(columnId);
    }
  }, [columnId, onHeaderStatsVisible, viewModel.headersExpanded]);

  React.useEffect(() => {
    if (statsExpanded) {
      requestStatsLoad();
    }
  }, [requestStatsLoad, statsExpanded]);

  const context: DataGridHeaderContext<TRow> = {
    column: item.column,
    columnIndex: item.columnIndex,
    sort: sortIndex === null ? null : (sorts[sortIndex] ?? null),
    sortIndex,
    sortCount: sorts.length,
    filter: filterValue,
    stats,
    statsExpanded,
    displayOptions,
    commands: {
      resize(width) {
        viewModel.resizeColumn(columnId, width);
      },
      reorderBefore(sourceColumnId) {
        viewModel.reorderColumn(sourceColumnId, columnId);
      },
      pin(side) {
        viewModel.pinColumn(columnId, side);
      },
      unpin() {
        viewModel.unpinColumn(columnId);
      },
      setSort(direction) {
        viewModel.setSort(columnId, direction);
      },
      toggleSort(direction) {
        viewModel.toggleSort(columnId, direction);
      },
      setFilter(value) {
        viewModel.setFilter(columnId, value);
      },
      clearFilter() {
        viewModel.clearFilter(columnId);
      },
      toggleStatFilter(value) {
        const next = toggleStructuredFilterValue(filterValue?.value, value);
        if (next === null) {
          viewModel.clearFilter(columnId);
        } else {
          viewModel.setFilter(columnId, next);
        }
      },
      requestStatsLoad,
      setDisplayOptions(options) {
        viewModel.setColumnDisplayOptions(columnId, options);
      },
      hide() {
        viewModel.setColumnVisible(columnId, false);
      },
    },
  };

  return (
    <HeaderComponent
      context={context}
      actions={renderActions?.(context)}
      style={styleForColumn({ item, height: headerHeight })}
    />
  );
}

type RowShellProps<TRow> = {
  row: TRow;
  rowId: DataGridRowId;
  rowIndex: number;
  selected: boolean;
  rowHeight: number;
  /** Absolute top within the scroll content, expansions above already counted. */
  rowTop: number;
  /** Null when the grid has no detail renderer, which hides the chevron. */
  expanded: boolean | null;
  onToggleExpand: (rowId: DataGridRowId) => void;
  contentWidth: number;
  rowNumberWidth: number;
  layout: DataGridColumnLayout<TRow>;
  leftPinnedColumns: DataGridColumnLayoutItem<TRow>[];
  regularColumns: DataGridColumnLayoutItem<TRow>[];
  rightPinnedColumns: DataGridColumnLayoutItem<TRow>[];
  contextForCell: (
    row: TRow,
    rowIndex: number,
    item: DataGridColumnLayoutItem<TRow>
  ) => DataGridCellContext<TRow>;
  onRowClick: (rowId: DataGridRowId, event: React.MouseEvent) => void;
  onCellClick: (
    context: DataGridCellContext<TRow>,
    event: React.MouseEvent
  ) => void;
  headerHeight: number;
  CellComponent: React.ComponentType<DataGridCellComponentProps<TRow>>;
  RowComponent: React.ComponentType<DataGridRowComponentProps<TRow>>;
};

/**
 * Memoized so a granular row patch (which preserves the identity of every
 * untouched row object) only re-renders the row that actually changed.
 */
const RowShellInner = <TRow,>({
  row,
  rowId,
  rowIndex,
  selected,
  rowHeight,
  rowTop,
  expanded,
  onToggleExpand,
  contentWidth,
  rowNumberWidth,
  layout,
  leftPinnedColumns,
  regularColumns,
  rightPinnedColumns,
  contextForCell,
  onRowClick,
  onCellClick,
  headerHeight,
  CellComponent,
  RowComponent,
}: RowShellProps<TRow>) => {
  const tint = rowTintClass(rowIndex, selected);
  const renderCell = (item: DataGridColumnLayoutItem<TRow>) => {
    const context = contextForCell(row, rowIndex, item);
    return (
      <CellComponent
        key={item.column.id}
        context={context}
        style={styleForColumn({ item, height: rowHeight })}
        onClick={(event) => {
          onCellClick(context, event);
        }}
      />
    );
  };

  return (
    <RowComponent
      row={row}
      rowId={rowId}
      rowIndex={rowIndex}
      selected={selected}
      style={{
        // Flex so the sticky pinned groups resolve their resting position from
        // a horizontal flow instead of stacking vertically.
        display: 'flex',
        top: headerHeight + rowTop,
        height: rowHeight,
        width: contentWidth,
      }}
      onClick={(event) => {
        onRowClick(rowId, event);
      }}
    >
      <DataGridPinnedGroup
        side="left"
        width={layout.leftPinnedWidth}
        height={rowHeight}
        tintClass={tint}
      >
        <button
          type="button"
          role="gridcell"
          aria-colindex={1}
          // `relative` so the gutter paints over the group's tint layer, which
          // keeps it reading as chrome rather than as part of the striped body.
          className="relative flex items-center justify-end border-b border-r border-(color:--dg-border-subtle) bg-(--dg-bg) px-2 text-xs tabular-nums text-(color:--dg-muted-fg)"
          style={{ width: rowNumberWidth, height: rowHeight, flexShrink: 0 }}
          onClick={(event) => {
            event.stopPropagation();
            onRowClick(rowId, event);
          }}
        >
          {expanded !== null ? (
            // Nested inside the gutter button rather than beside it, so adding
            // expansion does not change the gutter's width and shift every
            // column's `x`.
            <span
              role="button"
              tabIndex={0}
              aria-label={expanded ? 'Collapse row' : 'Expand row'}
              aria-expanded={expanded}
              className={DATA_GRID_GUTTER_CHEVRON_CLASS}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand(rowId);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                onToggleExpand(rowId);
              }}
            >
              <Icon
                icon={expanded ? 'chevron-down' : 'chevron-right'}
                size="small"
              />
            </span>
          ) : null}
          {rowIndex + 1}
        </button>
        {leftPinnedColumns.map(renderCell)}
      </DataGridPinnedGroup>
      {regularColumns.map(renderCell)}
      {rightPinnedColumns.length > 0 ? (
        <DataGridPinnedGroup
          side="right"
          width={layout.rightPinnedWidth}
          height={rowHeight}
          tintClass={tint}
        >
          {rightPinnedColumns.map(renderCell)}
        </DataGridPinnedGroup>
      ) : null}
    </RowComponent>
  );
};

const RowShell = React.memo(RowShellInner) as typeof RowShellInner;

export function DataGrid<TRow>({
  rows: rowsWatchableProp,
  rowSource,
  getRowId,
  viewModel,
  className,
  hasMore: hasMoreProp,
  isLoadingMore: isLoadingMoreProp = false,
  columnStats: columnStatsProp,
  columnStatsSource,
  onLoadMore,
  onVisibleWindowChange,
  onSortChange,
  onFilterChange,
  onHeaderStatsVisible,
  renderColumnHeaderActions,
  onCellEdit,
  onSaveEdits,
  onRevertEdits,
  autoSaveEdits = false,
  onSelectCell,
  onCellSelectionChange,
  onRowSelectionChange,
  renderRowDetail,
  CellComponent,
  HeaderComponent,
  RowComponent,
  TopBarComponent,
  FooterComponent,
}: DataGridProps<TRow>) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const topBarRef = React.useRef<HTMLDivElement | null>(null);
  const footerRef = React.useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = React.useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = React.useState({
    width: 800,
    height: 520,
  });
  const [chromeHeight, setChromeHeight] = React.useState({
    top: 37,
    bottom: 0,
  });
  const [loadMoreInFlight, setLoadMoreInFlight] = React.useState(false);
  const overlay = useDataGridOverlay();
  const fallbackRows: ReadonlyGridStore<TRow[]> = React.useMemo(
    () => createGridStore<TRow[]>([]),
    []
  );

  /*
   * `rows` and `columnStats` each accept a plain value or a store, so a caller
   * with an array in hand never meets the concept of a store. The subscription
   * still happens unconditionally — hooks cannot be conditional, and
   * subscribing to the fallback store costs nothing — with the plain value
   * taking precedence over what came back.
   */
  const rowsWatchable: ReadonlyGridStore<TRow[]> = isGridStore<TRow[]>(
    rowsWatchableProp
  )
    ? rowsWatchableProp
    : (rowSource?.rows ?? fallbackRows);
  const subscribedRows = useGridStore(rowsWatchable);
  const rows = Array.isArray(rowsWatchableProp)
    ? rowsWatchableProp
    : subscribedRows;
  const columns = useGridStore(viewModel.columns);
  const focusedCell = useGridStore(viewModel.focusedCell);
  const selectedRowIds = useGridStore(viewModel.selectedRowIds);
  const selectedCellRanges = useGridStore(viewModel.selectedCellRanges);
  const sorts = useGridStore(viewModel.sorts);
  const filters = useGridStore(viewModel.filters);
  const rowHeight = useGridStore(viewModel.rowHeight);
  const expansionHeightValue = useGridStore(viewModel.expansionHeight);
  const expandedRowIds = useGridStore(viewModel.expandedRowIds);
  const headerHeight = useGridStore(viewModel.headerHeight);
  const headersExpanded = useGridStore(viewModel.headersExpanded);
  const editingCell = useGridStore(viewModel.editingCell);
  const pendingEdits = useGridStore(viewModel.pendingEdits);
  const displayOptionsByColumn = useGridStore(viewModel.columnDisplayOptions);
  const scrollX = useGridStore(viewModel.scrollX);
  const scrollY = useGridStore(viewModel.scrollY);
  const subscribedColumnStats = useGridStore(
    isGridStore<Record<string, DataGridColumnStats | undefined>>(
      columnStatsProp
    )
      ? columnStatsProp
      : EMPTY_STATS
  );
  const columnStats =
    columnStatsProp !== undefined && !isGridStore(columnStatsProp)
      ? columnStatsProp
      : subscribedColumnStats;
  const rowSourceHasMoreWatchable = React.useMemo(
    () => rowSource?.hasMore ?? FALSE_WATCHABLE,
    [rowSource]
  );
  const rowSourceLoadingWatchable = React.useMemo(
    () => rowSource?.isLoading ?? FALSE_WATCHABLE,
    [rowSource]
  );
  const rowSourceTotalRowsWatchable = React.useMemo(
    () => rowSource?.totalRows ?? NULL_TOTAL,
    [rowSource]
  );
  const totalRows = useGridStore(rowSourceTotalRowsWatchable);
  const rowSourceHasMore = useGridStore(rowSourceHasMoreWatchable);
  const rowSourceLoading = useGridStore(rowSourceLoadingWatchable);
  const hasMore =
    rowSource !== undefined ? rowSourceHasMore : hasMoreProp === true;
  const isLoadingMore =
    rowSource !== undefined ? rowSourceLoading : isLoadingMoreProp;
  const totalLoadedRows = rows.length;
  const layout = React.useMemo(
    () => getDataGridColumnLayout(columns),
    [columns]
  );
  const ResolvedCellComponent = CellComponent ?? BaseCell<TRow>;
  const ResolvedHeaderComponent = HeaderComponent ?? DataGridHeader<TRow>;
  const ResolvedRowComponent = RowComponent ?? DefaultRow<TRow>;
  const ResolvedTopBarComponent = TopBarComponent ?? DefaultTopBar<TRow>;
  const ResolvedFooterComponent = FooterComponent ?? DefaultFooter<TRow>;
  const bodyHeight = Math.max(
    0,
    containerSize.height - chromeHeight.top - chromeHeight.bottom
  );
  const regularViewportWidth = Math.max(
    0,
    containerSize.width - layout.leftPinnedWidth - layout.rightPinnedWidth
  );
  // Expansion is off unless a detail renderer and a height are both supplied,
  // which keeps the geometry identical to before for every existing grid.
  const expansionHeight =
    renderRowDetail === undefined ? 0 : expansionHeightValue;
  const expandedIndices = React.useMemo(() => {
    if (expansionHeight <= 0 || expandedRowIds.size === 0) {
      return [];
    }
    const indices: number[] = [];
    rows.forEach((row, index) => {
      if (expandedRowIds.has(getRowId(row))) {
        indices.push(index);
      }
    });
    return indices;
  }, [expandedRowIds, expansionHeight, getRowId, rows]);
  const rowOffsets = React.useMemo(
    () =>
      createRowOffsetIndex({
        rowCount: rows.length,
        rowHeight,
        expandedIndices,
        expansionHeight,
      }),
    [expandedIndices, expansionHeight, rowHeight, rows.length]
  );
  const virtualizedRows = React.useMemo(
    () =>
      getVirtualizedRangeWithOffsets({
        itemCount: rows.length,
        offsets: rowOffsets,
        containerSize: bodyHeight - headerHeight,
        scrollOffset: scrollY,
      }),
    [bodyHeight, headerHeight, rowOffsets, rows.length, scrollY]
  );
  const virtualizedRegularColumns = React.useMemo(
    () =>
      getVirtualizedColumns({
        columns: layout.regular,
        containerSize: regularViewportWidth,
        scrollOffset: scrollX,
      }),
    [layout.regular, regularViewportWidth, scrollX]
  );
  const visibleRegularColumns = React.useMemo(
    () =>
      layout.regular.slice(
        virtualizedRegularColumns.startIndex,
        virtualizedRegularColumns.endIndex + 1
      ),
    [
      layout.regular,
      virtualizedRegularColumns.endIndex,
      virtualizedRegularColumns.startIndex,
    ]
  );
  const renderedColumns = React.useMemo(
    () => [
      ...layout.leftPinned,
      ...visibleRegularColumns,
      ...layout.rightPinned,
    ],
    [layout.leftPinned, layout.rightPinned, visibleRegularColumns]
  );

  const displayOptionsFor = React.useCallback(
    (columnId: string): DataGridColumnDisplayOptions =>
      displayOptionsByColumn[columnId] ?? DEFAULT_DATA_GRID_DISPLAY_OPTIONS,
    [displayOptionsByColumn]
  );

  React.useEffect(() => {
    viewModel.setTotalLoadedRows(rows.length);
    if (rowSource !== undefined) {
      viewModel.setTotalRows(totalRows);
    }
  }, [rowSource, rows.length, totalRows, viewModel]);

  React.useEffect(() => {
    const element = containerRef.current;
    if (element === null) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  React.useEffect(() => {
    const top = topBarRef.current;
    const bottom = footerRef.current;
    const measure = () => {
      setChromeHeight({
        top: top?.offsetHeight ?? 0,
        bottom: bottom?.offsetHeight ?? 0,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (top !== null) {
      observer.observe(top);
    }
    if (bottom !== null) {
      observer.observe(bottom);
    }
    return () => {
      observer.disconnect();
    };
  }, []);

  const visibleWindow = React.useMemo<DataGridVisibleWindow>(() => {
    const columnsForWindow =
      renderedColumns.length > 0 ? renderedColumns : layout.visibleColumns;
    return {
      startRowIndex: virtualizedRows.startIndex,
      endRowIndex: virtualizedRows.endIndex,
      startColumnIndex: minColumnIndex(columnsForWindow),
      endColumnIndex: maxColumnIndex(columnsForWindow),
    };
  }, [
    layout.visibleColumns,
    renderedColumns,
    virtualizedRows.endIndex,
    virtualizedRows.startIndex,
  ]);

  React.useEffect(() => {
    void rowSource?.loadWindow?.(visibleWindow);
    onVisibleWindowChange?.(visibleWindow);
  }, [onVisibleWindowChange, rowSource, visibleWindow]);

  const loadMoreRows = React.useCallback(() => {
    if (!hasMore || isLoadingMore || loadMoreInFlight) {
      return;
    }
    const loadMore = rowSource?.loadMore ?? onLoadMore;
    if (loadMore === undefined) {
      return;
    }
    setLoadMoreInFlight(true);
    void Promise.resolve(loadMore()).finally(() => {
      setLoadMoreInFlight(false);
    });
  }, [hasMore, isLoadingMore, loadMoreInFlight, onLoadMore, rowSource]);

  React.useEffect(() => {
    if (rows.length === 0 || virtualizedRows.endIndex >= rows.length - 10) {
      loadMoreRows();
    }
  }, [loadMoreRows, rows.length, virtualizedRows.endIndex]);

  React.useEffect(() => {
    const root = scrollRef.current;
    const target = loadMoreSentinelRef.current;
    if (root === null || target === null || !hasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting === true) {
          loadMoreRows();
        }
      },
      { root, rootMargin: '240px 0px', threshold: 0 }
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [hasMore, loadMoreRows, rows.length]);

  React.useEffect(() => {
    onSortChange?.(sorts);
  }, [onSortChange, sorts]);

  React.useEffect(() => {
    onFilterChange?.(filters);
  }, [filters, onFilterChange]);

  React.useEffect(() => {
    onCellSelectionChange?.(selectedCellRanges);
  }, [onCellSelectionChange, selectedCellRanges]);

  React.useEffect(() => {
    onRowSelectionChange?.(selectedRowIds);
  }, [onRowSelectionChange, selectedRowIds]);

  const scrollToCell = React.useCallback(
    (rowIndex: number, columnIndex: number) => {
      const scrollElement = scrollRef.current;
      const column = layout.visibleColumns[columnIndex];
      if (scrollElement === null || column === undefined) {
        return;
      }

      // Only the row itself needs to come into view, not its detail panel —
      // scrolling a tall panel fully into frame would push the row off the top.
      const rowTop = headerHeight + rowOffsets.offsetForIndex(rowIndex);
      const rowBottom = rowTop + rowHeight;
      if (rowTop < scrollElement.scrollTop + headerHeight) {
        scrollElement.scrollTop = Math.max(0, rowTop - headerHeight);
      } else if (
        rowBottom >
        scrollElement.scrollTop + scrollElement.clientHeight
      ) {
        scrollElement.scrollTop = rowBottom - scrollElement.clientHeight;
      }

      if (column.pinned === null) {
        const leftEdge = column.x - layout.leftPinnedWidth;
        const rightEdge = leftEdge + column.width;
        if (leftEdge < scrollElement.scrollLeft) {
          scrollElement.scrollLeft = Math.max(0, leftEdge - 16);
        } else if (
          rightEdge >
          scrollElement.scrollLeft + regularViewportWidth
        ) {
          scrollElement.scrollLeft = rightEdge - regularViewportWidth + 16;
        }
      }
    },
    [
      headerHeight,
      layout.leftPinnedWidth,
      layout.visibleColumns,
      regularViewportWidth,
      rowHeight,
      rowOffsets,
    ]
  );

  // Stable so the memoized RowShell is not invalidated for every row on each
  // render, which would defeat the granular-patch optimisation.
  const handleToggleExpand = React.useCallback(
    (rowId: DataGridRowId) => {
      viewModel.toggleRowExpanded(rowId);
    },
    [viewModel]
  );

  const focusCell = React.useCallback(
    (rowIndex: number, columnIndex: number) => {
      const columnId = getColumnIdForIndex(layout.visibleColumns, columnIndex);
      if (columnId === null) {
        return;
      }
      const address = getAddressForCell({
        rows,
        getRowId,
        rowIndex,
        columnId,
        columnIndex,
      });
      if (address !== null) {
        viewModel.focusCell(address);
        scrollToCell(rowIndex, columnIndex);
      }
    },
    [getRowId, layout.visibleColumns, rows, scrollToCell, viewModel]
  );

  const contextForCell = React.useCallback(
    (row: TRow, rowIndex: number, item: DataGridColumnLayoutItem<TRow>) => {
      const rowId = getRowId(row);
      const value = item.column.getValue(row);
      const address = {
        rowId,
        rowIndex,
        columnId: item.column.id,
        columnIndex: item.columnIndex,
      };
      const anchorRef: React.MutableRefObject<HTMLElement | null> = {
        current: null,
      };
      const cellSelected = isCellSelected(address, selectedCellRanges);
      const rowSelected = selectedRowIds.has(rowId);
      const editable =
        item.column.computed !== true && item.column.editable === true;
      const context: DataGridCellContext<TRow> = {
        row,
        value,
        column: item.column,
        address,
        displayOptions: displayOptionsFor(item.column.id),
        state: {
          focused:
            focusedCell?.rowId === rowId &&
            focusedCell.columnId === item.column.id,
          selected: rowSelected || cellSelected,
          rowSelected,
          cellSelected,
          hovered: false,
          visible:
            rowIndex >= virtualizedRows.startIndex &&
            rowIndex <= virtualizedRows.endIndex,
          editable,
          editing:
            editingCell?.rowId === rowId &&
            editingCell.columnId === item.column.id,
          dirty:
            pendingEdits[dataGridEditKey(rowId, item.column.id)] !== undefined,
        },
        anchorRef,
        commands: {
          focus() {
            viewModel.focusCell(address);
          },
          select() {
            viewModel.selectCell(address);
          },
          toggleSelect() {
            viewModel.toggleCell(address);
          },
          selectRange() {
            const anchor = viewModel.cellSelectionAnchor.snapshot() ?? address;
            viewModel.selectCellRange(anchor, address);
          },
          openOverlay(content) {
            if (anchorRef.current !== null) {
              overlay.openOverlay(anchorRef.current, content);
            }
          },
          closeOverlay() {
            overlay.closeOverlay();
          },
          openDetail() {
            const detail = item.column.renderDetail?.(context);
            if (detail !== undefined && anchorRef.current !== null) {
              overlay.openOverlay(anchorRef.current, detail);
            }
          },
          beginEdit() {
            if (editable) {
              viewModel.beginEdit(address);
            }
          },
          commitEdit(nextValue) {
            const edit = viewModel.commitEdit(address, nextValue, value);
            onCellEdit?.(
              edit ?? {
                rowId,
                columnId: item.column.id,
                previousValue: value,
                value: nextValue,
              }
            );
            if (autoSaveEdits) {
              // Persist as we go instead of batching behind a banner. A null
              // edit round-tripped back to its original and has nothing to
              // save; clear either way so the cell never lingers as dirty. The
              // save handler owns reporting its own failure, so swallow the
              // rejection rather than letting it escape unhandled.
              if (edit !== null) {
                void Promise.resolve(onSaveEdits?.([edit])).catch(
                  () => undefined
                );
              }
              viewModel.clearEdits();
            }
          },
          cancelEdit() {
            viewModel.cancelEdit();
          },
        },
      };
      return context;
    },
    [
      autoSaveEdits,
      displayOptionsFor,
      editingCell,
      focusedCell,
      getRowId,
      onCellEdit,
      onSaveEdits,
      overlay,
      pendingEdits,
      selectedCellRanges,
      selectedRowIds,
      viewModel,
      virtualizedRows.endIndex,
      virtualizedRows.startIndex,
    ]
  );

  const selectCell = React.useCallback(() => {
    const currentFocusedCell = viewModel.focusedCell.snapshot();
    if (currentFocusedCell === null) {
      focusCell(0, 0);
      return;
    }
    const row = rows[currentFocusedCell.rowIndex];
    const column = layout.visibleColumns[currentFocusedCell.columnIndex];
    if (row === undefined || column === undefined) {
      return;
    }
    onSelectCell?.(contextForCell(row, currentFocusedCell.rowIndex, column));
  }, [
    contextForCell,
    focusCell,
    layout.visibleColumns,
    onSelectCell,
    rows,
    viewModel.focusedCell,
  ]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (isTextEntryTarget(event.target)) {
      return;
    }
    const currentFocusedCell = viewModel.focusedCell.snapshot();
    const action = getKeyboardAction({
      key: event.key,
      focusedCell: currentFocusedCell,
      rowCount: rows.length,
      columnCount: layout.visibleColumns.length,
      // How many rows are actually on screen right now, which is what a page
      // should move. Expansions make that fewer than the viewport would
      // suggest; with none open this is the old uniform division.
      pageSize: Math.max(
        1,
        rowOffsets.indexForOffset(scrollY + bodyHeight - headerHeight) -
          rowOffsets.indexForOffset(scrollY)
      ),
    });
    if (action.type === 'none') {
      return;
    }
    event.preventDefault();

    if (action.type === 'focus') {
      const columnId = getColumnIdForIndex(
        layout.visibleColumns,
        action.columnIndex
      );
      const address =
        columnId === null
          ? null
          : getAddressForCell({
              rows,
              getRowId,
              rowIndex: action.rowIndex,
              columnId,
              columnIndex: action.columnIndex,
            });
      if (address !== null) {
        if (event.shiftKey) {
          const anchor =
            viewModel.cellSelectionAnchor.snapshot() ??
            currentFocusedCell ??
            address;
          viewModel.selectCellRange(anchor, address);
        } else {
          viewModel.focusCell(address);
        }
        scrollToCell(action.rowIndex, action.columnIndex);
      }
      return;
    }
    if (action.type === 'select-focused-row') {
      if (currentFocusedCell !== null) {
        viewModel.toggleRowSelection(currentFocusedCell.rowId);
      }
      return;
    }
    selectCell();
  };

  const handleCellClick = React.useCallback(
    (context: DataGridCellContext<TRow>, event: React.MouseEvent) => {
      event.stopPropagation();
      if (event.shiftKey) {
        context.commands.selectRange();
      } else if (event.metaKey || event.ctrlKey) {
        context.commands.toggleSelect();
      } else {
        context.commands.select();
      }
    },
    []
  );

  const handleRowClick = React.useCallback(
    (rowId: DataGridRowId, event: React.MouseEvent) => {
      if (event.shiftKey && viewModel.selectionAnchor.snapshot() !== null) {
        const selectionAnchor = viewModel.selectionAnchor.snapshot();
        if (selectionAnchor !== null) {
          viewModel.selectRowRange(
            selectionAnchor,
            rowId,
            rowsWatchable.snapshot(),
            getRowId
          );
        }
      } else if (event.metaKey || event.ctrlKey) {
        viewModel.toggleRowSelection(rowId);
      } else {
        viewModel.selectOnly(rowId);
      }
    },
    [getRowId, rowsWatchable, viewModel]
  );

  const setStatsExpanded = React.useCallback(
    (expanded: boolean) => {
      viewModel.headersExpanded.set(expanded);
    },
    [viewModel.headersExpanded]
  );
  const clearSort = React.useCallback(
    (columnId: string) => {
      viewModel.setSort(columnId, null);
    },
    [viewModel]
  );
  const clearFilter = React.useCallback(
    (columnId: string) => {
      viewModel.clearFilter(columnId);
    },
    [viewModel]
  );
  const clearFilters = React.useCallback(() => {
    viewModel.clearFilters();
  }, [viewModel]);
  const setColumnVisible = React.useCallback(
    (columnId: string, visible: boolean) => {
      viewModel.setColumnVisible(columnId, visible);
    },
    [viewModel]
  );
  const hiddenColumns = React.useMemo(
    () => columns.filter((column) => column.visible === false),
    [columns]
  );
  const pendingEditList = React.useMemo(
    () =>
      Object.values(pendingEdits).filter(
        (edit): edit is DataGridCellEdit => edit !== undefined
      ),
    [pendingEdits]
  );
  const [editsSaving, setEditsSaving] = React.useState(false);

  const settleEdits = React.useCallback(
    (
      handler: ((edits: DataGridCellEdit[]) => void | Promise<void>) | undefined
    ) =>
      () => {
        const edits = pendingEditList;
        if (edits.length === 0 || handler === undefined) {
          viewModel.clearEdits();
          return;
        }
        setEditsSaving(true);
        // Pending state survives a failure so the user can retry. The handler
        // owns reporting the failure, so swallow it here rather than letting it
        // escape as an unhandled rejection.
        void Promise.resolve(handler(edits))
          .then(() => {
            viewModel.clearEdits();
          })
          .catch(() => undefined)
          .finally(() => {
            setEditsSaving(false);
          });
      },
    [pendingEditList, viewModel]
  );

  const contentWidth = Math.max(layout.totalWidth, containerSize.width);
  const contentHeight = Math.max(
    bodyHeight,
    headerHeight + virtualizedRows.totalHeight + (hasMore ? rowHeight : 0)
  );
  // Refreshing (sort/filter/query) rather than paginating: keep the current
  // rows and headers mounted and show progress instead of a skeleton.
  const isRefreshingRows = isLoadingMore && rows.length > 0;

  const renderHeaderCell = (item: DataGridColumnLayoutItem<TRow>) => {
    const sortIndex = sorts.findIndex(
      (candidate) => candidate.columnId === item.column.id
    );
    return (
      <HeaderCell
        key={item.column.id}
        item={item}
        headerHeight={headerHeight}
        viewModel={viewModel}
        sorts={sorts}
        sortIndex={sortIndex === -1 ? null : sortIndex}
        filterValue={
          filters.find((candidate) => candidate.columnId === item.column.id) ??
          null
        }
        statsFromMap={columnStats[item.column.id] ?? null}
        statsSource={columnStatsSource}
        statsExpanded={headersExpanded}
        displayOptions={displayOptionsFor(item.column.id)}
        onHeaderStatsVisible={onHeaderStatsVisible}
        renderActions={renderColumnHeaderActions}
        HeaderComponent={ResolvedHeaderComponent}
      />
    );
  };

  return (
    <div
      ref={containerRef}
      role="grid"
      tabIndex={0}
      aria-rowcount={totalRows ?? rows.length}
      aria-colcount={layout.ariaColumnCount}
      aria-activedescendant={
        focusedCell !== null
          ? `dg-cell-${focusedCell.rowIndex}-${focusedCell.columnIndex}`
          : undefined
      }
      className={cn(
        // The token scope, on the grid's own root rather than left to the
        // consumer. `--dg-*` and the scoped reset both hang off this class, so
        // a grid without it renders with every colour unresolved and every
        // button in native chrome. Nesting it inside a consumer's own
        // `.cotera-data-grid` — to theme a wider region — is harmless.
        DATA_GRID_THEME_CLASS,
        // Sizes entirely from its container: `h-full` fills a block parent,
        // `min-h-0` stops flex's `min-height: auto` from holding the grid open
        // at its content height. Everything below is measured off the
        // ResizeObserver, so there is no size baked in anywhere.
        //
        // No border of its own: the grid fills whatever hosts it, and that host
        // draws the edge — an edge here would only double the host's.
        'flex h-full min-h-0 w-full flex-col overflow-hidden rounded-md bg-(--dg-bg) outline-none focus:ring-2 focus:ring-(color:--dg-focus-ring-soft)',
        className
      )}
      // Geometry stays in TypeScript because the virtualizer does arithmetic on
      // it — CSS cannot be the source of truth for a number that decides which
      // rows exist. Mirrored onto the root so a theme's own decorations can line
      // up with the rows without hard-coding the same numbers a second time.
      // `styles/grid.css` declares the defaults; these are the resolved values.
      style={
        {
          '--dg-row-height': `${rowHeight}px`,
          '--dg-header-height': `${headerHeight}px`,
          '--dg-row-number-width': `${layout.rowNumber.width}px`,
          '--dg-column-width': `${DATA_GRID_DEFAULT_COLUMN_WIDTH}px`,
        } as React.CSSProperties
      }
      onKeyDown={handleKeyDown}
    >
      <div ref={topBarRef} className="shrink-0">
        <ResolvedTopBarComponent
          rows={rows}
          columns={columns}
          selectedRowIds={selectedRowIds}
          selectedCellRanges={selectedCellRanges}
          totalRows={totalRows}
          totalLoadedRows={totalLoadedRows}
          sorts={sorts}
          filters={filters}
          isLoading={isLoadingMore}
          statsExpanded={headersExpanded}
          setStatsExpanded={setStatsExpanded}
          clearSort={clearSort}
          clearFilter={clearFilter}
          hiddenColumns={hiddenColumns}
          setColumnVisible={setColumnVisible}
        />
      </div>
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-auto"
        onScroll={(event) => {
          viewModel.scrollX.set(event.currentTarget.scrollLeft);
          viewModel.scrollY.set(event.currentTarget.scrollTop);
        }}
      >
        {isRefreshingRows ? (
          <div
            role="status"
            aria-label="Refreshing rows"
            className="pointer-events-none sticky left-0 top-0 z-40 h-0.5 w-full overflow-hidden bg-(--dg-loading-track)"
          >
            <div className="h-full w-1/3 animate-pulse rounded-full bg-(--dg-loading-bar)" />
          </div>
        ) : null}
        <div
          style={{
            width: contentWidth,
            height: contentHeight,
            position: 'relative',
          }}
        >
          <div
            className="sticky top-0 z-30 bg-(--dg-bg)"
            style={{
              // Load-bearing rather than cosmetic: see `styleForColumn`.
              display: 'flex',
              width: contentWidth,
              height: headerHeight,
            }}
          >
            <DataGridPinnedGroup
              side="left"
              width={layout.leftPinnedWidth}
              height={headerHeight}
            >
              <RowNumberHeader
                column={layout.rowNumber}
                headerHeight={headerHeight}
                statsExpanded={headersExpanded}
                onToggleStats={() => {
                  setStatsExpanded(!headersExpanded);
                }}
              />
              {layout.leftPinned.map(renderHeaderCell)}
            </DataGridPinnedGroup>
            {visibleRegularColumns.map(renderHeaderCell)}
            {layout.rightPinned.length > 0 ? (
              <DataGridPinnedGroup
                side="right"
                width={layout.rightPinnedWidth}
                height={headerHeight}
              >
                {layout.rightPinned.map(renderHeaderCell)}
              </DataGridPinnedGroup>
            ) : null}
          </div>
          {rows
            .slice(virtualizedRows.startIndex, virtualizedRows.endIndex + 1)
            .map((row, offset) => {
              const rowIndex = virtualizedRows.startIndex + offset;
              const rowId = getRowId(row);
              const rowTop = rowOffsets.offsetForIndex(rowIndex);
              const expanded = rowOffsets.isExpanded(rowIndex);
              return (
                <React.Fragment key={rowId}>
                  <RowShell
                    row={row}
                    rowId={rowId}
                    rowIndex={rowIndex}
                    selected={selectedRowIds.has(rowId)}
                    rowHeight={rowHeight}
                    rowTop={rowTop}
                    expanded={renderRowDetail === undefined ? null : expanded}
                    onToggleExpand={handleToggleExpand}
                    headerHeight={headerHeight}
                    contentWidth={contentWidth}
                    rowNumberWidth={layout.rowNumber.width}
                    layout={layout}
                    leftPinnedColumns={layout.leftPinned}
                    regularColumns={visibleRegularColumns}
                    rightPinnedColumns={layout.rightPinned}
                    contextForCell={contextForCell}
                    onRowClick={handleRowClick}
                    onCellClick={handleCellClick}
                    CellComponent={ResolvedCellComponent}
                    RowComponent={ResolvedRowComponent}
                  />
                  {expanded && renderRowDetail !== undefined ? (
                    <div
                      // Deliberately not `overflow-hidden`: an ancestor with a
                      // clipping overflow becomes the sticky child's
                      // scrollport, so the panel would stick to a box that is
                      // itself scrolling and slide away with the columns.
                      // Clipping belongs on the sticky element instead.
                      className="absolute left-0 border-b border-(color:--dg-border-subtle) bg-(--dg-spacer-row-bg)"
                      style={{
                        top: headerHeight + rowTop + rowHeight,
                        height: expansionHeight,
                        width: contentWidth,
                      }}
                    >
                      {/* Sticky so the panel stays put under horizontal
                          scroll — its content is row-scoped, not
                          column-aligned, so scrolling it sideways with the
                          cells would only ever hide it. */}
                      <div
                        className="sticky left-0 h-full overflow-hidden"
                        style={{ width: containerSize.width }}
                      >
                        {renderRowDetail({
                          row,
                          rowId,
                          rowIndex,
                          collapse: () => {
                            viewModel.toggleRowExpanded(rowId);
                          },
                        })}
                      </div>
                    </div>
                  ) : null}
                </React.Fragment>
              );
            })}
          {hasMore ? (
            <div
              ref={loadMoreSentinelRef}
              className="absolute left-0 flex items-center justify-center text-sm text-(color:--dg-muted-fg)"
              style={{
                top: headerHeight + rowOffsets.totalHeight,
                height: rowHeight,
                width: contentWidth,
              }}
            >
              {isLoadingMore || loadMoreInFlight
                ? 'Loading more rows…'
                : 'Scroll for more rows'}
            </div>
          ) : null}
        </div>
      </div>
      <div ref={footerRef} className="shrink-0">
        {!autoSaveEdits && pendingEditList.length > 0 ? (
          <div
            role="status"
            className="flex items-center justify-between gap-3 border-t border-(color:--dg-border) bg-(--dg-edit-bar-bg) px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              {/* Echoes the corner notch drawn on each edited cell. */}
              <span
                aria-hidden
                className="h-0 w-0 shrink-0 border-r-[7px] border-t-[7px] border-r-transparent border-t-(color:--dg-accent)"
              />
              <span className="truncate text-[11px] font-medium uppercase tracking-wider text-(color:--dg-accent)">
                {pendingEditList.length.toLocaleString()} unsaved edit
                {pendingEditList.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={editsSaving}
                className="rounded-md border border-(color:--dg-border) bg-(--dg-bg) px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-(color:--dg-accent) transition-colors hover:bg-(--dg-muted) disabled:opacity-50"
                onClick={settleEdits(onRevertEdits)}
              >
                Revert
              </button>
              <button
                type="button"
                disabled={editsSaving}
                className="rounded-md bg-(--dg-accent) px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-(color:--dg-accent-fg) transition-colors hover:bg-(--dg-accent-active) disabled:opacity-50"
                onClick={settleEdits(onSaveEdits)}
              >
                {editsSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        ) : null}
        <ResolvedFooterComponent
          rows={rows}
          columns={columns}
          totalRows={totalRows}
          totalLoadedRows={totalLoadedRows}
          sorts={sorts}
          filters={filters}
          selectedRowIds={selectedRowIds}
          selectedCellRanges={selectedCellRanges}
          isLoading={isLoadingMore}
          clearSort={clearSort}
          clearFilter={clearFilter}
          clearFilters={clearFilters}
        />
      </div>
      <DataGridOverlay
        overlay={overlay.overlay}
        onClose={overlay.closeOverlay}
      />
    </div>
  );
}
