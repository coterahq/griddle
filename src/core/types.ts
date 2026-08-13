import type React from 'react';
import type { ReadonlyGridStore } from '../store';
import type { DataGridViewModel } from './view-model';

export type DataGridRowId = string | number;

export type DataGridPinnedSide = 'left' | 'right';

export type DataGridSortDirection = 'asc' | 'desc';

export type DataGridSort = {
  columnId: string;
  direction: DataGridSortDirection;
};

/**
 * Scalar values a structured filter can carry. Kept deliberately narrow so
 * warehouse adapters can translate them into literals without guessing.
 */
export type DataGridFilterScalar = string | number | boolean | null;

export type DataGridStructuredFilterValue =
  | { kind: 'in'; values: DataGridFilterScalar[] }
  | {
      kind: 'between';
      min: number | string;
      max: number | string;
      inclusiveMax?: boolean;
    };

/**
 * Comparisons the header's filter form can build. `isNull` / `isNotNull`
 * ignore the operand; the rest read it as the column's own type.
 */
export type DataGridFilterComparison =
  | 'contains'
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'isNull'
  | 'isNotNull';

export type DataGridComparisonFilterValue = {
  kind: 'compare';
  comparison: DataGridFilterComparison;
  value: DataGridFilterScalar;
};

/**
 * Everything a filter's `value` can be. Bare scalars predate the structured
 * forms and still mean "substring match", so old callers keep working.
 */
export type DataGridFilterValue =
  | DataGridStructuredFilterValue
  | DataGridComparisonFilterValue
  | DataGridFilterScalar;

export type DataGridFilter = {
  columnId: string;
  value: unknown;
};

export type DataGridCellAddress = {
  rowId: DataGridRowId;
  rowIndex: number;
  columnId: string;
  columnIndex: number;
};

export type DataGridCellRange = {
  start: DataGridCellAddress;
  end: DataGridCellAddress;
};

/**
 * Logical column types the grid knows how to decorate with an icon and a
 * default stats presentation. Callers may map their own domain types onto
 * these without adopting the grid's vocabulary wholesale.
 */
export type DataGridColumnDataType =
  'text' | 'number' | 'boolean' | 'date' | 'timestamp' | 'category' | 'unknown';

export type DataGridNumberFormat = 'number' | 'percent' | 'compact';

export type DataGridColumnAlignment = 'left' | 'center' | 'right';

export type DataGridColumnDisplayOptions = {
  numberFormat: DataGridNumberFormat;
  /** null keeps the raw value's own precision. */
  decimals: number | null;
  alignment: DataGridColumnAlignment;
  inCellBar: boolean;
  /**
   * Upper bound for in-cell bars. Percent-formatted columns default to 1;
   * other columns need this set (typically from the column's numeric stats)
   * before a bar can be drawn.
   */
  barMax?: number;
};

export const DEFAULT_DATA_GRID_DISPLAY_OPTIONS: DataGridColumnDisplayOptions = {
  numberFormat: 'number',
  decimals: null,
  alignment: 'left',
  inCellBar: false,
};

/**
 * One mark in a stats chart. `filter` is what gets applied when the user
 * clicks the mark, so stat producers stay in control of filter semantics.
 */
export type DataGridStatBucket = {
  key: string;
  label: string;
  count: number;
  share?: number;
  filter?: DataGridStructuredFilterValue;
};

export type DataGridColumnStats =
  | { kind: 'loading' }
  | { kind: 'error'; message?: string }
  | { kind: 'summary'; label: React.ReactNode; value: React.ReactNode }
  | { kind: 'custom'; content: React.ReactNode }
  | {
      kind: 'textSummary';
      uniqueCount: number;
      nullCount: number;
      totalCount: number;
      samples?: string[];
    }
  | {
      kind: 'categorical';
      buckets: DataGridStatBucket[];
      /** Distinct values in the column, not just the ones in `buckets`. */
      uniqueCount?: number;
      nullCount?: number;
      otherCount?: number;
    }
  | {
      kind: 'numericDistribution';
      buckets: DataGridStatBucket[];
      min: number;
      max: number;
      mean: number;
      nullCount?: number;
    }
  | {
      kind: 'temporalDistribution';
      buckets: DataGridStatBucket[];
      min: string;
      max: string;
      nullCount?: number;
    };

