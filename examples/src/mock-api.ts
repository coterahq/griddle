import { http, HttpResponse } from 'msw';
import { setupWorker } from 'msw/browser';
import { createMemoryDataSource } from '../../src/memory';
import { parseFilters, parseSorts } from '../../src/http';
import { makeOrders, ORDER_COLUMNS } from './data';
import type { Order } from './data';
import { asset } from './asset';

/**
 * The server side of the `/http` demo, implemented against the library's own
 * published wire contract.
 *
 * `parseSorts` and `parseFilters` are imported from `/http` rather than
 * reimplemented, and the filters are evaluated by `/memory` rather than by a
 * bespoke `if` ladder. That is the whole argument for exporting them: a server
 * written this way is exactly compatible by construction, and if the encoding
 * ever changed, this would stop compiling rather than start disagreeing.
 *
 * A service worker rather than the adapter's `fetch` option, deliberately.
 * `fetch` injection is an escape hatch, and using the escape hatch to
 * demonstrate the default path would prove nothing about the default path.
 * This way the query string, the `X-Total-Count` header and the abort on a
 * superseded sort are all real.
 */

const ROWS = makeOrders(5_000);
const source = createMemoryDataSource<Order>({
  rows: ROWS,
  columns: ORDER_COLUMNS,
});

const LATENCY_MS = 220;

export const startMockApi = async (
  onRequest: (line: string) => void
): Promise<void> => {
  const worker = setupWorker(
    http.get('/api/orders', async ({ request }) => {
      const url = new URL(request.url);
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const limit = Number(url.searchParams.get('limit') ?? '100');
      const sorts = parseSorts(url.searchParams.get('sort'));
      const filters = parseFilters(url.searchParams.get('filter'));

      onRequest(
        `GET ${url.pathname}${url.search.slice(0, 110)}${
          url.search.length > 110 ? '…' : ''
        }`
      );

      // Slow enough that a second sort lands while the first is in flight,
      // which is the only way the abort path is visible rather than assumed.
      await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
      if (request.signal.aborted) {
        onRequest('  ↳ aborted by a newer query');
        return HttpResponse.error();
      }

      const page = await source.loadPage({ offset, limit, sorts, filters });
      return HttpResponse.json(
        { rows: page.rows },
        {
          // Not `body.total`. Both are supported and the header wins, so the
          // demo exercises the branch a caller is least likely to test.
          headers: { 'X-Total-Count': String(page.total ?? 0) },
        }
      );
    })
  );

  await worker.start({
    // Under a project subpath the worker script is not at the site root.
    serviceWorker: { url: asset('mockServiceWorker.js') },
    // Everything except `/api/*` is the real site — the parquet, the wasm, the
    // app itself — and must not be intercepted or even warned about.
    onUnhandledRequest: 'bypass',
    quiet: true,
  });
};
