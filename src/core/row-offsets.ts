/**
 * Vertical geometry for a grid whose rows are uniform except for expanded ones.
 *
 * The grid otherwise multiplies `rowIndex * rowHeight`, which is exact only
 * while every row is the same height. Expansion breaks that, but not badly: the
 * expansion height is fixed, so a row's offset is still closed-form —
 *
 *     offset(i) = i * rowHeight + expandedBefore(i) * expansionHeight
 *
 * and `expandedBefore` is a binary search over the sorted expanded indices.
 * That keeps both directions O(log k) in the number of *expanded* rows rather
 * than O(n) in the number of rows, so no prefix-sum array is materialised for a
 * dataset with a hundred thousand loaded rows and two open detail panels.
 */
export type DataGridRowOffsetIndex = {
  /** Total body height, expansions included. */
  totalHeight: number;
  /** Uniform height of a row, excluding any expansion below it. */
  rowHeight: number;
  /** Extra height an expanded row contributes. Zero when nothing expands. */
  expansionHeight: number;
  /** Whether the row at this index is expanded. */
  isExpanded(index: number): boolean;
  /** Top of the row at this index, relative to the body's origin. */
  offsetForIndex(index: number): number;
  /**
   * The index of the row containing this offset, clamped into range. The
   * inverse of {@link offsetForIndex}, so an offset inside a row's expansion
   * resolves to that row rather than the next one.
   */
  indexForOffset(offset: number): number;
};

export type CreateRowOffsetIndexOptions = {
  rowCount: number;
  rowHeight: number;
  /** Row indices that are expanded. Need not be sorted or deduplicated. */
  expandedIndices?: readonly number[];
  expansionHeight?: number;
};

/** Number of entries in `sorted` that are strictly less than `value`. */
const countBelow = (sorted: readonly number[], value: number): number => {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((sorted[mid] ?? 0) < value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
};

export function createRowOffsetIndex({
  rowCount,
  rowHeight,
  expandedIndices = [],
  expansionHeight = 0,
}: CreateRowOffsetIndexOptions): DataGridRowOffsetIndex {
  // Only expansions that are actually in range and actually add height count;
  // anything else would skew every offset below it.
  const expanded =
    expansionHeight <= 0
      ? []
      : [
          ...new Set(
            expandedIndices.filter((index) => index >= 0 && index < rowCount)
          ),
        ].sort((left, right) => left - right);

  const expandedSet = new Set(expanded);
  const totalHeight = rowCount * rowHeight + expanded.length * expansionHeight;

  const offsetForIndex = (index: number): number => {
    const clamped = Math.max(0, Math.min(index, rowCount));
    return (
      clamped * rowHeight + countBelow(expanded, clamped) * expansionHeight
    );
  };

  return {
    totalHeight,
    rowHeight,
    expansionHeight,
    isExpanded: (index) => expandedSet.has(index),
    offsetForIndex,

    indexForOffset(offset) {
      if (rowCount === 0 || rowHeight <= 0) {
        return 0;
      }
      const target = Math.max(0, offset);
      if (expanded.length === 0) {
        return Math.min(rowCount - 1, Math.floor(target / rowHeight));
      }
      // Binary search for the last row whose top is at or before `target`.
      // Searching on offsets rather than dividing through is what makes an
      // offset that lands inside an expansion resolve to its owning row.
      let low = 0;
      let high = rowCount - 1;
      while (low < high) {
        const mid = (low + high + 1) >>> 1;
        if (offsetForIndex(mid) <= target) {
          low = mid;
        } else {
          high = mid - 1;
        }
      }
      return low;
    },
  };
}