/** Values a cell editor can produce. */
export type DataGridCellValue = string | number | boolean | null;

export type DataGridEditorKind = 'text' | 'number' | 'date' | 'select';

export type DataGridCellEdit = {
  rowId: DataGridRowId;
  columnId: string;
  /** The value before the *first* edit, so reverting clears the dirty flag. */
  previousValue: unknown;
  value: DataGridCellValue;
};

export const dataGridEditKey = (
  rowId: DataGridRowId,
  columnId: string
): string => `${String(rowId)}::${columnId}`;

export type DataGridColumn<TRow, TValue = unknown, TMeta = unknown> = {
  id: string;
  header: React.ReactNode;
  type?: DataGridColumnDataType;
  typeLabel?: string;
  /** Opt in to in-place editing. Ignored when `computed` is true. */
  editable?: boolean;
  /** Derived column: marked `fx` in the header and never editable. */
  computed?: boolean;
  /** Defaults to an editor inferred from `type`. */
  editorKind?: DataGridEditorKind;
  /** Choices for a `select` editor, resolved when the editor opens. */
  getEditOptions?: () => readonly string[] | undefined;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  pinned?: DataGridPinnedSide | null;
  visible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  meta?: TMeta;
  getValue: (row: TRow) => TValue;
  renderCell?: (
    context: DataGridCellContext<TRow, TValue, TMeta>
  ) => React.ReactNode;
  renderHeader?: (
    context: DataGridHeaderContext<TRow, TValue, TMeta>
  ) => React.ReactNode;
  renderHeaderStats?: (
    context: DataGridHeaderContext<TRow, TValue, TMeta>
  ) => React.ReactNode;
  renderDetail?: (
    context: DataGridCellContext<TRow, TValue, TMeta>
  ) => React.ReactNode;
};

export type DataGridHeaderContext<TRow, TValue = unknown, TMeta = unknown> = {
  column: DataGridColumn<TRow, TValue, TMeta>;
  columnIndex: number;
  sort: DataGridSort | null;
  sortIndex: number | null;
  sortCount: number;
  filter: DataGridFilter | null;
  stats: DataGridColumnStats | null;
  statsExpanded: boolean;
  displayOptions: DataGridColumnDisplayOptions;
  commands: {
    resize(width: number): void;
    reorderBefore(sourceColumnId: string): void;
    pin(side: DataGridPinnedSide): void;
    unpin(): void;
    setSort(direction: DataGridSortDirection | null): void;
    toggleSort(direction: DataGridSortDirection): void;
    setFilter(value: unknown): void;
    clearFilter(): void;
    /** Toggle a structured stat mark filter (categorical / range buckets). */
    toggleStatFilter(value: DataGridStructuredFilterValue): void;
    /** Ask the host to load this column's stats; no-op while collapsed. */
    requestStatsLoad(): void;
    setDisplayOptions(options: Partial<DataGridColumnDisplayOptions>): void;
    hide(): void;
  };
};

export type DataGridCellContext<TRow, TValue = unknown, TMeta = unknown> = {
  row: TRow;
  value: TValue;
  column: DataGridColumn<TRow, TValue, TMeta>;
  address: DataGridCellAddress;
  displayOptions: DataGridColumnDisplayOptions;
  state: {
    focused: boolean;
    selected: boolean;
    rowSelected: boolean;
    cellSelected: boolean;
    hovered: boolean;
    visible: boolean;
    editable: boolean;
    editing: boolean;
    /** Has an uncommitted edit relative to the loaded value. */
    dirty: boolean;
  };
  anchorRef: React.MutableRefObject<HTMLElement | null>;
  commands: {
    focus(): void;
    select(): void;
    toggleSelect(): void;
    selectRange(): void;
    openOverlay(content: React.ReactNode): void;
    closeOverlay(): void;
    openDetail(): void;
    beginEdit(): void;
    commitEdit(value: DataGridCellValue): void;
    cancelEdit(): void;
  };
};

export type DataGridColumnLayoutItem<TRow> = {
  column: DataGridColumn<TRow>;
  x: number;
  width: number;
  columnIndex: number;
  pinned: DataGridPinnedSide | null;
};

export type DataGridRowNumberLayoutItem = {
  id: '__row_number__';
  x: number;
  width: number;
  columnIndex: number;
  pinned: 'left';
};

