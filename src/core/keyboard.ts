import type { DataGridCellAddress, DataGridRowId } from './types';

export type DataGridKeyboardAction =
  | { type: 'focus'; rowIndex: number; columnIndex: number }
  | { type: 'select-focused-row' }
  | { type: 'activate-focused-cell' }
  | { type: 'none' };

export function getKeyboardAction({
  key,
  focusedCell,
  rowCount,
  columnCount,
  pageSize,
}: {
  key: string;
  focusedCell: DataGridCellAddress | null;
  rowCount: number;
  columnCount: number;
  pageSize: number;
}): DataGridKeyboardAction {
  if (rowCount === 0 || columnCount === 0) {
    return { type: 'none' };
  }

  const currentRow = focusedCell?.rowIndex ?? 0;
  const currentColumn = focusedCell?.columnIndex ?? 0;
  const clampRow = (rowIndex: number) =>
    Math.max(0, Math.min(rowCount - 1, rowIndex));
  const clampColumn = (columnIndex: number) =>
    Math.max(0, Math.min(columnCount - 1, columnIndex));

  if (key === 'Enter') {
    return { type: 'activate-focused-cell' };
  }
  if (key === ' ') {
    return { type: 'select-focused-row' };
  }
  if (key === 'ArrowUp') {
    return {
      type: 'focus',
      rowIndex: clampRow(currentRow - 1),
      columnIndex: currentColumn,
    };
  }
  if (key === 'ArrowDown') {
    return {
      type: 'focus',
      rowIndex: clampRow(currentRow + 1),
      columnIndex: currentColumn,
    };
  }
  if (key === 'ArrowLeft') {
    return {
      type: 'focus',
      rowIndex: currentRow,
      columnIndex: clampColumn(currentColumn - 1),
    };
  }
  if (key === 'ArrowRight') {
    return {
      type: 'focus',
      rowIndex: currentRow,
      columnIndex: clampColumn(currentColumn + 1),
    };
  }
  if (key === 'Home') {
    return { type: 'focus', rowIndex: currentRow, columnIndex: 0 };
  }
  if (key === 'End') {
    return {
      type: 'focus',
      rowIndex: currentRow,
      columnIndex: columnCount - 1,
    };
  }
  if (key === 'PageUp') {
    return {
      type: 'focus',
      rowIndex: clampRow(currentRow - pageSize),
      columnIndex: currentColumn,
    };
  }
  if (key === 'PageDown') {
    return {
      type: 'focus',
      rowIndex: clampRow(currentRow + pageSize),
      columnIndex: currentColumn,
    };
  }

  return { type: 'none' };
}

export function getAddressForCell<TRow>({
  rows,
  getRowId,
  rowIndex,
  columnId,
  columnIndex,
}: {
  rows: TRow[];
  getRowId: (row: TRow) => DataGridRowId;
  rowIndex: number;
  columnId: string;
  columnIndex: number;
}): DataGridCellAddress | null {
  const row = rows[rowIndex];
  if (row === undefined) {
    return null;
  }

  return {
    rowId: getRowId(row),
    rowIndex,
    columnId,
    columnIndex,
  };
}
