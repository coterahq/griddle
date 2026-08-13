import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { JotaiProvider, Watchable } from '@cotera/client/v0/actions/framework';
import { PortalContainerProvider } from '@cotera/client/app/components/portal-container';
import {
  ModalManager,
  ModalManagerProvider,
} from '@cotera/client/app/components/app/modal-manager/modal-manager';
import { DataGrid } from '../data-grid';
import { createDataGridViewModel } from '../view-model';
import type { DataGridColumn } from '../types';

type Row = { id: string; name: string; revenue: number; active: boolean };

const ROWS: Row[] = [
  { id: 'a', name: 'Alpha', revenue: 10, active: true },
  { id: 'b', name: 'Beta', revenue: 20, active: false },
];

const COLUMNS: DataGridColumn<Row>[] = [
  {
    id: 'name',
    header: 'Name',
    type: 'text',
    width: 160,
    filterable: true,
    getValue: (row) => row.name,
  },
  {
    id: 'revenue',
    header: 'Revenue',
    type: 'number',
    width: 160,
    filterable: true,
    getValue: (row) => row.revenue,
  },
  {
    id: 'active',
    header: 'Active',
    type: 'boolean',
    width: 160,
    filterable: true,
    getValue: (row) => row.active,
  },
];

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

const renderGrid = ({ withModalManager = false } = {}) => {
  const rows = Watchable.fromValue(ROWS);
  const viewModel = createDataGridViewModel<Row>({
    columns: COLUMNS,
    totalRows: ROWS.length,
    totalLoadedRows: ROWS.length,
  });

  const grid = (
    <div style={{ height: 320, width: 800 }}>
      <DataGrid rows={rows} getRowId={(row) => row.id} viewModel={viewModel} />
    </div>
  );

  const result = render(
    <JotaiProvider>
      <PortalContainerProvider>
        {withModalManager ? (
          <ModalManagerProvider>
            {grid}
            <ModalManager />
          </ModalManagerProvider>
        ) : (
          grid
        )}
      </PortalContainerProvider>
    </JotaiProvider>
  );

  return { ...result, viewModel };
};

const openFilterForm = async (label: string) => {
  const trigger = screen.getByRole('button', {
    name: `${label} column options`,
  });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  await screen.findByRole('menu');
  fireEvent.click(screen.getByRole('menuitem', { name: /Filter…/ }));
  return screen.findByRole('button', { name: 'Apply filter' });
};

describe('DataGrid column filtering', () => {
  it('filters a number column with a numeric input and a comparison', async () => {
    const { viewModel } = renderGrid();

    await openFilterForm('Revenue');
    fireEvent.click(screen.getByRole('radio', { name: '≥' }));

    const input = screen.getByLabelText('Value');
    expect(input.getAttribute('type')).toBe('number');
    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filter' }));

    await waitFor(() => {
      expect(viewModel.filters.snapshot()).toMatchObject([
        {
          columnId: 'revenue',
          value: {
            kind: 'compare',
            comparison: 'greaterThanOrEqual',
            value: 15,
          },
        },
      ]);
    });
  });

  it('filters a boolean column with a true/false choice and no value input', async () => {
    const { viewModel } = renderGrid();

    await openFilterForm('Active');
    expect(screen.queryByLabelText('Value')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'False' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply filter' }));

    await waitFor(() => {
      expect(viewModel.filters.snapshot()).toMatchObject([
        {
          columnId: 'active',
          value: { kind: 'compare', comparison: 'equals', value: false },
        },
      ]);
    });
  });

  it('defaults text columns to a substring match and hides the operand for emptiness', async () => {
    const { viewModel } = renderGrid();

    await openFilterForm('Name');
    expect(
      screen
        .getByRole('radio', { name: 'Contains' })
        .getAttribute('aria-checked')
    ).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: 'Empty' }));
    expect(screen.queryByLabelText('Value')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Apply filter' }));

    await waitFor(() => {
      expect(viewModel.filters.snapshot()).toMatchObject([
        {
          columnId: 'name',
          value: { kind: 'compare', comparison: 'isNull' },
        },
      ]);
    });
  });

  it('reopens on the filter that is already applied, and describes it on the chip', async () => {
    renderGrid();

    await openFilterForm('Revenue');
    fireEvent.click(screen.getByRole('radio', { name: '<' }));
    fireEvent.change(screen.getByLabelText('Value'), {
      target: { value: '15' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filter' }));

    const chip = await screen.findByRole('button', {
      name: 'Clear Revenue filter',
    });
    expect(chip.textContent).toContain('< 15');

    const trigger = screen.getByRole('button', {
      name: 'Revenue column options',
    });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: /Edit filter…/ }));

    await screen.findByRole('button', { name: 'Apply filter' });
    expect(
      screen.getByRole('radio', { name: '<' }).getAttribute('aria-checked')
    ).toBe('true');
    expect(screen.getByLabelText('Value').getAttribute('value')).toBe('15');
  });

  it('shows the form in the app modal stack when one is mounted', async () => {
    const { viewModel } = renderGrid({ withModalManager: true });

    await openFilterForm('Revenue');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Filter')).toBeTruthy();
    // The stack hosts it, so the component's own fallback dialog stays out.
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();

    fireEvent.change(within(dialog).getByLabelText('Value'), {
      target: { value: '20' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Apply filter' })
    );

    await waitFor(() => {
      expect(viewModel.filters.snapshot()).toMatchObject([
        {
          columnId: 'revenue',
          value: { kind: 'compare', comparison: 'equals', value: 20 },
        },
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Apply filter' })).toBeNull();
    });
  });
});