export type DataGridColumnLayout<TRow> = {
  rowNumber: DataGridRowNumberLayoutItem;
  leftPinned: DataGridColumnLayoutItem<TRow>[];
  regular: DataGridColumnLayoutItem<TRow>[];
  rightPinned: DataGridColumnLayoutItem<TRow>[];
  leftPinnedWidth: number;
  regularWidth: number;
  rightPinnedWidth: number;
  totalWidth: number;
  visibleColumns: DataGridColumnLayoutItem<TRow>[];
  ariaColumnCount: number;
};

export type DataGridVirtualizationResult = {
  startIndex: number;
  endIndex: number;
  visibleCount: number;
  offsetY: number;
  totalHeight: number;
};

export type DataGridColumnVirtualizationResult = {
  startIndex: number;
  endIndex: number;
  visibleCount: number;
  offsetX: number;
  totalWidth: number;
};

export type DataGridVisibleWindow = {
  startRowIndex: number;
  endRowIndex: number;
  startColumnIndex: number;
  endColumnIndex: number;
};

/**
 * Incremental updates for live datasets. Applying a patch touches only the
 * affected rows so the grid does not have to swap the whole rows array.
 */
export type DataGridRowPatch<TRow> =
  | {
      type: 'update-cell';
      rowId: DataGridRowId;
      columnId: string;
      value: unknown;
    }
  | { type: 'update-row'; rowId: DataGridRowId; row: TRow }
  | { type: 'insert-row'; row: TRow; atIndex?: number }
  | { type: 'delete-row'; rowId: DataGridRowId }
  | {
      type: 'splice-rows';
      startIndex: number;
      deleteCount: number;
      rows: TRow[];
    };

export type DataGridRowSource<TRow> = {
  rows: ReadonlyGridStore<TRow[]>;
  totalRows: ReadonlyGridStore<number | null>;
  hasMore: ReadonlyGridStore<boolean>;
  isLoading: ReadonlyGridStore<boolean>;
  loadMore: () => void | Promise<void>;
  loadWindow?: (window: DataGridVisibleWindow) => void | Promise<void>;
  /** Present on patchable sources; lets callers push granular live updates. */
  applyPatch?: (patch: DataGridRowPatch<TRow>) => void;
};

export type DataGridColumnStatsSource = {
  get(columnId: string): ReadonlyGridStore<DataGridColumnStats | undefined>;
};

export type DataGridCellComponentProps<TRow> = {
  context: DataGridCellContext<TRow>;
  style: React.CSSProperties;
  onClick?: (event: React.MouseEvent) => void;
};

export type DataGridHeaderComponentProps<TRow> = {
  context: DataGridHeaderContext<TRow>;
  style: React.CSSProperties;
  /** Host controls for this column, from {@link DataGridProps.renderColumnHeaderActions}. */
  actions?: React.ReactNode;
};

export type DataGridRowComponentProps<TRow> = {
  row: TRow;
  rowId: DataGridRowId;
  rowIndex: number;
  selected: boolean;
  children: React.ReactNode;
  style: React.CSSProperties;
  onClick: (event: React.MouseEvent) => void;
};

export type DataGridRowDetailContext<TRow> = {
  row: TRow;
  rowId: DataGridRowId;
  rowIndex: number;
  /** Collapses this row, for a close affordance inside the panel. */
  collapse: () => void;
};

export type DataGridTopBarProps<TRow> = {
  rows: TRow[];
  columns: DataGridColumn<TRow>[];
  selectedRowIds: Set<DataGridRowId>;
  selectedCellRanges: DataGridCellRange[];
  totalRows: number | null;
  totalLoadedRows: number;
  sorts: DataGridSort[];
  filters: DataGridFilter[];
  isLoading: boolean;
  statsExpanded: boolean;
  setStatsExpanded: (expanded: boolean) => void;
  clearSort: (columnId: string) => void;
  clearFilter: (columnId: string) => void;
  /** Columns with `visible: false`; the top bar is how they get restored. */
  hiddenColumns: DataGridColumn<TRow>[];
  setColumnVisible: (columnId: string, visible: boolean) => void;
};

