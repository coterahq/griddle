import { describe, expect, it, vi } from 'vitest';
import { createMemoryDataSource } from '../../../memory/source';
import type { DataGridColumn } from '../../../core/types';
import { withLayers } from '../../with-layers';
import { LayerStack } from '../stack';
import type { GridSourceLayer } from '../types';

type Order = {
  id: string;
  userId: string;
  total: number;
  userName?: string | null;
};

const ORDERS: Order[] = [
  { id: 'o1', userId: 'u2', total: 10 },
  { id: 'o2', userId: 'u1', total: 30 },
  { id: 'o3', userId: 'u2', total: 20 },
];

const USERS = new Map([
  ['u1', 'Ada'],
  ['u2', 'Grace'],
]);

const COLUMNS: DataGridColumn<Order>[] = [
  { id: 'id', header: 'Id', type: 'text', getValue: (row) => row.id },
  {
    id: 'total',
    header: 'Total',
    type: 'number',
    getValue: (row) => row.total,
  },
];

/**
 * The non-SQL join: one batched lookup per page, not one per row.
 *
 * `attach` receives the whole page precisely so an implementation can do this
 * — an HTTP layer issues a single request for every id it needs rather than
 * N round trips.
 */
const userNameLayer = (
  onAttach?: (ids: string[]) => void
): GridSourceLayer<Order> => ({
  id: 'user',
  enrich: () => ({
    columns: [
      {
        id: 'userName',
        header: 'User',
        type: 'text',
        getValue: (row) => row.userName ?? null,
      },
    ],
    attach: ({ rows }) => {
      onAttach?.(rows.map((row) => row.userId));
      return rows.map((row) => ({
        ...row,
        userName: USERS.get(row.userId) ?? null,
      }));
    },
  }),
});

const layered = (layers: readonly GridSourceLayer<Order>[]) =>
  withLayers<Order>({
    source: createMemoryDataSource<Order>({ rows: ORDERS, columns: COLUMNS }),
    layers,
    getRowId: (row) => row.id,
  });

const query = (overrides: Record<string, unknown> = {}) => ({
  offset: 0,
  limit: 100,
  sorts: [],
  filters: [],
  ...overrides,
});

describe('enrich', () => {
  it('attaches fields to every row of a page', async () => {
    const { source } = layered([userNameLayer()]);
    const page = await source.loadPage(query());

    expect(page.rows).toMatchObject([
      { id: 'o1', userName: 'Grace' },
      { id: 'o2', userName: 'Ada' },
      { id: 'o3', userName: 'Grace' },
    ]);
  });

  it('calls attach once per page with the whole page', async () => {
    const onAttach = vi.fn();
    const { source } = layered([userNameLayer(onAttach)]);
    await source.loadPage(query());

    expect(onAttach).toHaveBeenCalledTimes(1);
    expect(onAttach.mock.calls[0]?.[0]).toMatchObject(['u2', 'u1', 'u2']);
  });

  it('leaves the total alone — enrichment adds fields, not rows', async () => {
    const { source } = layered([userNameLayer()]);
    const page = await source.loadPage(query({ limit: 2 }));

    expect({ rows: page.rows.length, total: page.total }).toMatchObject({
      rows: 2,
      total: 3,
    });
  });

  // The same nesting property `wrapSource` gives projections: a later layer
  // can read what an earlier one attached.
  it('runs layers in stack order, so a later one sees an earlier one’s fields', async () => {
    const seen: (string | null | undefined)[] = [];
    const downstream: GridSourceLayer<Order> = {
      id: 'downstream',
      enrich: () => ({
        columns: [],
        attach: ({ rows }) => {
          seen.push(rows[0]?.userName);
          return [...rows];
        },
      }),
    };
    const { source } = layered([userNameLayer(), downstream]);
    await source.loadPage(query());

    expect(seen).toMatchObject(['Grace']);
  });

  it('propagates an abort rather than attaching to a discarded page', async () => {
    const controller = new AbortController();
    const slow: GridSourceLayer<Order> = {
      id: 'slow',
      enrich: () => ({
        columns: [],
        attach: ({ rows }) => {
          controller.abort();
          return [...rows];
        },
      }),
    };
    const { source } = layered([slow, userNameLayer()]);

    await expect(
      source.loadPage(query({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('enriched columns cannot be sorted or filtered', () => {
  // The whole reason the slot is separate from `project`. The grid holds one
  // page of a result the source chose before the layer ran, so ordering it
  // here would reorder that page and look like it worked.
  it('marks them unsortable and unfilterable', () => {
    const stack = new LayerStack<Order>([userNameLayer()], {
      getRowId: (row) => row.id,
    });

    expect(stack.enrichedColumns).toMatchObject([
      { id: 'userName', sortable: false, filterable: false },
    ]);
  });

  it('drops a sort that addresses one, and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { source } = layered([userNameLayer()]);

    const page = await source.loadPage(
      query({ sorts: [{ columnId: 'userName', direction: 'desc' }] })
    );

    // Unchanged order — the sort was refused, not applied to the page.
    expect(page.rows.map((row) => row.id)).toMatchObject(['o1', 'o2', 'o3']);
    expect(warn.mock.calls[0]?.[0]).toContain('userName');
    warn.mockRestore();
  });

  it('drops a filter that addresses one, and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { source } = layered([userNameLayer()]);

    const page = await source.loadPage(
      query({ filters: [{ columnId: 'userName', value: 'Ada' }] })
    );

    // All three rows, and a total that still agrees with them — filtering the
    // page here would have left a short page and a total that disagreed.
    expect({ rows: page.rows.length, total: page.total }).toMatchObject({
      rows: 3,
      total: 3,
    });
    expect(warn.mock.calls[0]?.[0]).toContain('userName');
    warn.mockRestore();
  });

  it('warns once per column rather than once per page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { source } = layered([userNameLayer()]);
    const sorted = query({
      sorts: [{ columnId: 'userName', direction: 'asc' }],
    });

    await source.loadPage(sorted);
    await source.loadPage(sorted);
    await source.loadPage(sorted);

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('leaves a sort on a real column alone', async () => {
    const { source } = layered([userNameLayer()]);
    const page = await source.loadPage(
      query({ sorts: [{ columnId: 'total', direction: 'desc' }] })
    );

    expect(page.rows.map((row) => row.id)).toMatchObject(['o2', 'o3', 'o1']);
  });
});

describe('withLayers column ordering', () => {
  it('lays presentation columns, then enriched, then the source’s own', () => {
    const selection: GridSourceLayer<Order> = {
      id: 'selection',
      present: () => ({
        columns: [{ id: 'select', header: '', getValue: () => null }],
      }),
    };
    const { columns } = layered([userNameLayer(), selection]);

    expect(columns(COLUMNS).map((column) => column.id)).toMatchObject([
      'select',
      'userName',
      'id',
      'total',
    ]);
  });
});
