import { Watchable } from '@cotera/client/v0/actions/framework';
import type { ReadonlyWatchable } from '@cotera/client/v0/actions/framework';
import type {
  DataGridCellAddress,
  DataGridCellEdit,
  DataGridCellRange,
  DataGridCellValue,
  DataGridColumn,
  DataGridColumnDisplayOptions,
  DataGridFilter,
  DataGridPinnedSide,
  DataGridRowId,
  DataGridSort,
  DataGridSortDirection,
} from './types';
import { DEFAULT_DATA_GRID_DISPLAY_OPTIONS, dataGridEditKey } from './types';

export type DataGridFocusedCell = DataGridCellAddress;

export type DataGridViewModel<TRow> = {
  columns: Watchable<DataGridColumn<TRow>[]>;
  focusedCell: Watchable<DataGridFocusedCell | null>;
  selectedRowIds: Watchable<Set<DataGridRowId>>;
  selectedCellRanges: Watchable<DataGridCellRange[]>;
  cellSelectionAnchor: Watchable<DataGridCellAddress | null>;
  selectionAnchor: Watchable<DataGridRowId | null>;
  sorts: Watchable<DataGridSort[]>;
  filters: Watchable<DataGridFilter[]>;
  headersExpanded: Watchable<boolean>;
  columnDisplayOptions: Watchable<
    Record<string, DataGridColumnDisplayOptions | undefined>
  >;
  editingCell: Watchable<DataGridCellAddress | null>;
  pendingEdits: Watchable<Record<string, DataGridCellEdit | undefined>>;
  scrollX: Watchable<number>;
  scrollY: Watchable<number>;
  /**
   * Rows showing their detail panel. Kept by row id rather than index so it
   * survives paging and re-sorting, which renumber every row.
   */
  expandedRowIds: Watchable<Set<DataGridRowId>>;
  rowHeight: ReadonlyWatchable<number>;
  /**
   * Extra height an expanded row takes. Fixed rather than measured: the grid
   * positions every row from this number, so a panel that resized itself after
   * paint would drag everything below it.
   */
  expansionHeight: ReadonlyWatchable<number>;
  headerHeight: ReadonlyWatchable<number>;
  totalRows: ReadonlyWatchable<number | null>;
  totalLoadedRows: ReadonlyWatchable<number>;

  focusCell(address: DataGridFocusedCell): void;
  clearFocus(): void;
  selectOnly(rowId: DataGridRowId): void;
  clearSelection(): void;
  toggleRowSelection(rowId: DataGridRowId): void;
  selectRowRange(
    anchor: DataGridRowId,
    target: DataGridRowId,
    visibleRows: TRow[],
    getRowId: (row: TRow) => DataGridRowId
  ): void;
  toggleRowExpanded(rowId: DataGridRowId): void;
  collapseAllRows(): void;
  selectCell(address: DataGridCellAddress): void;
  toggleCell(address: DataGridCellAddress): void;
  selectCellRange(
    anchor: DataGridCellAddress,
    target: DataGridCellAddress
  ): void;
  clearCellSelection(): void;
  setSort(columnId: string, direction: DataGridSortDirection | null): void;
  toggleSort(columnId: string, direction: DataGridSortDirection): void;
  setFilter(columnId: string, value: unknown): void;
  clearFilter(columnId: string): void;
  clearFilters(): void;
  clearSorts(): void;
  setColumnDisplayOptions(
    columnId: string,
    options: Partial<DataGridColumnDisplayOptions>
  ): void;
  setColumnVisible(columnId: string, visible: boolean): void;
  beginEdit(address: DataGridCellAddress): void;
  cancelEdit(): void;
  /**
   * Records a committed edit. Returns the edit, or null when the value went
   * back to the originally loaded one — that case clears the dirty flag.
   */
  commitEdit(
    address: DataGridCellAddress,
    value: DataGridCellValue,
    loadedValue: unknown
  ): DataGridCellEdit | null;
  clearEdits(): void;
  resizeColumn(columnId: string, width: number): void;
  reorderColumn(columnId: string, targetColumnId: string): void;
  pinColumn(columnId: string, side: DataGridPinnedSide): void;
  unpinColumn(columnId: string): void;
  setTotalRows(totalRows: number | null): void;
  setTotalLoadedRows(totalLoadedRows: number): void;
};

type CreateDataGridViewModelOptions<TRow> = {
  columns: DataGridColumn<TRow>[];
  rowHeight?: number;
  /** Height of a row's detail panel. 0 disables expansion entirely. */
  expansionHeight?: number;
  headerHeight?: number;
  expandedHeaderHeight?: number;
  totalRows?: number | null;
  totalLoadedRows?: number;
};

const DEFAULT_ROW_HEIGHT = 36;
const DEFAULT_HEADER_HEIGHT = 40;
// Tall enough for a stats caption, three category rows and a "+ N more" row.
const DEFAULT_EXPANDED_HEADER_HEIGHT = 124;

