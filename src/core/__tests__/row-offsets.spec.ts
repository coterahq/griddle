import { describe, expect, it } from 'vitest';
import { createRowOffsetIndex } from '../row-offsets';
import { getVirtualizedRangeWithOffsets } from '../virtualization';

const ROW_HEIGHT = 36;
const EXPANSION_HEIGHT = 320;

describe('createRowOffsetIndex', () => {
  it('matches uniform multiplication when nothing is expanded', () => {
    const offsets = createRowOffsetIndex({ rowCount: 100, rowHeight: 36 });

    expect(offsets.totalHeight).toBe(3600);
    expect(offsets.offsetForIndex(0)).toBe(0);
    expect(offsets.offsetForIndex(10)).toBe(360);
    expect(offsets.indexForOffset(360)).toBe(10);
    expect(offsets.indexForOffset(371)).toBe(10);
  });

  it('shifts only the rows below an expansion', () => {
    const offsets = createRowOffsetIndex({
      rowCount: 10,
      rowHeight: ROW_HEIGHT,
      expandedIndices: [2],
      expansionHeight: EXPANSION_HEIGHT,
    });

    expect(offsets.offsetForIndex(2)).toBe(2 * ROW_HEIGHT);
    // The expanded row's own top is unmoved; everything after it drops by
    // exactly one expansion.
    expect(offsets.offsetForIndex(3)).toBe(3 * ROW_HEIGHT + EXPANSION_HEIGHT);
    expect(offsets.totalHeight).toBe(10 * ROW_HEIGHT + EXPANSION_HEIGHT);
  });

  it('accumulates several expansions in index order', () => {
    const offsets = createRowOffsetIndex({
      rowCount: 20,
      rowHeight: ROW_HEIGHT,
      // Deliberately unsorted and duplicated, as a caller deriving these from
      // a Set of row ids would produce.
      expandedIndices: [7, 1, 4, 4],
      expansionHeight: EXPANSION_HEIGHT,
    });

    expect(offsets.offsetForIndex(0)).toBe(0);
    expect(offsets.offsetForIndex(2)).toBe(2 * ROW_HEIGHT + EXPANSION_HEIGHT);
    expect(offsets.offsetForIndex(5)).toBe(
      5 * ROW_HEIGHT + 2 * EXPANSION_HEIGHT
    );
    expect(offsets.offsetForIndex(8)).toBe(
      8 * ROW_HEIGHT + 3 * EXPANSION_HEIGHT
    );
    expect(offsets.totalHeight).toBe(20 * ROW_HEIGHT + 3 * EXPANSION_HEIGHT);
  });

  it('round-trips every index through offsetForIndex and back', () => {
    const offsets = createRowOffsetIndex({
      rowCount: 50,
      rowHeight: ROW_HEIGHT,
      expandedIndices: [0, 3, 17, 49],
      expansionHeight: EXPANSION_HEIGHT,
    });

    for (let index = 0; index < 50; index += 1) {
      expect(offsets.indexForOffset(offsets.offsetForIndex(index))).toBe(index);
    }
  });

  it('resolves an offset inside an expansion to the row that owns it', () => {
    const offsets = createRowOffsetIndex({
      rowCount: 10,
      rowHeight: ROW_HEIGHT,
      expandedIndices: [2],
      expansionHeight: EXPANSION_HEIGHT,
    });

    const insidePanel = offsets.offsetForIndex(2) + ROW_HEIGHT + 100;

    // Not row 3: the panel belongs to row 2, so a click or scroll landing in
    // it is still "at" row 2.
    expect(offsets.indexForOffset(insidePanel)).toBe(2);
  });

  it('ignores expansions that are out of range or have no height', () => {
    const withoutHeight = createRowOffsetIndex({
      rowCount: 5,
      rowHeight: ROW_HEIGHT,
      expandedIndices: [1],
      expansionHeight: 0,
    });
    expect(withoutHeight.totalHeight).toBe(5 * ROW_HEIGHT);
    expect(withoutHeight.isExpanded(1)).toBe(false);

    // A stale index left over from a shorter page would otherwise add height
    // that no rendered row accounts for.
    const outOfRange = createRowOffsetIndex({
      rowCount: 5,
      rowHeight: ROW_HEIGHT,
      expandedIndices: [9, -1],
      expansionHeight: EXPANSION_HEIGHT,
    });
    expect(outOfRange.totalHeight).toBe(5 * ROW_HEIGHT);
  });

  it('handles an empty grid', () => {
    const offsets = createRowOffsetIndex({
      rowCount: 0,
      rowHeight: ROW_HEIGHT,
    });

    expect(offsets.totalHeight).toBe(0);
    expect(offsets.indexForOffset(500)).toBe(0);
  });
});

describe('getVirtualizedRangeWithOffsets', () => {
  it('windows on real offsets rather than a row-height division', () => {
    const offsets = createRowOffsetIndex({
      rowCount: 100,
      rowHeight: ROW_HEIGHT,
      expandedIndices: [1],
      expansionHeight: EXPANSION_HEIGHT,
    });

    const range = getVirtualizedRangeWithOffsets({
      itemCount: 100,
      offsets,
      containerSize: 360,
      scrollOffset: 0,
      overscan: 0,
    });

    // Without the expansion 10 rows would fit in 360px. Row 1's open panel
    // pushes row 2 down to 392, past the viewport, so only rows 0-1 render.
    expect(range).toMatchObject({
      startIndex: 0,
      endIndex: 1,
      offsetY: 0,
      totalHeight: 100 * ROW_HEIGHT + EXPANSION_HEIGHT,
    });
  });

  it('offsets the rendered window by the first row top', () => {
    const offsets = createRowOffsetIndex({
      rowCount: 100,
      rowHeight: ROW_HEIGHT,
      expandedIndices: [0],
      expansionHeight: EXPANSION_HEIGHT,
    });

    const range = getVirtualizedRangeWithOffsets({
      itemCount: 100,
      offsets,
      containerSize: 200,
      scrollOffset: 500,
      overscan: 0,
    });

    expect(range.offsetY).toBe(offsets.offsetForIndex(range.startIndex));
  });

  it('returns an empty window for an empty grid', () => {
    const offsets = createRowOffsetIndex({
      rowCount: 0,
      rowHeight: ROW_HEIGHT,
    });

    expect(
      getVirtualizedRangeWithOffsets({
        itemCount: 0,
        offsets,
        containerSize: 400,
        scrollOffset: 0,
      })
    ).toMatchObject({ startIndex: 0, endIndex: -1, visibleCount: 0 });
  });
});
