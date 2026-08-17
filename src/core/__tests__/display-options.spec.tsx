import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DataGrid } from '../data-grid';
import { createDataGridViewModel } from '../view-model';
import type { DataGridColumn } from '../types';

/**
 * The display-options dialog offers number formatting, a decimal count and an
 * in-cell bar. All three read a numeric value, so on a text or date column
 * they are controls a user can operate and watch do nothing.
 *
 * Alignment applies to every column and always shows.
 */

type Row = { id: string; name: string; total: number; placedAt: string };

const COLUMNS: DataGridColumn<Row>[] = [
  {
    id: 'name',
    header: 'Name',
    type: 'text',
    width: 140,
    getValue: (r) => r.name,
  },
  {
    id: 'total',
    header: 'Total',
    type: 'number',
    width: 140,
    getValue: (r) => r.total,
  },
  {
    id: 'placedAt',
    header: 'Placed',
    type: 'date',
    width: 140,
    getValue: (r) => r.placedAt,
  },
  // No declared type: the formatter decides from the value at runtime, so the
  // numeric controls stay available.
  { id: 'untyped', header: 'Untyped', width: 140, getValue: (r) => r.total },
];

const ROWS: Row[] = [
  { id: 'a', name: 'Alpha', total: 10, placedAt: '2025-01-05' },
];

beforeEach(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = TestResizeObserver;
});

// Radix opens its menu on a keyboard/pointer gesture rather than a plain
// click, which is the same dance the filtering specs do.
const openDisplayOptions = async (column: string): Promise<void> => {
  render(
    <DataGrid<Row>
      rows={ROWS}
      getRowId={(row) => row.id}
      viewModel={createDataGridViewModel<Row>({ columns: COLUMNS })}
    />
  );
  const trigger = screen.getByRole('button', {
    name: `${column} column options`,
  });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  await screen.findByRole('menu');
  fireEvent.click(screen.getByRole('menuitem', { name: /Display options…/ }));
  await screen.findByText('Alignment');
};

describe('display options offered per column type', () => {
  it('offers number formatting on a number column', async () => {
    await openDisplayOptions('Total');

    expect(screen.getByText('Number format')).toBeInTheDocument();
    expect(screen.getByText('Decimals')).toBeInTheDocument();
    expect(screen.getByText('In-cell bar')).toBeInTheDocument();
    expect(screen.getByText('Alignment')).toBeInTheDocument();
  });

  it('hides number formatting on a text column', async () => {
    await openDisplayOptions('Name');

    expect(screen.queryByText('Number format')).not.toBeInTheDocument();
    expect(screen.queryByText('Decimals')).not.toBeInTheDocument();
    expect(screen.queryByText('In-cell bar')).not.toBeInTheDocument();
    // Alignment is meaningful for every column.
    expect(screen.getByText('Alignment')).toBeInTheDocument();
  });

  it('hides number formatting on a date column', async () => {
    await openDisplayOptions('Placed');

    expect(screen.queryByText('Number format')).not.toBeInTheDocument();
    expect(screen.getByText('Alignment')).toBeInTheDocument();
  });

  // A column that never declared a type can still hold numbers.
  it('keeps number formatting on an untyped column', async () => {
    await openDisplayOptions('Untyped');

    expect(screen.getByText('Number format')).toBeInTheDocument();
  });

  it('previews a sample string instead of a number on a text column', async () => {
    await openDisplayOptions('Name');

    expect(screen.getByText('Sample value')).toBeInTheDocument();
  });
});

/**
 * Per-instance theming.
 *
 * `.cotera-griddle` declares the nine defaults and the grid root carries that
 * class, so a token set on an ancestor loses to the grid's own declaration —
 * a declaration on an element always beats an inherited value. The `style`
 * prop is the way in, because an inline style beats every stylesheet rule.
 */
describe('style prop', () => {
  const renderGrid = (style?: React.CSSProperties) =>
    render(
      <DataGrid<Row>
        rows={ROWS}
        getRowId={(row) => row.id}
        viewModel={createDataGridViewModel<Row>({ columns: COLUMNS })}
        {...(style === undefined ? {} : { style })}
      />
    );

  it('lands custom properties on the element that carries the theme class', () => {
    renderGrid({ '--dg-accent': '#b45309' } as React.CSSProperties);

    const grid = screen.getByRole('grid');
    expect(grid.className).toContain('cotera-griddle');
    expect(grid.style.getPropertyValue('--dg-accent')).toBe('#b45309');
  });

  it('keeps the geometry mirrors the grid sets for itself', () => {
    renderGrid({ '--dg-accent': 'red' } as React.CSSProperties);

    expect(
      screen.getByRole('grid').style.getPropertyValue('--dg-row-height')
    ).not.toBe('');
  });

  // Last write wins, so a caller can override the geometry too.
  it('lets the caller override a geometry mirror', () => {
    renderGrid({ '--dg-row-height': '99px' } as React.CSSProperties);

    expect(
      screen.getByRole('grid').style.getPropertyValue('--dg-row-height')
    ).toBe('99px');
  });

  /*
   * Every surface that paints a background paints a foreground too.
   *
   * Otherwise the grid inherits the host page's text colour, and a dark theme
   * on a light page is dark text on a dark grid — legible only by accident,
   * whenever the page and the theme happen to agree.
   */
  it('sets its own text colour, not just its background', () => {
    renderGrid();

    const grid = screen.getByRole('grid');
    expect(grid.className).toContain('bg-(--dg-bg)');
    expect(grid.className).toContain('text-(color:--dg-fg)');
  });

  it('sets the geometry mirrors with no style prop at all', () => {
    renderGrid();

    expect(
      screen.getByRole('grid').style.getPropertyValue('--dg-column-width')
    ).toBe('160px');
  });
});
