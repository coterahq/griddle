import { describe, expect, it, vi } from 'vitest';
import { createDataGridViewModel } from '../../core/view-model';
import { createGridController } from '../../source/controller';
import type { DataGridColumn } from '../../core/types';
import { createHttpDataSource } from '../source';
import { parseFilters, parseSorts, serializeFilters } from '../serialize';

type Row = { id: number; name: string };

const COLUMNS: DataGridColumn<Row>[] = [
  { id: 'id', header: 'Id', type: 'number', getValue: (row) => row.id },
  { id: 'name', header: 'Name', type: 'text', getValue: (row) => row.name },
];

const ROWS: Row[] = [
  { id: 1, name: 'alpha' },
  { id: 2, name: 'beta' },
];

type StubCall = { url: string; method: string; headers: Headers };

/**
 * Records every request and replies with whatever the spec asked for.
 *
 * Normalises the two shapes `fetch` accepts — `(url, init)` and `(Request)` —
 * because the adapter uses the first for the default path and the second when
 * `buildRequest` supplies one.
 */
const stubFetch = (reply: (call: StubCall) => Response | Promise<Response>) => {
  const calls: StubCall[] = [];
  const impl = vi.fn(
    async (input: Request | string | URL, init?: RequestInit) => {
      const call: StubCall =
        input instanceof Request
          ? {
              url: input.url,
              method: input.method,
              headers: new Headers(input.headers),
            }
          : {
              url: String(input),
              method: init?.method ?? 'GET',
              headers: new Headers(init?.headers),
            };
      calls.push(call);
      init?.signal?.throwIfAborted();
      return reply(call);
    }
  );
  return { calls, impl: impl as unknown as typeof globalThis.fetch };
};

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });

const query = (overrides: Record<string, unknown> = {}) => ({
  offset: 0,
  limit: 50,
  sorts: [],
  filters: [],
  ...overrides,
});

describe('http source — the default wire contract', () => {
  it('sends offset and limit', async () => {
    const { calls, impl } = stubFetch(() => json({ rows: ROWS, total: 2 }));
    const source = createHttpDataSource<Row>({ url: '/api/rows', fetch: impl });

    await source.loadPage(query({ offset: 40, limit: 20 }));

    const url = new URL(calls[0]?.url ?? '', 'http://localhost');
    expect({
      offset: url.searchParams.get('offset'),
      limit: url.searchParams.get('limit'),
    }).toMatchObject({ offset: '40', limit: '20' });
  });

  it('encodes sorts as columnId:direction pairs in priority order', async () => {
    const { calls, impl } = stubFetch(() => json({ rows: [], total: 0 }));
    const source = createHttpDataSource<Row>({ url: '/api/rows', fetch: impl });

    await source.loadPage(
      query({
        sorts: [
          { columnId: 'name', direction: 'asc' },
          { columnId: 'created', direction: 'desc' },
        ],
      })
    );

    const url = new URL(calls[0]?.url ?? '', 'http://localhost');
    expect(url.searchParams.get('sort')).toBe('name:asc,created:desc');
  });

  it('encodes filters as JSON, structure intact', async () => {
    const { calls, impl } = stubFetch(() => json({ rows: [], total: 0 }));
    const source = createHttpDataSource<Row>({ url: '/api/rows', fetch: impl });
    const filters = [
      {
        columnId: 'total',
        value: { kind: 'between', min: 1, max: 9, inclusiveMax: true },
      },
    ];

    await source.loadPage(query({ filters }));

    const url = new URL(calls[0]?.url ?? '', 'http://localhost');
    // Round-trips, which is the property that matters: flattening this into
    // `?total_min=1&total_max=9` would lose `inclusiveMax`, and that is the
    // difference between two adjacent histogram bars both claiming a value.
    expect(parseFilters(url.searchParams.get('filter'))).toMatchObject(filters);
  });

  it('omits sort and filter entirely when there are none', async () => {
    const { calls, impl } = stubFetch(() => json({ rows: [], total: 0 }));
    const source = createHttpDataSource<Row>({ url: '/api/rows', fetch: impl });

    await source.loadPage(query());

    const url = new URL(calls[0]?.url ?? '', 'http://localhost');
    expect({
      sort: url.searchParams.has('sort'),
      filter: url.searchParams.has('filter'),
    }).toMatchObject({ sort: false, filter: false });
  });

  it('keeps query parameters already on the base URL', async () => {
    const { calls, impl } = stubFetch(() => json({ rows: [], total: 0 }));
    const source = createHttpDataSource<Row>({
      url: '/api/rows?tenant=acme',
      fetch: impl,
    });

    await source.loadPage(query());

    const url = new URL(calls[0]?.url ?? '', 'http://localhost');
    expect(url.searchParams.get('tenant')).toBe('acme');
  });

  it('round-trips through the exported parsers', () => {
    const sorts = [
      { columnId: 'name', direction: 'asc' as const },
      { columnId: 'created_at', direction: 'desc' as const },
    ];
    const filters = [{ columnId: 'name', value: 'ac' }];

    expect(parseSorts('name:asc,created_at:desc')).toMatchObject(sorts);
    expect(parseFilters(serializeFilters(filters))).toMatchObject(filters);
  });

  // A malformed parameter should cost rows, not the page.
  it('reads a malformed filter parameter as no filter', () => {
    expect(parseFilters('{not json')).toMatchObject([]);
    expect(parseSorts('name')).toMatchObject([]);
  });
});

