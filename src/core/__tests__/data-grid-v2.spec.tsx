import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Watchable } from '@cotera/client/v0/actions/framework';
import { PortalContainerProvider } from '@cotera/client/app/components/portal-container';
import { getDataGridColumnLayout } from '../column-layout';
import { DataGrid } from '../data-grid';
import { getKeyboardAction } from '../keyboard';
import { getSelectionRange } from '../selection';
import { createDataGridViewModel } from '../view-model';
import { getVirtualizedColumns, getVirtualizedRange } from '../virtualization';
import type { DataGridColumn } from '../types';

type TestRow = {
  id: string;
  name: string;
  status: string;
  revenue: number;
};

const ROWS: TestRow[] = [
  { id: 'a', name: 'Alpha', status: 'Active', revenue: 10 },
  { id: 'b', name: 'Beta', status: 'Paused', revenue: 20 },
  { id: 'c', name: 'Gamma', status: 'Trial', revenue: 30 },
  { id: 'd', name: 'Delta', status: 'Active', revenue: 40 },
];

const COLUMNS: DataGridColumn<TestRow>[] = [
  {
    id: 'name',
    header: 'Name',
    width: 180,
    pinned: 'left',
    getValue: (row) => row.name,
  },
  {
    id: 'status',
    header: 'Status',
    width: 120,
    getValue: (row) => row.status,
  },
  {
    id: 'revenue',
    header: 'Revenue',
    width: 120,
    pinned: 'right',
    getValue: (row) => row.revenue,
    renderDetail: (context) => (
      <div>Revenue detail: {context.value as any}</div>
    ),
  },
];

const getRowId = (row: TestRow) => row.id;

beforeEach(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  class TestIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: TestResizeObserver,
    writable: true,
  });
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    value: TestIntersectionObserver,
    writable: true,
  });
});

const renderGrid = ({
  onSelectCell,
}: {
  onSelectCell?: Parameters<typeof DataGrid<TestRow>>[0]['onSelectCell'];
} = {}) => {
  const rows = Watchable.fromValue(ROWS);
  const viewModel = createDataGridViewModel<TestRow>({
    columns: COLUMNS,
    totalRows: ROWS.length,
    totalLoadedRows: ROWS.length,
  });

  const result = render(
    <PortalContainerProvider>
      <div style={{ height: 320, width: 640 }}>
        <DataGrid
          rows={rows}
          getRowId={getRowId}
          viewModel={viewModel}
          onSelectCell={onSelectCell}
        />
      </div>
    </PortalContainerProvider>
  );

  return { ...result, rows, viewModel };
};

describe('DataGrid v2 ViewModel', () => {
  it('updates focus, selection, ranges, widths, order, and pinning', () => {
    const viewModel = createDataGridViewModel<TestRow>({ columns: COLUMNS });

    viewModel.focusCell({
      rowId: 'b',
      rowIndex: 1,
      columnId: 'status',
      columnIndex: 1,
    });
    viewModel.selectOnly('b');
    viewModel.toggleRowSelection('c');
    viewModel.selectRowRange('b', 'd', ROWS, getRowId);
    viewModel.resizeColumn('status', 44);
    viewModel.reorderColumn('revenue', 'name');
    viewModel.pinColumn('status', 'right');
    viewModel.unpinColumn('name');
    viewModel.setSort('status', 'asc');
    viewModel.toggleSort('status', 'asc');
    viewModel.toggleSort('status', 'desc');
    viewModel.setFilter('status', 'Active');
    viewModel.selectCell({
      rowId: 'a',
      rowIndex: 0,
      columnId: 'name',
      columnIndex: 0,
    });
    viewModel.selectCellRange(
      { rowId: 'a', rowIndex: 0, columnId: 'name', columnIndex: 0 },
      { rowId: 'c', rowIndex: 2, columnId: 'status', columnIndex: 1 }
    );

    expect({
      focusedCell: viewModel.focusedCell.snapshot(),
      selectedRowIds: [...viewModel.selectedRowIds.snapshot()],
      selectedCellRanges: viewModel.selectedCellRanges.snapshot(),
      sorts: viewModel.sorts.snapshot(),
      filters: viewModel.filters.snapshot(),
      columns: viewModel.columns.snapshot().map((column) => ({
        id: column.id,
        width: column.width,
        pinned: column.pinned,
      })),
    }).toMatchObject({
      focusedCell: {
        rowId: 'c',
        rowIndex: 2,
        columnId: 'status',
        columnIndex: 1,
      },
      selectedRowIds: ['b', 'c', 'd'],
      selectedCellRanges: [
        {
          start: { rowId: 'a', rowIndex: 0, columnId: 'name', columnIndex: 0 },
          end: { rowId: 'c', rowIndex: 2, columnId: 'status', columnIndex: 1 },
        },
      ],
      sorts: [{ columnId: 'status', direction: 'desc' }],
      filters: [{ columnId: 'status', value: 'Active' }],
      columns: [
        { id: 'revenue', width: 120, pinned: 'right' },
        { id: 'name', width: 180, pinned: null },
        { id: 'status', width: 80, pinned: 'right' },
      ],
    });
  });
});

