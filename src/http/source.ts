import type {
  DataGridColumnStats,
  DataGridFilter,
  DataGridSort,
} from '../core/types';
import type { GridDataSource, GridPage, GridQuery } from '../source/types';
import { serializeFilters, serializeSorts } from './serialize';

export type HttpRequestContext = {
  readonly offset: number;
  readonly limit: number;
  readonly sorts: readonly DataGridSort[];
  readonly filters: readonly DataGridFilter[];
  readonly signal?: AbortSignal;
};

export type CreateHttpDataSourceOptions<TRow> = {
  /** Base URL. Existing query parameters on it are preserved. */
  url: string;

  /**
   * ── Escape hatches, smallest first ────────────────────────────────────
   *
   * Layered deliberately. Most endpoints differ from the default contract in
   * one small way, and forcing a caller to reimplement the whole request to
   * change how a sort is spelled is how an adapter stops being worth using.
   * Reach for the first one that fits.
   */

  /** 1. The endpoint spells sorts or filters differently. */
  serializeSorts?: (sorts: readonly DataGridSort[]) => string;
  serializeFilters?: (filters: readonly DataGridFilter[]) => string;

  /**
   * 2. The endpoint needs headers.
   *
   * May be async, because the common case is a token that has to be refreshed
   * — and resolving it per request rather than once at construction is what
   * keeps a long-lived grid working past the first expiry.
   */
  headers?:
    | Record<string, string>
    | ((
        context: HttpRequestContext
      ) => Record<string, string> | Promise<Record<string, string>>);

  /** 3. The request itself is different — a POST body, a different path shape. */
  buildRequest?: (context: HttpRequestContext & { url: string }) => Request;

  /** 4. The response is shaped differently. */
  parseResponse?: (
    response: Response,
    context: HttpRequestContext
  ) => Promise<GridPage<TRow>>;

  /** 5. Everything else — a mock, a retry policy, a different transport. */
  fetch?: typeof globalThis.fetch;

  /**
   * Read the total from the response when it is not `body.total`.
   *
   * Consulted before the header and the body, so a caller who knows where the
   * count lives never has to think about precedence.
   */
  parseTotal?: (response: Response, body: unknown) => number | null;

  /**
   * Column ids the endpoint can order by.
   *
   * Worth declaring. Most APIs accept a fixed set of sort fields and ignore
   * anything else, which means the grid draws a sort arrow, the backend
   * returns its default order, and the user reads a list they believe is
   * sorted. Declaring the set makes the grid stop offering the others.
   *
   * Omit it only if the endpoint really can sort by every column.
   */
  sortableColumns?: readonly string[];

  /** Column stats, if the endpoint can produce them. */
  loadColumnStats?: (input: {
    columnId: string;
    filters: DataGridFilter[];
    signal?: AbortSignal;
  }) => Promise<DataGridColumnStats>;
};