describe('http source — total discovery', () => {
  it('prefers X-Total-Count over body.total', async () => {
    const { impl } = stubFetch(() =>
      json({ rows: ROWS, total: 999 }, { 'X-Total-Count': '412' })
    );
    const source = createHttpDataSource<Row>({ url: '/api/rows', fetch: impl });

    await expect(source.loadPage(query())).resolves.toMatchObject({
      total: 412,
    });
  });

  it('prefers parseTotal over both', async () => {
    const { impl } = stubFetch(() =>
      json({ count: 7, rows: ROWS }, { 'X-Total-Count': '412' })
    );
    const source = createHttpDataSource<Row>({
      url: '/api/rows',
      fetch: impl,
      parseTotal: (_response, body) => (body as { count: number }).count,
    });

    await expect(source.loadPage(query())).resolves.toMatchObject({ total: 7 });
  });

  it('falls back to body.total', async () => {
    const { impl } = stubFetch(() => json({ rows: ROWS, total: 2 }));
    const source = createHttpDataSource<Row>({ url: '/api/rows', fetch: impl });

    await expect(source.loadPage(query())).resolves.toMatchObject({ total: 2 });
  });

  // `null` is a real answer, not a failure — the controller infers "is there
  // more" from a full page. A wrong total is worse than no total, because it
  // makes the grid claim rows that are not there.
  it('reports null when nothing says how many rows there are', async () => {
    const { impl } = stubFetch(() => json({ rows: ROWS }));
    const source = createHttpDataSource<Row>({ url: '/api/rows', fetch: impl });

    await expect(source.loadPage(query())).resolves.toMatchObject({
      total: null,
    });
  });

  it('ignores a nonsense X-Total-Count rather than trusting it', async () => {
    const { impl } = stubFetch(() =>
      json({ rows: ROWS }, { 'X-Total-Count': 'lots' })
    );
    const source = createHttpDataSource<Row>({ url: '/api/rows', fetch: impl });

    await expect(source.loadPage(query())).resolves.toMatchObject({
      total: null,
    });
  });
});

