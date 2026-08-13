import type {
  DataGridColumn,
  DataGridColumnLayout,
  DataGridColumnLayoutItem,
  DataGridPinnedSide,
} from './types';

export const DATA_GRID_DEFAULT_COLUMN_WIDTH = 160;
export const DATA_GRID_ROW_NUMBER_WIDTH = 52;

const isVisible = <TRow>(column: DataGridColumn<TRow>): boolean =>
  column.visible !== false;

const widthForColumn = <TRow>(column: DataGridColumn<TRow>): number => {
  const width = column.width ?? DATA_GRID_DEFAULT_COLUMN_WIDTH;
  const minWidth = column.minWidth ?? 80;
  const maxWidth = column.maxWidth ?? 600;
  return Math.min(maxWidth, Math.max(minWidth, width));
};

const sumWidths = <TRow>(columns: DataGridColumnLayoutItem<TRow>[]): number =>
  columns.reduce((sum, column) => sum + column.width, 0);

const layoutGroup = <TRow>(
  columns: DataGridColumn<TRow>[],
  pinned: DataGridPinnedSide | null,
  startX: number,
  columnIndexOffset: number
): DataGridColumnLayoutItem<TRow>[] => {
  let x = startX;
  return columns.map((column, index) => {
    const width = widthForColumn(column);
    const item: DataGridColumnLayoutItem<TRow> = {
      column,
      x,
      width,
      columnIndex: columnIndexOffset + index,
      pinned,
    };
    x += width;
    return item;
  });
};

export function getDataGridColumnLayout<TRow>(
  columns: DataGridColumn<TRow>[],
  rowNumberWidth = DATA_GRID_ROW_NUMBER_WIDTH
): DataGridColumnLayout<TRow> {
  const visibleColumns = columns.filter(isVisible);
  const leftColumns = visibleColumns.filter(
    (column) => column.pinned === 'left'
  );
  const regularColumns = visibleColumns.filter(
    (column) => column.pinned !== 'left' && column.pinned !== 'right'
  );
  const rightColumns = visibleColumns.filter(
    (column) => column.pinned === 'right'
  );

  const leftPinned = layoutGroup(leftColumns, 'left', rowNumberWidth, 0);
  const leftPinnedWidth = rowNumberWidth + sumWidths(leftPinned);
  const regular = layoutGroup(
    regularColumns,
    null,
    leftPinnedWidth,
    leftPinned.length
  );
  const regularWidth = sumWidths(regular);
  const rightPinned = layoutGroup(
    rightColumns,
    'right',
    leftPinnedWidth + regularWidth,
    leftPinned.length + regular.length
  );
  const rightPinnedWidth = sumWidths(rightPinned);

  return {
    rowNumber: {
      id: '__row_number__',
      x: 0,
      width: rowNumberWidth,
      columnIndex: 0,
      pinned: 'left',
    },
    leftPinned,
    regular,
    rightPinned,
    leftPinnedWidth,
    regularWidth,
    rightPinnedWidth,
    totalWidth: leftPinnedWidth + regularWidth + rightPinnedWidth,
    visibleColumns: [...leftPinned, ...regular, ...rightPinned],
    ariaColumnCount: visibleColumns.length + 1,
  };
}