export type DataGridFooterProps<TRow> = {
  rows: TRow[];
  columns: DataGridColumn<TRow>[];
  totalRows: number | null;
  totalLoadedRows: number;
  sorts: DataGridSort[];
  filters: DataGridFilter[];
  selectedRowIds: Set<DataGridRowId>;
  selectedCellRanges: DataGridCellRange[];
  isLoading: boolean;
  clearSort: (columnId: string) => void;
  clearFilter: (columnId: string) => void;
  clearFilters: () => void;
};

export type DataGridProps<TRow> = {
  /**
   * Rows, as a plain array or as a store.
   *
   * The array form is the point: "here are 50 rows" should not require a
   * caller to learn what a store is. Pass a store when the rows change from
   * outside React and re-rendering the owner is not wanted — that is the
   * fine-grained path, and it is the exception.
   */
  rows?: TRow[] | ReadonlyGridStore<TRow[]>;
  rowSource?: DataGridRowSource<TRow>;
  getRowId: (row: TRow) => DataGridRowId;
  viewModel: DataGridViewModel<TRow>;
  className?: string;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  columnStats?:
    | Record<string, DataGridColumnStats | undefined>
    | ReadonlyGridStore<Record<string, DataGridColumnStats | undefined>>;
  /**
   * Per-column stats watchables. Preferred for live data: each rendered header
   * subscribes only to its own column so a stats delta never re-renders the
   * whole header row.
   */
  columnStatsSource?: DataGridColumnStatsSource;
  onLoadMore?: () => void | Promise<void>;
  onVisibleWindowChange?: (window: DataGridVisibleWindow) => void;
  onSortChange?: (sorts: DataGridSort[]) => void;
  onFilterChange?: (filters: DataGridFilter[]) => void;
  onHeaderStatsVisible?: (columnId: string) => void;
  /**
   * Controls rendered in a column's header, right of its title — for an action
   * that belongs to one column rather than to the grid (e.g. a "run these rows"
   * menu on the column that reports the runs). Called per rendered header;
   * return null for the columns it does not own.
   *
   * A grid-level hook rather than a field on the column because the state such
   * a control acts on is rarely in scope where columns are declared.
   */
  renderColumnHeaderActions?: (
    context: DataGridHeaderContext<TRow>
  ) => React.ReactNode;
  /** Fired once per committed edit, including edits that revert to original. */
  onCellEdit?: (edit: DataGridCellEdit) => void;
  /** Persist pending edits. Pending state is cleared only when this resolves. */
  onSaveEdits?: (edits: DataGridCellEdit[]) => void | Promise<void>;
  onRevertEdits?: (edits: DataGridCellEdit[]) => void | Promise<void>;
  /**
   * Persist each edit through `onSaveEdits` the moment it is committed rather
   * than collecting edits behind a Save/Revert banner. In this mode no banner
   * is shown, cells never linger as dirty, and `onRevertEdits` is unused.
   */
  autoSaveEdits?: boolean;
  onSelectCell?: (context: DataGridCellContext<TRow>) => void;
  onCellSelectionChange?: (ranges: DataGridCellRange[]) => void;
  onRowSelectionChange?: (rowIds: Set<DataGridRowId>) => void;
  /**
   * Inline detail panel for an expanded row. Supplying it is what turns on the
   * expand gutter; its height comes from the view model's `expansionHeight`,
   * which must be set for the panel to have any room.
   */
  renderRowDetail?: (
    context: DataGridRowDetailContext<TRow>
  ) => React.ReactNode;
  CellComponent?: React.ComponentType<DataGridCellComponentProps<TRow>>;
  HeaderComponent?: React.ComponentType<DataGridHeaderComponentProps<TRow>>;
  RowComponent?: React.ComponentType<DataGridRowComponentProps<TRow>>;
  TopBarComponent?: React.ComponentType<DataGridTopBarProps<TRow>>;
  FooterComponent?: React.ComponentType<DataGridFooterProps<TRow>>;
};

export function propertyColumn<TRow, TKey extends keyof TRow, TMeta = unknown>(
  definition: Omit<
    DataGridColumn<TRow, TRow[TKey], TMeta>,
    'id' | 'getValue'
  > & {
    key: TKey;
    id?: string;
  }
): DataGridColumn<TRow, TRow[TKey], TMeta> {
  const { key, id, ...rest } = definition;
  return {
    ...rest,
    id: id ?? String(key),
    getValue: (row) => row[key],
  };
}
