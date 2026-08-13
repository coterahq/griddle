import type React from 'react';
import type { DataGridRowId } from './types';

export function getSelectionRange<TRow>({
  anchor,
  target,
  rows,
  getRowId,
}: {
  anchor: DataGridRowId;
  target: DataGridRowId;
  rows: TRow[];
  getRowId: (row: TRow) => DataGridRowId;
}): Set<DataGridRowId> {
  const rowIds = rows.map((row) => getRowId(row));
  const anchorIndex = rowIds.indexOf(anchor);
  const targetIndex = rowIds.indexOf(target);
  if (anchorIndex === -1 || targetIndex === -1) {
    return new Set([target]);
  }

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return new Set(rowIds.slice(start, end + 1));
}

export function isToggleSelectionEvent(
  event: MouseEvent | React.MouseEvent
): boolean {
  return event.metaKey || event.ctrlKey;
}

export function isRangeSelectionEvent(
  event: MouseEvent | React.MouseEvent
): boolean {
  return event.shiftKey;
}
