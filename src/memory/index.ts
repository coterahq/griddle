export { createMemoryDataSource } from './source';
export type { CreateMemoryDataSourceOptions } from './source';
// The filter and ordering primitives are exported because they are the written
// definition of what every filter shape means. An adapter implementing the
// same semantics against a different engine has something to check itself
// against, and a caller doing client-side work on a slice of the same data can
// reuse them rather than reimplementing the rules slightly differently.
export { matchesFilterValue, compareValues } from './filter';
