import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JotaiProvider, Watchable } from '@cotera/client/v0/actions/framework';
import { PortalContainerProvider } from '@cotera/client/app/components/portal-container';
import { DataGrid } from '../data-grid';
import {
  filterSelectsValue,
  toggleBetweenFilterValue,
  toggleInFilterValue,
} from '../filters';
import { createDataGridViewModel } from '../view-model';
import type { DataGridColumn, DataGridColumnStats } from '../types';

type StatsRow = { id: string; status: string; share: number };

const ROWS: StatsRow[] = [
  { id: 'a', status: 'Active', share: 10 },
  { id: 'b', status: 'Paused', share: 20 },
];

const getRowId = (row: StatsRow) => row.id;

const CATEGORICAL_STATS: DataGridColumnStats = {
  kind: 'categorical',
  buckets: [
    {
      key: 'Active',
      label: 'Active',
      count: 8,
      filter: { kind: 'in', values: ['Active'] },
    },
    {
      key: 'Paused',
      label: 'Paused',
      count: 2,
      filter: { kind: 'in', values: ['Paused'] },
    },
  ],
  nullCount: 0,
  otherCount: 0,
};

const NUMERIC_STATS: DataGridColumnStats = {
  kind: 'numericDistribution',
  min: 0,
  max: 20,
  mean: 15,
  nullCount: 0,
  buckets: [
    {
      key: 'bucket-0',
      label: '0 – 10',
      count: 4,
      filter: { kind: 'between', min: 0, max: 10 },
    },
    {
      key: 'bucket-1',
      label: '10 – 20',
      count: 6,
      filter: { kind: 'between', min: 10, max: 20, inclusiveMax: true },
    },
  ],
};

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

const wideColumns = (count: number): DataGridColumn<StatsRow>[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `col${index}`,
    header: `Col ${index}`,
    width: 200,
    getValue: (row: StatsRow) => row.status,
  }));

const renderGrid = ({
  columns,
  columnStats,
  onHeaderStatsVisible,
}: {
  columns: DataGridColumn<StatsRow>[];
  columnStats?: Record<string, DataGridColumnStats | undefined>;
  onHeaderStatsVisible?: (columnId: string) => void;
}) => {
  const rows = Watchable.fromValue(ROWS);
  const viewModel = createDataGridViewModel<StatsRow>({
    columns,
    totalRows: ROWS.length,
    totalLoadedRows: ROWS.length,
  });
  const stats = Watchable.fromValue<
    Record<string, DataGridColumnStats | undefined>
  >(columnStats ?? {});

  const result = render(
    <JotaiProvider>
      <PortalContainerProvider>
        <div style={{ height: 320, width: 800 }}>
          <DataGrid
            rows={rows}
            getRowId={getRowId}
            viewModel={viewModel}
            columnStats={stats}
            onHeaderStatsVisible={onHeaderStatsVisible}
          />
        </div>
      </PortalContainerProvider>
    </JotaiProvider>
  );

  return { ...result, viewModel, rows };
};

const openColumnMenu = async (label: string) => {
  const trigger = screen.getByRole('button', {
    name: `${label} column options`,
  });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  await screen.findByRole('menu');
};