const readTotalHeader = (response: Response): number | null => {
  const header = response.headers.get('X-Total-Count');
  if (header === null) {
    return null;
  }
  const parsed = Number(header);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const readTotalBody = (body: unknown): number | null => {
  const total = (body as { total?: unknown } | null)?.total;
  if (typeof total === 'number') {
    return Number.isSafeInteger(total) && total >= 0 ? total : null;
  }
  return null;
};

/**
 * A {@link GridDataSource} over an HTTP endpoint.
 *
 * The default contract is
 * `GET {url}?offset&limit&sort=name:asc&filter=<urlencoded JSON>` returning
 * `{ rows, total }`. `serializeSorts` and `serializeFilters` are exported from
 * `./serialize` so the server side can be written against exactly what
 * arrives rather than against a doc comment.
 *
 * ## Total discovery
 *
 * `parseTotal` → `X-Total-Count` → `body.total` → `null`, and `null` is a
 * real answer rather than a failure: the controller falls back to inferring
 * "is there more" from whether the page came back full. An endpoint that
 * cannot count cheaply should say so instead of guessing, because a wrong
 * total is worse than no total — it makes the grid claim rows that are not
 * there.
 *
 * ## No retry
 *
 * Deliberately. A retry policy interacts with the abort on every sort toggle,
 * with the controller's generation counter, and with whatever the host's own
 * fetch wrapper already does. Injecting `fetch` is the seam for a caller who
 * wants one, and their policy will be better than a guess made here.
 */
export function createHttpDataSource<TRow>({
  url,
  serializeSorts: sortsToString = serializeSorts,
  serializeFilters: filtersToString = serializeFilters,
  headers,
  buildRequest,
  parseResponse,
  fetch: fetchImpl,
  parseTotal,
  sortableColumns,
  loadColumnStats,
}: CreateHttpDataSourceOptions<TRow>): GridDataSource<TRow> {
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);

  const resolveHeaders = async (
    context: HttpRequestContext
  ): Promise<Record<string, string>> => {
    if (headers === undefined) {
      return {};
    }
    return typeof headers === 'function' ? headers(context) : headers;
  };

  const buildUrl = (context: HttpRequestContext): string => {
    // Built on the existing URL rather than by concatenation, so a base that
    // already carries `?tenant=acme` keeps it.
    const target = new URL(url, 'http://localhost');
    target.searchParams.set('offset', String(context.offset));
    target.searchParams.set('limit', String(context.limit));

    const sort = sortsToString(context.sorts);
    if (sort !== '') {
      target.searchParams.set('sort', sort);
    }
    const filter = filtersToString(context.filters);
    if (filter !== '') {
      target.searchParams.set('filter', filter);
    }

    // Relative bases are resolved against a placeholder origin above; strip it
    // back off so `fetch` resolves the URL against the document as intended.
    return url.startsWith('http')
      ? target.toString()
      : `${target.pathname}${target.search}`;
  };

  const defaultParse = async (
    response: Response,
    context: HttpRequestContext
  ): Promise<GridPage<TRow>> => {
    if (!response.ok) {
      throw new Error(
        `${String(response.status)} ${response.statusText} from ${buildUrl(context)}`
      );
    }
    const body: unknown = await response.json();
    const rows = (body as { rows?: unknown } | null)?.rows;
    return {
      rows: Array.isArray(rows) ? (rows as TRow[]) : [],
      total:
        parseTotal?.(response, body) ??
        readTotalHeader(response) ??
        readTotalBody(body),
    };
  };

  const source: GridDataSource<TRow> = {
    async loadPage(query: GridQuery): Promise<GridPage<TRow>> {
      const context: HttpRequestContext = {
        offset: query.offset,
        limit: query.limit,
        sorts: query.sorts,
        filters: query.filters,
        signal: query.signal,
      };

      const target = buildUrl(context);
      const custom = buildRequest?.({ ...context, url: target });

      // The URL is handed to `fetch` as a string rather than wrapped in a
      // `Request` first. `new Request('/api/rows')` throws outside a browser —
      // there is no document to resolve a relative URL against — so
      // constructing one here would make the adapter unusable from Node, from
      // a server render and from a test, for no gain. `fetch` resolves it in
      // the browser exactly the same way.
      //
      // The signal goes on unconditionally, including over a custom request:
      // superseding a query aborts it, and an adapter that dropped the signal
      // would leave every abandoned request running to completion, which is
      // what makes a fast sort toggle feel broken.
      const response =
        custom === undefined
          ? await doFetch(target, {
              headers: await resolveHeaders(context),
              signal: query.signal,
            })
          : await doFetch(custom, { signal: query.signal });

      return (parseResponse ?? defaultParse)(response, context);
    },
  };

  if (loadColumnStats !== undefined) {
    source.loadColumnStats = loadColumnStats;
  }

  if (sortableColumns !== undefined) {
    source.sortableColumns = () => sortableColumns;
  }

  return source;
}
