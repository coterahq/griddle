import type {
  DataGridColumnLayoutItem,
  DataGridColumnVirtualizationResult,
  DataGridVirtualizationResult,
} from './types';
import type { DataGridRowOffsetIndex } from './row-offsets';

export function getVirtualizedRange({
  itemCount,
  itemSize,
  containerSize,
  scrollOffset,
  overscan = 5,
}: {
  itemCount: number;
  itemSize: number;
  containerSize: number;
  scrollOffset: number;
  overscan?: number;
}): DataGridVirtualizationResult {
  if (itemCount === 0 || itemSize <= 0 || containerSize <= 0) {
    return {
      startIndex: 0,
      endIndex: -1,
      visibleCount: 0,
      offsetY: 0,
      totalHeight: itemCount * itemSize,
    };
  }

  const visibleStartIndex = Math.floor(scrollOffset / itemSize);
  const visibleEndIndex = Math.min(
    itemCount - 1,
    Math.floor((scrollOffset + containerSize) / itemSize)
  );
  const startIndex = Math.max(0, visibleStartIndex - overscan);
  const endIndex = Math.min(itemCount - 1, visibleEndIndex + overscan);

  return {
    startIndex,
    endIndex,
    visibleCount: endIndex - startIndex + 1,
    offsetY: startIndex * itemSize,
    totalHeight: itemCount * itemSize,
  };
}

/**
 * The row window for a grid with expandable rows.
 *
 * Separate from {@link getVirtualizedRange} rather than replacing it: the
 * uniform case is the overwhelmingly common one and stays a pair of divisions,
 * while this walks the offset index instead. `offsetY` is the top of the first
 * rendered row, which is what the body translates by.
 */
export function getVirtualizedRangeWithOffsets({
  itemCount,
  offsets,
  containerSize,
  scrollOffset,
  overscan = 5,
}: {
  itemCount: number;
  offsets: DataGridRowOffsetIndex;
  containerSize: number;
  scrollOffset: number;
  overscan?: number;
}): DataGridVirtualizationResult {
  if (itemCount === 0 || offsets.rowHeight <= 0 || containerSize <= 0) {
    return {
      startIndex: 0,
      endIndex: -1,
      visibleCount: 0,
      offsetY: 0,
      totalHeight: offsets.totalHeight,
    };
  }

  const visibleStartIndex = offsets.indexForOffset(scrollOffset);
  const visibleEndIndex = offsets.indexForOffset(scrollOffset + containerSize);
  const startIndex = Math.max(0, visibleStartIndex - overscan);
  const endIndex = Math.min(itemCount - 1, visibleEndIndex + overscan);

  return {
    startIndex,
    endIndex,
    visibleCount: endIndex - startIndex + 1,
    offsetY: offsets.offsetForIndex(startIndex),
    totalHeight: offsets.totalHeight,
  };
}

export function getVirtualizedColumns<TRow>({
  columns,
  containerSize,
  scrollOffset,
  overscan = 2,
}: {
  columns: DataGridColumnLayoutItem<TRow>[];
  containerSize: number;
  scrollOffset: number;
  overscan?: number;
}): DataGridColumnVirtualizationResult {
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
  if (columns.length === 0 || containerSize <= 0) {
    return {
      startIndex: 0,
      endIndex: -1,
      visibleCount: 0,
      offsetX: 0,
      totalWidth,
    };
  }

  const baseOffset = columns[0]?.x ?? 0;
  const visibleStartX = baseOffset + scrollOffset;
  const visibleEndX = visibleStartX + containerSize;
  let firstVisibleIndex = 0;
  let lastVisibleIndex = columns.length - 1;

  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index];
    if (column !== undefined && column.x + column.width >= visibleStartX) {
      firstVisibleIndex = index;
      break;
    }
  }

  for (let index = firstVisibleIndex; index < columns.length; index += 1) {
    const column = columns[index];
    if (column !== undefined && column.x > visibleEndX) {
      lastVisibleIndex = Math.max(firstVisibleIndex, index - 1);
      break;
    }
  }

  const startIndex = Math.max(0, firstVisibleIndex - overscan);
  const endIndex = Math.min(columns.length - 1, lastVisibleIndex + overscan);
  const offsetX = columns[startIndex]?.x ?? 0;

  return {
    startIndex,
    endIndex,
    visibleCount: endIndex - startIndex + 1,
    offsetX,
    totalWidth,
  };
}