describe('DataGrid header presentation', () => {
  it('shows sort direction and a multi-sort priority badge', () => {
    const columns: DataGridColumn<StatsRow>[] = [
      { id: 'status', header: 'Status', width: 160, getValue: (r) => r.status },
      {
        id: 'share',
        header: 'Share',
        type: 'number',
        width: 160,
        getValue: (r) => r.share,
      },
    ];
    const { viewModel } = renderGrid({ columns });

    act(() => {
      viewModel.setSort('status', 'asc');
      viewModel.setSort('share', 'desc');
    });

    // The first columnheader is the row-number gutter.
    const headers = screen.getAllByRole('columnheader').slice(1);
    expect(
      headers.map((header) => header.getAttribute('aria-sort'))
    ).toMatchObject(['ascending', 'descending']);
    expect(screen.getByLabelText('Sort priority 1')).toBeTruthy();
    expect(screen.getByLabelText('Sort priority 2')).toBeTruthy();
  });

  it('runs dropdown commands without also sorting on the trigger click', async () => {
    const columns: DataGridColumn<StatsRow>[] = [
      {
        id: 'status',
        header: 'Status',
        width: 160,
        filterable: true,
        getValue: (r) => r.status,
      },
    ];
    const { viewModel } = renderGrid({ columns });

    await openColumnMenu('Status');
    expect(viewModel.sorts.snapshot()).toMatchObject([]);

    fireEvent.click(screen.getByRole('menuitem', { name: /Sort descending/ }));
    await waitFor(() => {
      expect(viewModel.sorts.snapshot()).toMatchObject([
        { columnId: 'status', direction: 'desc' },
      ]);
    });

    await openColumnMenu('Status');
    fireEvent.click(screen.getByRole('menuitem', { name: /Pin left/ }));
    await waitFor(() => {
      expect(
        viewModel.columns.snapshot().map((column) => column.pinned)
      ).toMatchObject(['left']);
    });
  });

  it('surfaces hidden columns as top-bar badges that restore them', async () => {
    const columns: DataGridColumn<StatsRow>[] = [
      { id: 'status', header: 'Status', width: 160, getValue: (r) => r.status },
      { id: 'share', header: 'Share', width: 160, getValue: (r) => r.share },
    ];
    const { viewModel } = renderGrid({ columns });

    expect(
      screen.queryByRole('button', { name: 'Show Share column' })
    ).toBeNull();

    await openColumnMenu('Share');
    fireEvent.click(screen.getByRole('menuitem', { name: /Hide column/ }));

    const badge = await screen.findByRole('button', {
      name: 'Show Share column',
    });
    expect(screen.queryByRole('columnheader', { name: /Share/ })).toBeNull();

    fireEvent.click(badge);
    await waitFor(() => {
      expect(
        viewModel.columns.snapshot().map((column) => column.visible)
      ).toMatchObject([undefined, true]);
    });
    expect(screen.getByRole('columnheader', { name: /Share/ })).toBeTruthy();
  });

  it('shows footer counts, a no-sort hint, and clearable sort chips', async () => {
    const columns: DataGridColumn<StatsRow>[] = [
      { id: 'status', header: 'Status', width: 160, getValue: (r) => r.status },
      { id: 'share', header: 'Share', width: 160, getValue: (r) => r.share },
    ];
    const { viewModel, container } = renderGrid({ columns });

    expect(container.textContent).toContain('2 columns');
    expect(container.textContent).toContain('No sort');

    act(() => viewModel.setSort('share', 'desc'));

    const chip = await screen.findByRole('button', {
      name: 'Clear Share sort',
    });
    fireEvent.click(chip);
    await waitFor(() => {
      expect(viewModel.sorts.snapshot()).toMatchObject([]);
    });
    expect(container.textContent).toContain('No sort');
  });
});

describe('DataGrid keyboard handling', () => {
  // Footer/top-bar inputs live inside the grid root, so their keystrokes bubble
  // into the navigation handler, which preventDefault()s Space, Enter, arrows
  // and Home/End.
  it('leaves keystrokes alone when they come from a text input', () => {
    const columns: DataGridColumn<StatsRow>[] = [
      { id: 'status', header: 'Status', width: 160, getValue: (r) => r.status },
    ];
    const rows = Watchable.fromValue(ROWS);
    const viewModel = createDataGridViewModel<StatsRow>({ columns });

    render(
      <JotaiProvider>
        <PortalContainerProvider>
          <DataGrid
            rows={rows}
            getRowId={getRowId}
            viewModel={viewModel}
            FooterComponent={() => (
              <input aria-label="Ad-hoc query" defaultValue="" />
            )}
          />
        </PortalContainerProvider>
      </JotaiProvider>
    );

    const input = screen.getByLabelText('Ad-hoc query');
    const grid = screen.getByRole('grid');

    // fireEvent returns false when the handler called preventDefault().
    expect({
      spaceInInput: fireEvent.keyDown(input, { key: ' ' }),
      enterInInput: fireEvent.keyDown(input, { key: 'Enter' }),
      arrowInInput: fireEvent.keyDown(input, { key: 'ArrowLeft' }),
      spaceOnGrid: fireEvent.keyDown(grid, { key: ' ' }),
    }).toMatchObject({
      spaceInInput: true,
      enterInInput: true,
      arrowInInput: true,
      spaceOnGrid: false,
    });
  });
});

