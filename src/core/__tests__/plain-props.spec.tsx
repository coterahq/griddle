import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGridStore } from '../../store';
import { DataGrid } from '../data-grid';
import { createDataGridViewModel } from '../view-model';
import type { DataGridColumn, DataGridColumnStats } from '../types';

/**
 * `rows` and `columnStats` accept a plain value as well as a store.
 *
 * The reason is ergonomic and it is the point of the softening: "here are 50
 * rows" should not require a caller to learn what a store is, or to build one
 * before they can see anything on screen. The store form stays for callers who
 * update from outside React and do not want to re-render the owner.
 *
 * Both forms have to reach exactly the same rendering, which is what these
 * assert — one path is not a degraded version of the other.
 */

type Row = { id: string; name: string };

const ROWS: Row[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
];

const COLUMNS: DataGridColumn<Row>[] = [
  { id: 'name', header: 'Name', width: 160, getValue: (row) => row.name },
];

const STATS: Record<string, DataGridColumnStats | undefined> = {
  name: { kind: 'summary', label: 'unique', value: 2 },
};

beforeEach(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = TestResizeObserver;
});

const renderGrid = (
  props: Partial<React.ComponentProps<typeof DataGrid<Row>>>
) =>
  render(
    <DataGrid<Row>
      getRowId={(row) => row.id}
      viewModel={createDataGridViewModel<Row>({ columns: COLUMNS })}
      {...props}
    />
  );

describe('plain-value props', () => {
  it('renders rows given as a plain array', () => {
    renderGrid({ rows: ROWS });
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('renders rows given as a store', () => {
    renderGrid({ rows: createGridStore(ROWS) });
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  // A plain array re-renders through its owner, so a new array on the next
  // render has to be picked up rather than captured once at mount.
  it('picks up a replaced plain array', () => {
    const view = renderGrid({ rows: ROWS });
    view.rerender(
      <DataGrid<Row>
        rows={[{ id: 'c', name: 'Gamma' }]}
        getRowId={(row) => row.id}
        viewModel={createDataGridViewModel<Row>({ columns: COLUMNS })}
      />
    );
    expect(screen.getByText('Gamma')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });

  // Headers start collapsed, so the stats band has to be opened before there
  // is anything to assert on — same gesture for both prop forms.
  const showStats = (): void => {
    fireEvent.click(screen.getByRole('button', { name: 'Show column stats' }));
  };

  it('renders column stats given as a plain record', () => {
    renderGrid({ rows: ROWS, columnStats: STATS });
    showStats();
    expect(screen.getByText('unique', { exact: false })).toBeInTheDocument();
  });

  it('renders column stats given as a store', () => {
    renderGrid({ rows: ROWS, columnStats: createGridStore(STATS) });
    showStats();
    expect(screen.getByText('unique', { exact: false })).toBeInTheDocument();
  });

  // No rows at all is a legitimate state — a grid that threw here would make
  // "render the chrome, then load" impossible.
  it('renders with neither rows nor a row source', () => {
    renderGrid({});
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });
});
