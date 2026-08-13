import { duckDbIdentifier, duckDbStringLiteral } from './sql';
import type { DuckDbQuery } from './types';

/**
 * Getting data *into* DuckDB, which is the step between "I have a parquet on
 * S3" and "I have a grid".
 *
 * Each of these is one `CREATE OR REPLACE VIEW`, and each returns the
 * registered name ready to pass as `from`. They are conveniences, not a layer
 * of abstraction — a caller who prefers to write the DDL should, and the
 * return value is just a quoted identifier either way.
 *
 * `VIEW` rather than `TABLE` throughout: a view re-reads the source, so a
 * parquet that changes behind an HTTP URL is picked up on the next query
 * rather than frozen at registration. `registerArrowSource` is the exception,
 * because an in-memory table has nothing to re-read.
 */

export type RegisterParquetOptions = {
  /** The name the grid will select from. */
  name: string;
  /** A path, an `s3://` URL, or an `https://` one served with range support. */
  url: string;
};

/**
 * A parquet file, read over HTTP range requests.
 *
 * DuckDB reads only the row groups and columns a query touches, so a 200 MB
 * parquet behind a CDN costs a few hundred kB to sort and filter — which is
 * what makes the static demo possible at all. It needs the server to honour
 * `Range`; GitHub Pages' CDN does.
 */
export const registerParquetSource = async (
  query: DuckDbQuery,
  { name, url }: RegisterParquetOptions
): Promise<string> => {
  const identifier = duckDbIdentifier(name);
  await query(
    `CREATE OR REPLACE VIEW ${identifier} AS ` +
      `SELECT * FROM read_parquet(${duckDbStringLiteral(url)})`
  );
  return identifier;
};

export type RegisterJsonOptions =
  | { name: string; url: string; rows?: never }
  | { name: string; rows: readonly unknown[]; url?: never };

/**
 * A JS value as a SQL literal, for the inline-rows path.
 *
 * Nested objects and arrays become JSON text rather than DuckDB structs: a
 * grid cell renders a scalar, and inferring a STRUCT type from a ragged array
 * of API responses is a guess that fails loudly on the first row with a
 * missing key.
 */
const inlineLiteral = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'string') {
    return duckDbStringLiteral(value);
  }
  return duckDbStringLiteral(JSON.stringify(value));
};

/**
 * JSON, either fetched by DuckDB or handed over as an array.
 *
 * The `url` form is `read_json_auto`, which gets DuckDB's own schema
 * inference. The `rows` form compiles to a `VALUES` list instead — *not*
 * `read_json_auto` on a serialised literal, which reads its argument as a
 * filename and fails with "No files found that match the pattern
 * [{"id":1,…]". A `VALUES` list also works identically under wasm and native,
 * where the virtual-filesystem registration APIs differ.
 *
 * Columns are the union of keys across every row, in first-seen order, so a
 * ragged array does not lose the fields that only later rows carry.
 */
export const registerJsonSource = async (
  query: DuckDbQuery,
  options: RegisterJsonOptions
): Promise<string> => {
  const identifier = duckDbIdentifier(options.name);

  if (options.url !== undefined) {
    await query(
      `CREATE OR REPLACE VIEW ${identifier} AS ` +
        `SELECT * FROM read_json_auto(${duckDbStringLiteral(options.url)})`
    );
    return identifier;
  }

  const rows = options.rows.map((row) => row as Record<string, unknown>);
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (keys.length === 0 || rows.length === 0) {
    // `SELECT … WHERE false` rather than an empty VALUES list, which is a
    // syntax error: an empty source should still have a shape to select from.
    await query(
      `CREATE OR REPLACE VIEW ${identifier} AS SELECT NULL AS dg_empty WHERE false`
    );
    return identifier;
  }

  const values = rows
    .map((row) => `(${keys.map((key) => inlineLiteral(row[key])).join(', ')})`)
    .join(', ');
  await query(
    `CREATE OR REPLACE VIEW ${identifier} AS SELECT * FROM (VALUES ${values}) ` +
      `AS dg_rows(${keys.map(duckDbIdentifier).join(', ')})`
  );
  return identifier;
};

export type RegisterArrowOptions = {
  name: string;
  /**
   * An Arrow table, or anything the connection's own registration accepts.
   *
   * Typed `unknown` rather than `arrow.Table` on purpose — see
   * `DuckDbQueryResult`. The 600 kB peer this would cost buys one type name.
   */
  table: unknown;
  /**
   * How to hand the table to the connection.
   *
   * Required because registration is the one ingestion step that is not SQL:
   * duckdb-wasm does it through `AsyncDuckDBConnection.insertArrowTable`, node
   * through a different call, and neither is reachable from a `query` function
   * that only takes a string.
   */
  register: (name: string, table: unknown) => Promise<void>;
};

/**
 * An Arrow table already in memory, zero-copy.
 *
 * The fastest path when a caller has Arrow in hand — an IPC stream off the
 * wire, another DuckDB's output — because nothing is parsed or copied.
 */
export const registerArrowSource = async (
  query: DuckDbQuery,
  { name, table, register }: RegisterArrowOptions
): Promise<string> => {
  const raw = `${name}__arrow`;
  await register(raw, table);
  const identifier = duckDbIdentifier(name);
  await query(
    `CREATE OR REPLACE VIEW ${identifier} AS ` +
      `SELECT * FROM ${duckDbIdentifier(raw)}`
  );
  return identifier;
};

/**
 * The columns of a registered source, ready to hand to
 * `createDuckDbDataSource`.
 *
 * Saves declaring a schema the engine already knows. A caller who wants
 * friendlier headers or explicit grid types should still write the array —
 * this is for "point it at a parquet and show me".
 */
export const describeSource = async (
  query: DuckDbQuery,
  from: string
): Promise<{ id: string; sqlType: string | null }[]> => {
  const result = await query(`DESCRIBE SELECT * FROM ${from}`);
  return result.toArray().flatMap((raw) => {
    const row = raw as Record<string, unknown>;
    const name = row['column_name'];
    if (typeof name !== 'string') {
      return [];
    }
    const type = row['column_type'];
    return [{ id: name, sqlType: typeof type === 'string' ? type : null }];
  });
};