describe('DataGrid pinned column positioning', () => {
  // Pinning is done per side, not per column: one sticky group holds the
  // pinned columns in normal flow. Sticking each cell instead would leave the
  // band transparent, so the regular columns scrolling under it show through.
  it('sticks one group per side and lays its columns out in a horizontal flow', () => {
    const columns: DataGridColumn<StatsRow>[] = [
      {
        id: 'species',
        header: 'Species',
        width: 160,
        pinned: 'left',
        getValue: (r) => r.status,
      },
      {
        id: 'island',
        header: 'Island',
        width: 160,
        pinned: 'left',
        getValue: (r) => r.status,
      },
      { id: 'body', header: 'Body', width: 160, getValue: (r) => r.share },
      {
        id: 'mass',
        header: 'Mass',
        width: 120,
        pinned: 'right',
        getValue: (r) => r.share,
      },
    ];
    renderGrid({ columns });

    const headerFor = (name: string) =>
      screen.getByRole('columnheader', { name: new RegExp(name) });

    const gutter = screen.getAllByRole('columnheader')[0];
    const leftGroup = gutter?.parentElement;
    const headerBar = leftGroup?.parentElement;
    const rightGroup = headerFor('Mass').parentElement;

    expect(headerBar?.style.display).toBe('flex');
    // The regular column is absolutely positioned, so it stays a child of the
    // bar rather than joining either group's flow.
    expect(headerFor('Body').parentElement).toBe(headerBar);

    expect({
      leftGroup: {
        position: leftGroup?.style.position,
        left: leftGroup?.style.left,
        top: leftGroup?.style.top,
        width: leftGroup?.style.width,
        display: leftGroup?.style.display,
      },
      rightGroup: {
        position: rightGroup?.style.position,
        right: rightGroup?.style.right,
        marginLeft: rightGroup?.style.marginLeft,
        width: rightGroup?.style.width,
      },
      species: {
        position: headerFor('Species').style.position,
        width: headerFor('Species').style.width,
        flexShrink: headerFor('Species').style.flexShrink,
      },
      island: { position: headerFor('Island').style.position },
      body: {
        position: headerFor('Body').style.position,
        left: headerFor('Body').style.left,
      },
      mass: { position: headerFor('Mass').style.position },
    }).toMatchObject({
      // Gutter (52) + both left-pinned columns (160 each). No vertical offset:
      // a `top` would let the band slide within its row.
      leftGroup: {
        position: 'sticky',
        left: '0px',
        top: '',
        width: '372px',
        display: 'flex',
      },
      // Pushed to the end of the flow line, past the absolute regular columns.
      rightGroup: {
        position: 'sticky',
        right: '0px',
        marginLeft: 'auto',
        width: '120px',
      },
      species: { position: 'relative', width: '160px', flexShrink: '0' },
      island: { position: 'relative' },
      body: { position: 'absolute', left: '372px' },
      mass: { position: 'relative' },
    });
  });

  it('omits the right group entirely when nothing is pinned right', () => {
    const columns: DataGridColumn<StatsRow>[] = [
      {
        id: 'species',
        header: 'Species',
        width: 160,
        pinned: 'left',
        getValue: (r) => r.status,
      },
      { id: 'body', header: 'Body', width: 160, getValue: (r) => r.share },
    ];
    renderGrid({ columns });

    const headerBar =
      screen.getAllByRole('columnheader')[0]?.parentElement?.parentElement;
    const stickyGroups = Array.from(headerBar?.children ?? []).filter(
      (child) =>
        child instanceof HTMLElement && child.style.position === 'sticky'
    );
    expect(stickyGroups).toHaveLength(1);
  });

  it('gives rows the same horizontal flow so pinned cells track their row', () => {
    const columns: DataGridColumn<StatsRow>[] = [
      {
        id: 'species',
        header: 'Species',
        width: 160,
        pinned: 'left',
        getValue: (r) => r.status,
      },
      { id: 'body', header: 'Body', width: 160, getValue: (r) => r.share },
    ];
    renderGrid({ columns });

    const row = screen.getAllByRole('row')[0];
    expect(row?.style.display).toBe('flex');

    const pinnedCell = screen.getByTitle('Active');
    const pinnedGroup = pinnedCell.parentElement;
    expect({
      cell: {
        position: pinnedCell.style.position,
        width: pinnedCell.style.width,
      },
      group: {
        parent: pinnedGroup?.parentElement === row,
        position: pinnedGroup?.style.position,
        left: pinnedGroup?.style.left,
        top: pinnedGroup?.style.top,
        width: pinnedGroup?.style.width,
      },
    }).toMatchObject({
      cell: { position: 'relative', width: '160px' },
      group: {
        parent: true,
        position: 'sticky',
        left: '0px',
        top: '',
        width: '212px',
      },
    });
  });

  // The stripe is translucent, so the pinned band paints its own opaque base
  // and then repeats the tint on top. Without the base, the regular columns
  // sliding underneath read straight through the pinned cells.
  it('backs the pinned band with an opaque surface carrying the row tint', () => {
    const columns: DataGridColumn<StatsRow>[] = [
      {
        id: 'species',
        header: 'Species',
        width: 160,
        pinned: 'left',
        getValue: (r) => r.status,
      },
      { id: 'body', header: 'Body', width: 160, getValue: (r) => r.share },
    ];
    renderGrid({ columns });

    const rows = screen.getAllByRole('row');
    const groupFor = (rowIndex: number) =>
      rows[rowIndex]?.firstElementChild as HTMLElement | null;

    expect({
      evenBase: groupFor(0)?.className,
      evenTint: groupFor(0)?.firstElementChild?.className,
      oddTint: groupFor(1)?.firstElementChild?.className,
    }).toMatchObject({
      evenBase: expect.stringContaining('bg-background'),
      // Even rows take the base colour, so there is no tint layer to draw.
      evenTint: expect.not.stringContaining('bg-muted/20'),
      oddTint: expect.stringContaining('bg-muted/20'),
    });
  });
});

