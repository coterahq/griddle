import type { DataGridFilter, DataGridSort } from '../core/types';

/**
 * The default wire contract, and the reason it is spelled out here rather than
 * left implicit in `createHttpDataSource`.
 *
 *   GET {url}?offset=0&limit=200&sort=name:asc,created:desc&filter=<json>
 *
 * Someone has to write the server side, and they need to know exactly what
 * arrives. Both functions are exported so that someone can `import` them and
 * be certain, rather than reading a doc comment and guessing about encoding.
 */

/** `name:asc,created:desc` — one pair per sort, in priority order. */
export const serializeSorts = (sorts: readonly DataGridSort[]): string =>
  sorts.map((sort) => `${sort.columnId}:${sort.direction}`).join(',');

/** The inverse, for a server implemented in TypeScript. */
export const parseSorts = (value: string | null): DataGridSort[] => {
  if (value === null || value === '') {
    return [];
  }
  return value.split(',').flatMap((entry) => {
    const separator = entry.lastIndexOf(':');
    if (separator === -1) {
      return [];
    }
    const direction = entry.slice(separator + 1);
    if (direction !== 'asc' && direction !== 'desc') {
      return [];
    }
    return [{ columnId: entry.slice(0, separator), direction }];
  });
};

/**
 * Filters as JSON.
 *
 * Not one query parameter per column. A filter value is a structured object —
 * `{kind:'between', min, max, inclusiveMax}` — and flattening that into
 * `?name_min=…&name_max=…` loses the difference between a half-open range and
 * a closed one, which is exactly the distinction two adjacent histogram bars
 * depend on. JSON keeps the shapes the grid actually produces intact, and
 * `/memory`'s evaluator can read them without translation.
 */
export const serializeFilters = (filters: readonly DataGridFilter[]): string =>
  filters.length === 0 ? '' : JSON.stringify(filters);

export const parseFilters = (value: string | null): DataGridFilter[] => {
  if (value === null || value === '') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry) => {
      const candidate = entry as { columnId?: unknown; value?: unknown };
      return typeof candidate.columnId === 'string'
        ? [{ columnId: candidate.columnId, value: candidate.value }]
        : [];
    });
  } catch {
    // A malformed filter parameter means no filter rather than a 500. The
    // grid can survive showing too many rows; it cannot survive an error page.
    return [];
  }
};
