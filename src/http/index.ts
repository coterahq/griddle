export { createHttpDataSource } from './source';
export type { CreateHttpDataSourceOptions, HttpRequestContext } from './source';

/*
 * The wire contract, both directions.
 *
 * The parsers exist because somebody has to write the server, and the honest
 * way to describe a query-string encoding is to hand over the function that
 * produces it rather than a paragraph describing it. A server written in
 * TypeScript can import these and be exactly compatible.
 */
export {
  parseFilters,
  parseSorts,
  serializeFilters,
  serializeSorts,
} from './serialize';