describe('DataGrid lazy stats headers', () => {
  it('starts collapsed and only requests stats for rendered columns', async () => {
    const onHeaderStatsVisible = vi.fn();
    renderGrid({ columns: wideColumns(20), onHeaderStatsVisible });

    expect(onHeaderStatsVisible).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Show column stats' }));

    await waitFor(() => {
      expect(onHeaderStatsVisible).toHaveBeenCalled();
    });
    const requested = new Set(
      onHeaderStatsVisible.mock.calls.map((call) => call[0] as string)
    );
    expect(requested.has('col0')).toBe(true);
    expect(requested.has('col19')).toBe(false);
    expect(requested.size).toBeLessThan(20);
  });

  it('requests stats for columns that scroll into view after expanding', async () => {
    const onHeaderStatsVisible = vi.fn();
    const { viewModel } = renderGrid({
      columns: wideColumns(20),
      onHeaderStatsVisible,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show column stats' }));
    await waitFor(() => expect(onHeaderStatsVisible).toHaveBeenCalled());
    onHeaderStatsVisible.mockClear();

    act(() => viewModel.scrollX.set(2000));

    await waitFor(() => {
      expect(onHeaderStatsVisible).toHaveBeenCalled();
    });
    const requested = new Set(
      onHeaderStatsVisible.mock.calls.map((call) => call[0] as string)
    );
    expect(requested.has('col10')).toBe(true);
  });

  it('keeps pinned column stats rendered while scrolled horizontally', async () => {
    const columns: DataGridColumn<StatsRow>[] = [
      {
        id: 'status',
        header: 'Status',
        width: 160,
        pinned: 'left',
        getValue: (r) => r.status,
      },
      ...wideColumns(20),
    ];
    const onHeaderStatsVisible = vi.fn();
    const { viewModel } = renderGrid({
      columns,
      columnStats: { status: CATEGORICAL_STATS },
      onHeaderStatsVisible,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show column stats' }));
    act(() => viewModel.scrollX.set(2000));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Filter Status by Active/ })
      ).toBeTruthy();
    });
    expect(onHeaderStatsVisible.mock.calls.map((call) => call[0])).toContain(
      'status'
    );
  });
});

