import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { BaseCell } from '../cells/base-cell';
import { DataGrid } from '../data-grid';
import { createPatchableRowSource } from '../row-source';
import { createDataGridViewModel } from '../view-model';
import type { DataGridCellComponentProps, DataGridColumn } from '../types';

/**
 * What a live update actually costs.
 *
 * The library's claim is that pushing a row in — or changing one cell —
 * repaints what changed rather than the grid. Two mechanisms are supposed to
 * make that true, and both are easy to break by accident:
 *
 *  1. `createPatchableRowSource` keeps the *identity* of every row object a
 *     patch does not touch, and returns the same array reference outright for
 *     a write that changes nothing.
 *  2. Rows are `React.memo`'d, so an untouched row with an unchanged row object
 *     skips rendering its cells.
 *
 * These are measurements, not assertions of intent: the counters below are the
 * real render counts. If a future change makes a prop unstable, the memo stops
 * holding and these numbers move.
 */

type Row = { id: string; name: string; total: number };

const COLUMNS: DataGridColumn<Row>[] = [
  { id: 'name', header: 'Name', width: 160, getValue: (row) => row.name },
  { id: 'total', header: 'Total', width: 120, getValue: (row) => row.total },
];

const makeRows = (count: number, offset = 0): Row[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `r${String(offset + index)}`,
    name: `row ${String(offset + index)}`,
    total: offset + index,
  }));

/** Per-row render counter, so "did this row repaint" is answerable. */
const renders = new Map<string, number>();

function CountingCell(props: DataGridCellComponentProps<Row>) {
  const rowId = String(props.context.address.rowId);
  renders.set(rowId, (renders.get(rowId) ?? 0) + 1);
  return <BaseCell<Row> {...props} />;
}

const countFor = (rowId: string): number => renders.get(rowId) ?? 0;

beforeEach(() => {
  renders.clear();
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = TestResizeObserver;
});

const mount = (rows: Row[]) => {
  const source = createPatchableRowSource<Row>({
    getRowId: (row) => row.id,
    loadMore: () => undefined,
  });
  source.rows.set(rows);
  source.totalRows.set(rows.length);

  const viewModel = createDataGridViewModel<Row>({ columns: COLUMNS });
  const view = render(
    <DataGrid<Row>
      rowSource={source}
      getRowId={(row) => row.id}
      viewModel={viewModel}
      CellComponent={CountingCell}
    />
  );
  return { source, viewModel, view };
};

describe('row identity survives a patch', () => {
  it('returns the same array reference for a cell write that changes nothing', () => {
    const source = createPatchableRowSource<Row>({
      getRowId: (row) => row.id,
      loadMore: () => undefined,
    });
    source.rows.set(makeRows(3));
    const before = source.rows.snapshot();

    source.applyPatch({
      type: 'update-cell',
      rowId: 'r1',
      columnId: 'name',
      value: 'row 1',
    });

    // Same reference, so the store's `Object.is` guard drops the write and no
    // subscriber is notified at all. A reconcile that restates every loaded
    // row sends mostly these.
    expect(source.rows.snapshot()).toBe(before);
  });

  it('keeps untouched row objects identical across an insert', () => {
    const source = createPatchableRowSource<Row>({
      getRowId: (row) => row.id,
      loadMore: () => undefined,
    });
    source.rows.set(makeRows(3));
    const before = source.rows.snapshot();

    source.applyPatch({
      type: 'insert-row',
      row: { id: 'new', name: 'new', total: 9 },
    });

    const after = source.rows.snapshot();
    expect(after).not.toBe(before);
    // The array is new; the rows in it are not.
    expect(after.slice(0, 3).every((row, index) => row === before[index])).toBe(
      true
    );
  });

  it('replaces only the patched row object on a real cell write', () => {
    const source = createPatchableRowSource<Row>({
      getRowId: (row) => row.id,
      loadMore: () => undefined,
    });
    source.rows.set(makeRows(3));
    const before = source.rows.snapshot();

    source.applyPatch({
      type: 'update-cell',
      rowId: 'r1',
      columnId: 'name',
      value: 'changed',
    });

    const after = source.rows.snapshot();
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[2]).toBe(before[2]);
  });

  it('coalesces a batch into one notification', () => {
    const source = createPatchableRowSource<Row>({
      getRowId: (row) => row.id,
      loadMore: () => undefined,
    });
    source.rows.set(makeRows(3));

    let notifications = 0;
    source.rows.subscribe(() => {
      notifications += 1;
    });

    source.applyPatches([
      { type: 'update-cell', rowId: 'r0', columnId: 'name', value: 'a' },
      { type: 'update-cell', rowId: 'r1', columnId: 'name', value: 'b' },
      { type: 'update-cell', rowId: 'r2', columnId: 'name', value: 'c' },
    ]);

    expect(notifications).toBe(1);
  });
});

describe('render cost of a live update', () => {
  it('does not re-render an untouched row when a row is inserted', () => {
    const { source } = mount(makeRows(10));
    const baseline = countFor('r5');
    expect(baseline).toBeGreaterThan(0);

    act(() => {
      source.applyPatch({
        type: 'insert-row',
        row: { id: 'inserted', name: 'inserted', total: 99 },
      });
    });

    expect(screen.getByText('inserted')).toBeInTheDocument();
    // The inserted row rendered; row 5 did not.
    expect(countFor('r5')).toBe(baseline);
  });

  it('re-renders only the row a cell write touched', () => {
    const { source } = mount(makeRows(10));
    const untouched = countFor('r7');
    const target = countFor('r2');

    act(() => {
      source.applyPatch({
        type: 'update-cell',
        rowId: 'r2',
        columnId: 'name',
        value: 'patched',
      });
    });

    expect(screen.getByText('patched')).toBeInTheDocument();
    expect(countFor('r7')).toBe(untouched);
    expect(countFor('r2')).toBeGreaterThan(target);
  });

  it('does not re-render any row when a patch changes nothing', () => {
    const { source } = mount(makeRows(10));
    const before = new Map(renders);

    act(() => {
      source.applyPatch({
        type: 'update-cell',
        rowId: 'r3',
        columnId: 'name',
        value: 'row 3',
      });
    });

    for (const [rowId, count] of before) {
      expect(countFor(rowId)).toBe(count);
    }
  });

  it('does not re-render a row when an unrelated row is deleted', () => {
    const { source } = mount(makeRows(10));
    const untouched = countFor('r0');

    act(() => {
      source.applyPatch({ type: 'delete-row', rowId: 'r9' });
    });

    expect(countFor('r0')).toBe(untouched);
  });
});

describe('virtualization', () => {
  // The grid renders a window, not the dataset. Without this a 100k-row source
  // would mount 100k rows' worth of cells on the first paint.
  it('mounts a bounded number of rows regardless of dataset size', () => {
    mount(makeRows(100_000));

    expect(renders.size).toBeGreaterThan(0);
    expect(renders.size).toBeLessThan(60);
  });
});
