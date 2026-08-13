import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGridStore } from '../../store';
import { DataGridPortalProvider } from '../../ui/portal';
import { DataGrid } from '../data-grid';
import { createDataGridViewModel } from '../view-model';
import type { DataGridCellEdit, DataGridColumn } from '../types';

type EditRow = { id: string; name: string; score: number; ratio: number };

const ROWS: EditRow[] = [
  { id: 'a', name: 'Alpha', score: 10, ratio: 0.5 },
  { id: 'b', name: 'Beta', score: 20, ratio: 0.25 },
];

const COLUMNS: DataGridColumn<EditRow>[] = [
  {
    id: 'name',
    header: 'Name',
    type: 'text',
    width: 160,
    editable: true,
    getValue: (row) => row.name,
  },
  {
    id: 'score',
    header: 'Score',
    type: 'number',
    width: 140,
    editable: true,
    getValue: (row) => row.score,
  },
  {
    id: 'ratio',
    header: 'Ratio',
    type: 'number',
    width: 140,
    // Computed columns are never editable, even when `editable` is set.
    computed: true,
    editable: true,
    getValue: (row) => row.ratio,
  },
];

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

const renderGrid = ({
  onCellEdit,
  onSaveEdits,
  onRevertEdits,
  autoSaveEdits,
}: {
  onCellEdit?: (edit: DataGridCellEdit) => void;
  onSaveEdits?: (edits: DataGridCellEdit[]) => void | Promise<void>;
  onRevertEdits?: (edits: DataGridCellEdit[]) => void | Promise<void>;
  autoSaveEdits?: boolean;
} = {}) => {
  const rows = createGridStore(ROWS);
  const viewModel = createDataGridViewModel<EditRow>({ columns: COLUMNS });

  const result = render(
    <DataGridPortalProvider>
      <div style={{ height: 320, width: 800 }}>
        <DataGrid
          rows={rows}
          getRowId={(row) => row.id}
          viewModel={viewModel}
          onCellEdit={onCellEdit}
          onSaveEdits={onSaveEdits}
          onRevertEdits={onRevertEdits}
          autoSaveEdits={autoSaveEdits}
        />
      </div>
    </DataGridPortalProvider>
  );

  return { ...result, viewModel };
};

const cell = (value: string) => screen.getByTitle(value);
const editor = () => screen.getByLabelText('Edit cell');

