import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { JotaiProvider, Watchable } from '@cotera/client/v0/actions/framework';
import { PortalContainerProvider } from '@cotera/client/app/components/portal-container';
import { DataGrid } from '../data-grid';
import { createDataGridViewModel } from '../view-model';
import type { DataGridColumn } from '../types';

type TestRow = { id: string; name: string };

const ROWS: TestRow[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
  { id: 'c', name: 'Gamma' },
];

const COLUMNS: DataGridColumn<TestRow>[] = [
  { id: 'name', header: 'Name', width: 180, getValue: (row) => row.name },
];

const ROW_HEIGHT = 36;
const EXPANSION_HEIGHT = 120;
const getRowId = (row: TestRow) => row.id;

beforeEach(() => {
  class TestObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: TestObserver,
    writable: true,
  });
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    value: TestObserver,
    writable: true,
  });
});

const renderGrid = ({ withDetail = true }: { withDetail?: boolean } = {}) => {
  const rows = Watchable.fromValue(ROWS);
  const viewModel = createDataGridViewModel<TestRow>({
    columns: COLUMNS,
    rowHeight: ROW_HEIGHT,
    expansionHeight: EXPANSION_HEIGHT,
    totalRows: ROWS.length,
    totalLoadedRows: ROWS.length,
  });

  // JotaiProvider is required for the component to observe view-model
  // changes: `Watchable.set` writes to a module-level store, which `useAtom`
  // only reads through this provider. Without it the state updates but nothing
  // re-renders.
  const result = render(
    <JotaiProvider>
      <PortalContainerProvider>
        <div style={{ height: 600, width: 640 }}>
          <DataGrid
            rows={rows}
            getRowId={getRowId}
            viewModel={viewModel}
            renderRowDetail={
              withDetail
                ? (context) => (
                    <div data-testid={`detail-${context.rowId}`}>
                      Detail for {context.row.name}
                    </div>
                  )
                : undefined
            }
          />
        </div>
      </PortalContainerProvider>
    </JotaiProvider>
  );

  return { ...result, viewModel };
};

/** The absolute `top` the grid positioned a row's shell at. */
const rowTop = (name: string): number => {
  const row = screen.getByText(name).closest('[role="row"]');
  if (row === null) {
    throw new Error(`No row rendered for ${name}`);
  }
  return Number.parseFloat((row as HTMLElement).style.top);
};

describe('DataGrid row expansion', () => {
  it('shows no expand affordance without a detail renderer', () => {
    renderGrid({ withDetail: false });

    expect(screen.queryByLabelText('Expand row')).toBeNull();
  });

  it('opens a detail panel and pushes the rows below it down', () => {
    renderGrid();

    const betaTopBefore = rowTop('Beta');
    const gammaTopBefore = rowTop('Gamma');
    expect(screen.queryByTestId('detail-a')).toBeNull();

    fireEvent.click(screen.getAllByLabelText('Expand row')[0] as HTMLElement);

    expect(screen.getByTestId('detail-a').textContent).toBe('Detail for Alpha');
    // Everything after the expanded row moves by exactly one expansion, and
    // nothing else about the layout changes.
    expect(rowTop('Beta')).toBe(betaTopBefore + EXPANSION_HEIGHT);
    expect(rowTop('Gamma')).toBe(gammaTopBefore + EXPANSION_HEIGHT);
  });

  it('leaves the expanded row itself where it was', () => {
    renderGrid();

    const alphaTopBefore = rowTop('Alpha');
    fireEvent.click(screen.getAllByLabelText('Expand row')[0] as HTMLElement);

    expect(rowTop('Alpha')).toBe(alphaTopBefore);
  });

  it('collapses again, restoring the original offsets', () => {
    renderGrid();

    const gammaTopBefore = rowTop('Gamma');
    fireEvent.click(screen.getAllByLabelText('Expand row')[0] as HTMLElement);
    fireEvent.click(screen.getByLabelText('Collapse row'));

    expect(screen.queryByTestId('detail-a')).toBeNull();
    expect(rowTop('Gamma')).toBe(gammaTopBefore);
  });

  it('does not select the row when the chevron is clicked', () => {
    const { viewModel } = renderGrid();

    fireEvent.click(screen.getAllByLabelText('Expand row')[0] as HTMLElement);

    // The chevron lives inside the row-number gutter, which is itself a
    // select affordance — the click must not fall through to it.
    expect(viewModel.selectedRowIds.snapshot().size).toBe(0);
    expect(viewModel.expandedRowIds.snapshot().has('a')).toBe(true);
  });

  it('keeps the panel pinned to the left under horizontal scroll', () => {
    renderGrid();
    fireEvent.click(screen.getAllByLabelText('Expand row')[0] as HTMLElement);

    const sticky = screen.getByTestId('detail-a').parentElement;
    const container = sticky?.parentElement;

    // Asserted structurally because jsdom does not lay sticky out: the panel's
    // content is row-scoped rather than column-aligned, so scrolling it
    // sideways with the cells would only ever hide it.
    expect(sticky?.className).toContain('sticky');
    // And the container must not clip: a clipping overflow on an ancestor
    // becomes the sticky child's scrollport, which silently reintroduces the
    // slide it is meant to prevent.
    expect(container?.className).not.toContain('overflow-hidden');
    expect(container?.className).not.toContain('overflow-auto');
  });

  it('tracks expansion by row id, so stacked panels accumulate', () => {
    const { viewModel } = renderGrid();

    const gammaTopBefore = rowTop('Gamma');
    const chevrons = screen.getAllByLabelText('Expand row');
    fireEvent.click(chevrons[0] as HTMLElement);
    fireEvent.click(screen.getAllByLabelText('Expand row')[0] as HTMLElement);

    expect(viewModel.expandedRowIds.snapshot()).toEqual(new Set(['a', 'b']));
    expect(rowTop('Gamma')).toBe(gammaTopBefore + 2 * EXPANSION_HEIGHT);
  });
});