describe('DataGrid stat marks drive filters', () => {
  it('toggles an in filter from a categorical mark', async () => {
    const columns: DataGridColumn<StatsRow>[] = [
      {
        id: 'status',
        header: 'Status',
        width: 200,
        filterable: true,
        getValue: (r) => r.status,
      },
    ];
    const { viewModel } = renderGrid({
      columns,
      columnStats: { status: CATEGORICAL_STATS },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show column stats' }));
    const mark = await screen.findByRole('button', {
      name: /Filter Status by Active/,
    });

    fireEvent.click(mark);
    expect(viewModel.filters.snapshot()).toMatchObject([
      { columnId: 'status', value: { kind: 'in', values: ['Active'] } },
    ]);

    fireEvent.click(
      screen.getByRole('button', { name: /Remove filter Status by Active/ })
    );
    expect(viewModel.filters.snapshot()).toMatchObject([]);
  });

  it('summarises categories with a caption, counts and an overflow row', async () => {
    const columns: DataGridColumn<StatsRow>[] = [
      {
        id: 'status',
        header: 'Status',
        width: 200,
        filterable: true,
        getValue: (r) => r.status,
      },
    ];
    renderGrid({
      columns,
      columnStats: {
        status: {
          kind: 'categorical',
          buckets:
            CATEGORICAL_STATS.kind === 'categorical'
              ? CATEGORICAL_STATS.buckets
              : [],
          uniqueCount: 5,
          nullCount: 0,
          otherCount: 9,
        },
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show column stats' }));

    const header = await screen.findByRole('columnheader', {
      name: /Status/,
    });
    expect(header.textContent).toContain('5 categories · top 2');
    expect(header.textContent).toContain('+ 3 more');
    // Per-row counts sit beside each bar.
    expect(header.textContent).toContain('8');
    expect(header.textContent).toContain('9');
  });

  it('applies and widens a between filter from histogram buckets', async () => {
    const columns: DataGridColumn<StatsRow>[] = [
      {
        id: 'share',
        header: 'Share',
        type: 'number',
        width: 200,
        filterable: true,
        getValue: (r) => r.share,
      },
    ];
    const { viewModel } = renderGrid({
      columns,
      columnStats: { share: NUMERIC_STATS },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show column stats' }));
    fireEvent.click(
      await screen.findByRole('button', { name: /Filter Share by 0 – 10/ })
    );
    expect(viewModel.filters.snapshot()).toMatchObject([
      { columnId: 'share', value: { kind: 'between', min: 0, max: 10 } },
    ]);

    fireEvent.click(
      screen.getByRole('button', { name: /Filter Share by 10 – 20/ })
    );
    expect(viewModel.filters.snapshot()).toMatchObject([
      {
        columnId: 'share',
        value: { kind: 'between', min: 0, max: 20, inclusiveMax: true },
      },
    ]);
  });
});

describe('structured filter helpers', () => {
  it('adds, removes and matches in-filter values', () => {
    const added = toggleInFilterValue(undefined, {
      kind: 'in',
      values: ['a'],
    });
    const extended = toggleInFilterValue(added, { kind: 'in', values: ['b'] });

    expect({
      added,
      extended,
      cleared: toggleInFilterValue(added, { kind: 'in', values: ['a'] }),
      matches: filterSelectsValue(extended, { kind: 'in', values: ['b'] }),
      missing: filterSelectsValue(extended, { kind: 'in', values: ['c'] }),
    }).toMatchObject({
      added: { kind: 'in', values: ['a'] },
      extended: { kind: 'in', values: ['a', 'b'] },
      cleared: null,
      matches: true,
      missing: false,
    });
  });

  it('unions adjacent ranges and clears an exact re-selection', () => {
    const first = toggleBetweenFilterValue(undefined, {
      kind: 'between',
      min: 0,
      max: 10,
    });
    const widened = toggleBetweenFilterValue(first, {
      kind: 'between',
      min: 10,
      max: 20,
      inclusiveMax: true,
    });

    expect({
      first,
      widened,
      cleared: toggleBetweenFilterValue(first, {
        kind: 'between',
        min: 0,
        max: 10,
      }),
      covers: filterSelectsValue(widened, {
        kind: 'between',
        min: 10,
        max: 20,
      }),
    }).toMatchObject({
      first: { kind: 'between', min: 0, max: 10 },
      widened: { kind: 'between', min: 0, max: 20, inclusiveMax: true },
      cleared: null,
      covers: true,
    });
  });
});