describe('DataGrid v2 layout and virtualization', () => {
  it('keeps canonical column indexes across pinned and regular columns', () => {
    const layout = getDataGridColumnLayout(COLUMNS);

    expect({
      rowNumber: layout.rowNumber,
      leftPinned: layout.leftPinned.map((item) => ({
        id: item.column.id,
        columnIndex: item.columnIndex,
        x: item.x,
      })),
      regular: layout.regular.map((item) => ({
        id: item.column.id,
        columnIndex: item.columnIndex,
      })),
      rightPinned: layout.rightPinned.map((item) => ({
        id: item.column.id,
        columnIndex: item.columnIndex,
      })),
      ariaColumnCount: layout.ariaColumnCount,
    }).toMatchObject({
      rowNumber: { columnIndex: 0, pinned: 'left' },
      leftPinned: [{ id: 'name', columnIndex: 0, x: 52 }],
      regular: [{ id: 'status', columnIndex: 1 }],
      rightPinned: [{ id: 'revenue', columnIndex: 2 }],
      ariaColumnCount: 4,
    });
  });

  it('computes fixed-height virtualized ranges with overscan', () => {
    expect(
      getVirtualizedRange({
        itemCount: 100,
        itemSize: 20,
        containerSize: 100,
        scrollOffset: 200,
        overscan: 2,
      })
    ).toMatchObject({
      startIndex: 8,
      endIndex: 17,
      visibleCount: 10,
      offsetY: 160,
      totalHeight: 2000,
    });
  });

  it('computes variable-width horizontal virtualization ranges', () => {
    const layout = getDataGridColumnLayout([
      ...COLUMNS,
      {
        id: 'extra1',
        header: 'Extra 1',
        width: 100,
        getValue: (row) => row.name,
      },
      {
        id: 'extra2',
        header: 'Extra 2',
        width: 100,
        getValue: (row) => row.status,
      },
      {
        id: 'extra3',
        header: 'Extra 3',
        width: 100,
        getValue: (row) => row.revenue,
      },
    ]);

    expect(
      getVirtualizedColumns({
        columns: layout.regular,
        containerSize: 150,
        scrollOffset: 130,
        overscan: 0,
      })
    ).toMatchObject({
      startIndex: 1,
      endIndex: 2,
      visibleCount: 2,
      offsetX: 352,
      totalWidth: 420,
    });
  });
});