describe('DataGrid cell editing', () => {
  it('edits in place on double click and commits on Enter', async () => {
    const onCellEdit = vi.fn<(edit: DataGridCellEdit) => void>();
    const { viewModel } = renderGrid({ onCellEdit });

    fireEvent.doubleClick(cell('Alpha'));
    fireEvent.change(await screen.findByLabelText('Edit cell'), {
      target: { value: 'Renamed' },
    });
    fireEvent.keyDown(editor(), { key: 'Enter' });

    await waitFor(() => {
      expect(onCellEdit).toHaveBeenCalledWith({
        rowId: 'a',
        columnId: 'name',
        previousValue: 'Alpha',
        value: 'Renamed',
      });
    });
    expect({
      editing: viewModel.editingCell.snapshot(),
      pending: Object.values(viewModel.pendingEdits.snapshot()),
    }).toMatchObject({
      editing: null,
      pending: [{ rowId: 'a', columnId: 'name', value: 'Renamed' }],
    });
  });

  it('parses numeric editors as numbers', async () => {
    const onCellEdit = vi.fn<(edit: DataGridCellEdit) => void>();
    renderGrid({ onCellEdit });

    fireEvent.doubleClick(cell('10'));
    fireEvent.change(await screen.findByLabelText('Edit cell'), {
      target: { value: '42' },
    });
    fireEvent.keyDown(editor(), { key: 'Enter' });

    await waitFor(() => {
      expect(onCellEdit).toHaveBeenCalledWith(
        expect.objectContaining({ columnId: 'score', value: 42 })
      );
    });
  });

  it('discards the edit on Escape', async () => {
    const { viewModel } = renderGrid();

    fireEvent.doubleClick(cell('Alpha'));
    fireEvent.change(await screen.findByLabelText('Edit cell'), {
      target: { value: 'Nope' },
    });
    fireEvent.keyDown(editor(), { key: 'Escape' });

    await waitFor(() => {
      expect(viewModel.editingCell.snapshot()).toBeNull();
    });
    expect(Object.values(viewModel.pendingEdits.snapshot())).toMatchObject([]);
  });

  it('clears the dirty flag when a cell goes back to its original value', async () => {
    const { viewModel } = renderGrid();

    fireEvent.doubleClick(cell('Alpha'));
    fireEvent.change(await screen.findByLabelText('Edit cell'), {
      target: { value: 'Renamed' },
    });
    fireEvent.keyDown(editor(), { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain(
        '1 unsaved edit'
      );
    });

    // The grid records edits; applying them to the rows is the host's job, so
    // the cell still renders the loaded value here.
    fireEvent.doubleClick(cell('Alpha'));
    fireEvent.change(await screen.findByLabelText('Edit cell'), {
      target: { value: 'Alpha' },
    });
    fireEvent.keyDown(editor(), { key: 'Enter' });

    await waitFor(() => {
      expect(Object.values(viewModel.pendingEdits.snapshot())).toMatchObject(
        []
      );
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('marks computed columns fx and refuses to edit them', () => {
    renderGrid();

    expect(screen.getByLabelText('Computed column')).toBeTruthy();

    fireEvent.doubleClick(cell('0.5'));
    expect(screen.queryByLabelText('Edit cell')).toBeNull();
  });

  it('saves pending edits and clears them once the handler resolves', async () => {
    const onSaveEdits = vi.fn().mockResolvedValue(undefined);
    const { viewModel } = renderGrid({ onSaveEdits });

    fireEvent.doubleClick(cell('Alpha'));
    fireEvent.change(await screen.findByLabelText('Edit cell'), {
      target: { value: 'Renamed' },
    });
    fireEvent.keyDown(editor(), { key: 'Enter' });

    const bar = await screen.findByRole('status');
    expect(bar.textContent).toContain('1 unsaved edit');

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(onSaveEdits).toHaveBeenCalledWith([
        {
          rowId: 'a',
          columnId: 'name',
          previousValue: 'Alpha',
          value: 'Renamed',
        },
      ]);
    });
    await waitFor(() => {
      expect(Object.values(viewModel.pendingEdits.snapshot())).toMatchObject(
        []
      );
    });
  });

  it('keeps pending edits when saving fails', async () => {
    const onSaveEdits = vi.fn().mockRejectedValue(new Error('nope'));
    const { viewModel } = renderGrid({ onSaveEdits });

    fireEvent.doubleClick(cell('Alpha'));
    fireEvent.change(await screen.findByLabelText('Edit cell'), {
      target: { value: 'Renamed' },
    });
    fireEvent.keyDown(editor(), { key: 'Enter' });
    await screen.findByRole('status');

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(onSaveEdits).toHaveBeenCalled();
    });
    expect(Object.values(viewModel.pendingEdits.snapshot())).toMatchObject([
      { columnId: 'name', value: 'Renamed' },
    ]);
  });

  it('auto-saves each edit and never shows the banner', async () => {
    const onSaveEdits = vi.fn().mockResolvedValue(undefined);
    const { viewModel } = renderGrid({ onSaveEdits, autoSaveEdits: true });

    fireEvent.doubleClick(cell('Alpha'));
    fireEvent.change(await screen.findByLabelText('Edit cell'), {
      target: { value: 'Renamed' },
    });
    fireEvent.keyDown(editor(), { key: 'Enter' });

    await waitFor(() => {
      expect(onSaveEdits).toHaveBeenCalledWith([
        {
          rowId: 'a',
          columnId: 'name',
          previousValue: 'Alpha',
          value: 'Renamed',
        },
      ]);
    });
    // No pending state lingers, so no cell reads as dirty and no banner shows.
    expect(Object.values(viewModel.pendingEdits.snapshot())).toMatchObject([]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not auto-save an edit that round-trips back to the original', async () => {
    const onSaveEdits = vi.fn().mockResolvedValue(undefined);
    renderGrid({ onSaveEdits, autoSaveEdits: true });

    fireEvent.doubleClick(cell('Alpha'));
    fireEvent.change(await screen.findByLabelText('Edit cell'), {
      target: { value: 'Alpha' },
    });
    fireEvent.keyDown(editor(), { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByLabelText('Edit cell')).toBeNull();
    });
    expect(onSaveEdits).not.toHaveBeenCalled();
  });

  it('hands the original values back to the revert handler', async () => {
    const onRevertEdits = vi.fn().mockResolvedValue(undefined);
    renderGrid({ onRevertEdits });

    fireEvent.doubleClick(cell('Alpha'));
    fireEvent.change(await screen.findByLabelText('Edit cell'), {
      target: { value: 'Renamed' },
    });
    fireEvent.keyDown(editor(), { key: 'Enter' });
    await screen.findByRole('status');

    fireEvent.click(screen.getByRole('button', { name: 'Revert' }));

    await waitFor(() => {
      expect(onRevertEdits).toHaveBeenCalledWith([
        expect.objectContaining({ previousValue: 'Alpha', value: 'Renamed' }),
      ]);
    });
  });
});