const cloneSet = <T>(value: Set<T>): Set<T> => new Set(value);

const sameCell = (
  left: DataGridCellAddress,
  right: DataGridCellAddress
): boolean => left.rowId === right.rowId && left.columnId === right.columnId;

const clampColumnWidth = <TRow>(
  column: DataGridColumn<TRow>,
  width: number
): number => {
  const minWidth = column.minWidth ?? 80;
  const maxWidth = column.maxWidth ?? 600;
  return Math.min(maxWidth, Math.max(minWidth, width));
};

export function createDataGridViewModel<TRow>({
  columns,
  rowHeight = DEFAULT_ROW_HEIGHT,
  expansionHeight = 0,
  headerHeight = DEFAULT_HEADER_HEIGHT,
  expandedHeaderHeight = DEFAULT_EXPANDED_HEADER_HEIGHT,
  totalRows = null,
  totalLoadedRows = 0,
}: CreateDataGridViewModelOptions<TRow>): DataGridViewModel<TRow> {
  const columnsWatchable = Watchable.fromValue(columns);
  const focusedCell = Watchable.fromValue<DataGridFocusedCell | null>(null);
  const selectedRowIds = Watchable.fromValue<Set<DataGridRowId>>(new Set(), {
    updater: cloneSet,
  });
  const selectedCellRanges = Watchable.fromValue<DataGridCellRange[]>([]);
  const cellSelectionAnchor = Watchable.fromValue<DataGridCellAddress | null>(
    null
  );
  const selectionAnchor = Watchable.fromValue<DataGridRowId | null>(null);
  const sorts = Watchable.fromValue<DataGridSort[]>([]);
  const filters = Watchable.fromValue<DataGridFilter[]>([]);
  const headersExpanded = Watchable.fromValue(false);
  const columnDisplayOptions = Watchable.fromValue<
    Record<string, DataGridColumnDisplayOptions | undefined>
  >({});
  const editingCell = Watchable.fromValue<DataGridCellAddress | null>(null);
  const pendingEdits = Watchable.fromValue<
    Record<string, DataGridCellEdit | undefined>
  >({});
  const scrollX = Watchable.fromValue(0);
  const scrollY = Watchable.fromValue(0);
  const expandedRowIds = Watchable.fromValue<Set<DataGridRowId>>(new Set(), {
    updater: cloneSet,
  });
  const rowHeightWatchable = Watchable.fromValue(rowHeight);
  const expansionHeightWatchable = Watchable.fromValue(expansionHeight);
  const headerHeightWatchable = Watchable.from((get) =>
    get(headersExpanded) ? expandedHeaderHeight : headerHeight
  );
  const totalRowsWatchable = Watchable.fromValue<number | null>(totalRows);
  const totalLoadedRowsWatchable = Watchable.fromValue(totalLoadedRows);

  return {
    columns: columnsWatchable,
    focusedCell,
    selectedRowIds,
    selectedCellRanges,
    cellSelectionAnchor,
    selectionAnchor,
    sorts,
    filters,
    headersExpanded,
    columnDisplayOptions,
    editingCell,
    pendingEdits,
    scrollX,
    scrollY,
    expandedRowIds,
    rowHeight: rowHeightWatchable,
    expansionHeight: expansionHeightWatchable,
    headerHeight: headerHeightWatchable,
    totalRows: totalRowsWatchable,
    totalLoadedRows: totalLoadedRowsWatchable,

    focusCell(address) {
      focusedCell.set(address);
    },

    clearFocus() {
      focusedCell.set(null);
    },

    selectOnly(rowId) {
      selectedRowIds.set(new Set([rowId]));
      selectionAnchor.set(rowId);
    },

    clearSelection() {
      selectedRowIds.set(new Set());
      selectionAnchor.set(null);
    },

    toggleRowSelection(rowId) {
      const next = new Set(selectedRowIds.snapshot());
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      selectedRowIds.set(next);
      selectionAnchor.set(rowId);
    },

    selectRowRange(anchor, target, visibleRows, getRowId) {
      const ids = visibleRows.map((row) => getRowId(row));
      const anchorIndex = ids.indexOf(anchor);
      const targetIndex = ids.indexOf(target);
      if (anchorIndex === -1 || targetIndex === -1) {
        selectedRowIds.set(new Set([target]));
        selectionAnchor.set(target);
        return;
      }

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      selectedRowIds.set(new Set(ids.slice(start, end + 1)));
      selectionAnchor.set(anchor);
    },

    toggleRowExpanded(rowId) {
      const next = new Set(expandedRowIds.snapshot());
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      expandedRowIds.set(next);
    },

    collapseAllRows() {
      expandedRowIds.set(new Set());
    },

    selectCell(address) {
      focusedCell.set(address);
      selectedCellRanges.set([{ start: address, end: address }]);
      cellSelectionAnchor.set(address);
    },

    toggleCell(address) {
      const current = selectedCellRanges.snapshot();
      const withoutAddress = current.filter(
        (range) =>
          !sameCell(range.start, address) || !sameCell(range.end, address)
      );
      selectedCellRanges.set(
        withoutAddress.length === current.length
          ? [...current, { start: address, end: address }]
          : withoutAddress
      );
      focusedCell.set(address);
      cellSelectionAnchor.set(address);
    },

    selectCellRange(anchor, target) {
      selectedCellRanges.set([{ start: anchor, end: target }]);
      focusedCell.set(target);
      cellSelectionAnchor.set(anchor);
    },

    clearCellSelection() {
      selectedCellRanges.set([]);
      cellSelectionAnchor.set(null);
    },

    setSort(columnId, direction) {
      sorts.set(
        direction === null
          ? sorts.snapshot().filter((sort) => sort.columnId !== columnId)
          : [
              ...sorts.snapshot().filter((sort) => sort.columnId !== columnId),
              { columnId, direction },
            ]
      );
    },

    toggleSort(columnId, direction) {
      const existing = sorts
        .snapshot()
        .find((sort) => sort.columnId === columnId);
      sorts.set(
        existing?.direction === direction
          ? sorts.snapshot().filter((sort) => sort.columnId !== columnId)
          : [
              ...sorts.snapshot().filter((sort) => sort.columnId !== columnId),
              { columnId, direction },
            ]
      );
    },

    setFilter(columnId, value) {
      filters.set([
        ...filters.snapshot().filter((filter) => filter.columnId !== columnId),
        { columnId, value },
      ]);
    },

    clearFilter(columnId) {
      filters.set(
        filters.snapshot().filter((filter) => filter.columnId !== columnId)
      );
    },

    clearFilters() {
      filters.set([]);
    },

    clearSorts() {
      sorts.set([]);
    },

    setColumnDisplayOptions(columnId, options) {
      const current = columnDisplayOptions.snapshot();
      columnDisplayOptions.set({
        ...current,
        [columnId]: {
          ...DEFAULT_DATA_GRID_DISPLAY_OPTIONS,
          ...current[columnId],
          ...options,
        },
      });
    },

    setColumnVisible(columnId, visible) {
      columnsWatchable.set(
        columnsWatchable
          .snapshot()
          .map((column) =>
            column.id === columnId ? { ...column, visible } : column
          )
      );
    },

    beginEdit(address) {
      editingCell.set(address);
    },

    cancelEdit() {
      editingCell.set(null);
    },

    commitEdit(address, value, loadedValue) {
      editingCell.set(null);
      const key = dataGridEditKey(address.rowId, address.columnId);
      const current = pendingEdits.snapshot();
      // The baseline is whatever the row held before the first edit, so a
      // round trip back to it removes the entry rather than stacking one.
      const previousValue = current[key]?.previousValue ?? loadedValue;
      const next = { ...current };
      if (Object.is(value, previousValue)) {
        delete next[key];
        pendingEdits.set(next);
        return null;
      }
      const edit: DataGridCellEdit = {
        rowId: address.rowId,
        columnId: address.columnId,
        previousValue,
        value,
      };
      next[key] = edit;
      pendingEdits.set(next);
      return edit;
    },

    clearEdits() {
      pendingEdits.set({});
      editingCell.set(null);
    },

    resizeColumn(columnId, width) {
      columnsWatchable.set(
        columnsWatchable
          .snapshot()
          .map((column) =>
            column.id === columnId
              ? { ...column, width: clampColumnWidth(column, width) }
              : column
          )
      );
    },

    reorderColumn(columnId, targetColumnId) {
      const next = [...columnsWatchable.snapshot()];
      const fromIndex = next.findIndex((column) => column.id === columnId);
      const toIndex = next.findIndex((column) => column.id === targetColumnId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
        return;
      }

      const [column] = next.splice(fromIndex, 1);
      if (column === undefined) {
        return;
      }
      next.splice(toIndex, 0, column);
      columnsWatchable.set(next);
    },

    pinColumn(columnId, side) {
      columnsWatchable.set(
        columnsWatchable
          .snapshot()
          .map((column) =>
            column.id === columnId ? { ...column, pinned: side } : column
          )
      );
    },

    unpinColumn(columnId) {
      columnsWatchable.set(
        columnsWatchable
          .snapshot()
          .map((column) =>
            column.id === columnId ? { ...column, pinned: null } : column
          )
      );
    },

    setTotalRows(value) {
      totalRowsWatchable.set(value);
    },

    setTotalLoadedRows(value) {
      totalLoadedRowsWatchable.set(value);
    },
  };
}