describe('DataGrid v2 keyboard and selection', () => {
  it('treats Enter as activation rather than Home navigation', () => {
    expect(
      getKeyboardAction({
        key: 'Enter',
        focusedCell: {
          rowId: 'b',
          rowIndex: 1,
          columnId: 'status',
          columnIndex: 2,
        },
        rowCount: 4,
        columnCount: 3,
        pageSize: 2,
      })
    ).toMatchObject({ type: 'activate-focused-cell' });
  });

  it('computes shift-click selection ranges', () => {
    expect([
      ...getSelectionRange({ anchor: 'b', target: 'd', rows: ROWS, getRowId }),
    ]).toMatchObject(['b', 'c', 'd']);
  });

  it('keeps focus separate from selection and activates focused cell on Enter', async () => {
    const onSelectCell =
      vi.fn<
        NonNullable<Parameters<typeof DataGrid<TestRow>>[0]['onSelectCell']>
      >();
    const { viewModel } = renderGrid({ onSelectCell });

    const grid = screen.getByRole('grid');
    fireEvent.focus(grid);
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    fireEvent.keyDown(grid, { key: 'Enter' });

    await waitFor(() => {
      expect(onSelectCell).toHaveBeenCalledTimes(1);
    });
    expect({
      focusedCell: viewModel.focusedCell.snapshot(),
      selectedRowIds: [...viewModel.selectedRowIds.snapshot()],
      selectedContext: onSelectCell.mock.calls[0]?.[0].address,
    }).toMatchObject({
      focusedCell: {
        rowId: 'b',
        rowIndex: 1,
        columnId: 'status',
        columnIndex: 1,
      },
      selectedRowIds: [],
      selectedContext: {
        rowId: 'b',
        rowIndex: 1,
        columnId: 'status',
        columnIndex: 1,
      },
    });
  });
});

describe('DataGrid v2 overlays and loading', () => {
  it('opens detail overlays from cell commands and triggers lazy loading near the end', async () => {
    const rows = Watchable.fromValue(ROWS);
    const totalRows = Watchable.fromValue<number | null>(10);
    const hasMore = Watchable.fromValue(true);
    const isLoading = Watchable.fromValue(false);
    const loadMore = vi.fn();
    const viewModel = createDataGridViewModel<TestRow>({ columns: COLUMNS });

    render(
      <PortalContainerProvider>
        <div style={{ height: 320, width: 640 }}>
          <DataGrid
            rowSource={{ rows, totalRows, hasMore, isLoading, loadMore }}
            getRowId={getRowId}
            viewModel={viewModel}
          />
        </div>
      </PortalContainerProvider>
    );

    await waitFor(() => {
      expect(loadMore).toHaveBeenCalled();
    });

    fireEvent.doubleClick(screen.getByTitle('40'));

    await waitFor(() => {
      expect(screen.getByRole('dialog').textContent).toBe('Revenue detail: 40');
    });
  });
});

describe('DataGrid v2 column header actions', () => {
  it('renders a host control in its own column and nowhere else', () => {
    const rows = Watchable.fromValue(ROWS);
    const viewModel = createDataGridViewModel<TestRow>({ columns: COLUMNS });

    render(
      <PortalContainerProvider>
        <div style={{ height: 320, width: 640 }}>
          <DataGrid
            rows={rows}
            getRowId={getRowId}
            viewModel={viewModel}
            renderColumnHeaderActions={(context) =>
              context.column.id === 'status' ? (
                <button type="button">Run status</button>
              ) : null
            }
          />
        </div>
      </PortalContainerProvider>
    );

    expect(screen.getAllByRole('button', { name: 'Run status' })).toHaveLength(
      1
    );
  });

  it('leaves the sort alone when the control is clicked', () => {
    const rows = Watchable.fromValue(ROWS);
    const viewModel = createDataGridViewModel<TestRow>({ columns: COLUMNS });
    const onClick = vi.fn();

    render(
      <PortalContainerProvider>
        <div style={{ height: 320, width: 640 }}>
          <DataGrid
            rows={rows}
            getRowId={getRowId}
            viewModel={viewModel}
            renderColumnHeaderActions={(context) =>
              context.column.id === 'status' ? (
                <button type="button" onClick={onClick}>
                  Run status
                </button>
              ) : null
            }
          />
        </div>
      </PortalContainerProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run status' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(viewModel.sorts.snapshot()).toEqual([]);
  });
});