describe('http source — escape hatches', () => {
  it('takes static headers', async () => {
    const { calls, impl } = stubFetch(() => json({ rows: [] }));
    const source = createHttpDataSource<Row>({
      url: '/api/rows',
      fetch: impl,
      headers: { authorization: 'Bearer static' },
    });

    await source.loadPage(query());

    expect(calls[0]?.headers.get('authorization')).toBe('Bearer static');
  });

  // Resolved per request rather than once at construction, which is what keeps
  // a long-lived grid working past the first token expiry.
  it('resolves async headers on every request', async () => {
    const { calls, impl } = stubFetch(() => json({ rows: [] }));
    let issued = 0;
    const source = createHttpDataSource<Row>({
      url: '/api/rows',
      fetch: impl,
      headers: async () => {
        issued += 1;
        await Promise.resolve();
        return { authorization: `Bearer token-${String(issued)}` };
      },
    });

    await source.loadPage(query());
    await source.loadPage(query({ offset: 50 }));

    expect([
      calls[0]?.headers.get('authorization'),
      calls[1]?.headers.get('authorization'),
    ]).toMatchObject(['Bearer token-1', 'Bearer token-2']);
  });

  it('lets buildRequest replace the request entirely', async () => {
    const { calls, impl } = stubFetch(() => json({ rows: ROWS }));
    const source = createHttpDataSource<Row>({
      url: '/api/rows',
      fetch: impl,
      buildRequest: ({ offset, limit }) =>
        new Request('http://example.test/search', {
          method: 'POST',
          body: JSON.stringify({ offset, limit }),
        }),
    });

    await source.loadPage(query({ offset: 10 }));

    expect({
      method: calls[0]?.method,
      url: calls[0]?.url,
    }).toMatchObject({ method: 'POST', url: 'http://example.test/search' });
  });

  it('lets parseResponse read a different body shape', async () => {
    const { impl } = stubFetch(() => json({ data: { items: ROWS, n: 2 } }));
    const source = createHttpDataSource<Row>({
      url: '/api/rows',
      fetch: impl,
      parseResponse: async (response) => {
        const body = (await response.json()) as {
          data: { items: Row[]; n: number };
        };
        return { rows: body.data.items, total: body.data.n };
      },
    });

    await expect(source.loadPage(query())).resolves.toMatchObject({
      rows: ROWS,
      total: 2,
    });
  });

  it('surfaces a non-2xx response as an error', async () => {
    const { impl } = stubFetch(
      () => new Response('nope', { status: 503, statusText: 'Unavailable' })
    );
    const source = createHttpDataSource<Row>({ url: '/api/rows', fetch: impl });

    await expect(source.loadPage(query())).rejects.toThrow('503');
  });
});

describe('http source — abort', () => {
  it('forwards the signal to fetch', async () => {
    const controller = new AbortController();
    controller.abort();
    const { impl } = stubFetch(() => json({ rows: [] }));
    const source = createHttpDataSource<Row>({ url: '/api/rows', fetch: impl });

    await expect(
      source.loadPage(query({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  /**
   * The behaviour the whole abort path exists for.
   *
   * Toggling a sort twice quickly aborts the first request. That rejection is
   * a *success* — it means the newer query won — and a grid that painted an
   * error banner on it would flash one on every impatient click. This asserts
   * the round trip: real source, real controller, real abort.
   */
  it('surfaces no error when a rapid sort toggle aborts a request', async () => {
    const impl = (async (
      _input: Request | string | URL,
      init?: RequestInit
    ): Promise<Response> =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(json({ rows: ROWS, total: 2 }));
        }, 20);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      })) as typeof globalThis.fetch;

    const viewModel = createDataGridViewModel<Row>({ columns: COLUMNS });
    const controller = createGridController<Row>({
      source: createHttpDataSource<Row>({ url: '/api/rows', fetch: impl }),
      viewModel,
      getRowId: (row) => row.id,
    });

    viewModel.setSort('name', 'asc');
    viewModel.setSort('name', 'desc');
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect({
      error: controller.error.snapshot(),
      status: controller.status.snapshot(),
      rows: controller.rowSource.rows.snapshot().length,
    }).toMatchObject({ error: null, status: 'ready', rows: 2 });

    controller.dispose();
  });
});
