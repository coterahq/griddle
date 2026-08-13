import { DuckDBInstance } from '@duckdb/node-api';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Generates the demo site's three data sources.
 *
 * They are committed rather than generated at page load, because the whole
 * point of the landing demo is that a parquet on a CDN, a JSON file and an
 * Arrow stream are three genuinely different things joined by one query. A
 * fixture built in the browser would be one thing three times.
 *
 * Deterministic: a fixed seed and no clock, so regenerating produces a
 * byte-identical parquet and the diff stays empty unless the shape changed.
 *
 *   node scripts/build-fixtures.mjs
 */

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = join(ROOT, 'examples/public/data');

const ORDER_COUNT = 20_000;
const USER_COUNT = 400;

const STATUSES = ['fulfilled', 'pending', 'cancelled', 'refunded'];
const REGIONS = ['NA', 'EMEA', 'APAC', 'LATAM'];
const CHANNELS = ['web', 'retail', 'partner', 'phone'];
const FIRST = [
  'ada',
  'grace',
  'alan',
  'edsger',
  'barbara',
  'donald',
  'ken',
  'dennis',
  'linus',
  'margaret',
  'katherine',
  'radia',
  'leslie',
  'john',
  'anita',
];
const LAST = [
  'lovelace',
  'hopper',
  'turing',
  'dijkstra',
  'liskov',
  'knuth',
  'thompson',
  'ritchie',
  'torvalds',
  'hamilton',
  'johnson',
  'perlman',
  'lamport',
];

/** Small, fast, and fixed — the fixture must not move between runs. */
const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const pick = (random, list) => list[Math.floor(random() * list.length)];

const random = mulberry32(20250813);

const users = Array.from({ length: USER_COUNT }, (_, index) => ({
  user_id: 1000 + index,
  user_name: `${pick(random, FIRST)} ${pick(random, LAST)}`,
  email: `user${String(1000 + index)}@example.com`,
  tier: pick(random, ['free', 'pro', 'enterprise']),
}));

const orders = Array.from({ length: ORDER_COUNT }, (_, index) => {
  const day = Math.floor(random() * 540);
  return {
    order_id: 100_000 + index,
    user_id: 1000 + Math.floor(random() * USER_COUNT),
    status: pick(random, STATUSES),
    region: pick(random, REGIONS),
    channel: pick(random, CHANNELS),
    total: Math.round(random() * 250_000) / 100,
    items: 1 + Math.floor(random() * 30),
    // A fifth of orders carry no note, so the muted `null` cell is on screen.
    note: random() < 0.2 ? null : 'priority handling requested',
    placed_at: new Date(Date.UTC(2024, 0, 1 + day)).toISOString().slice(0, 10),
  };
});

const shipments = orders
  // Not every order has shipped, which is what makes the LEFT JOIN visible:
  // unmatched rows keep their place with empty joined cells.
  .filter(() => random() < 0.78)
  .map((order) => ({
    order_id: order.order_id,
    carrier: pick(random, ['dhl', 'ups', 'fedex', 'royal mail']),
    delivered: random() < 0.7,
    days_in_transit: 1 + Math.floor(random() * 9),
  }));

await mkdir(OUT, { recursive: true });

const instance = await DuckDBInstance.create(':memory:');
const connection = await instance.connect();

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;

const loadJson = async (name, rows) => {
  const path = join(OUT, `${name}.json`);
  await writeFile(path, JSON.stringify(rows));
  await connection.run(
    `CREATE OR REPLACE TABLE ${name} AS SELECT * FROM read_json_auto(${literal(path)})`
  );
  return path;
};

const ordersJson = await loadJson('orders', orders);
await loadJson('users', users);
await loadJson('shipments', shipments);

/*
 * Three genuinely different ingestion paths, on purpose.
 *
 * `orders` is parquet, read by DuckDB over HTTP range requests — it fetches
 * only the row groups a query touches, which is why a 20k-row file costs a
 * few hundred kB to sort rather than a full download.
 *
 * `users` is JSON, also fetched by DuckDB, standing in for an API response.
 *
 * `shipments` is JSON fetched by the *app* and handed over as an array, which
 * is the path anything already in memory takes.
 *
 * Not Arrow IPC, despite being the obvious third format. `COPY … (FORMAT
 * ARROW)` needs DuckDB's arrow extension, and duckdb-wasm would fetch that
 * extension from a CDN at page load — which breaks both the "every demo works
 * statically" property that makes Pages viable and the CSP story the library
 * tells about not reaching for the network. `registerArrowSource` exists for
 * callers who already hold an Arrow table; it just does not earn a demo that
 * costs this much.
 */
await connection.run(
  `COPY orders TO ${literal(join(OUT, 'orders.parquet'))} (FORMAT PARQUET, COMPRESSION ZSTD)`
);
await writeFile(join(OUT, 'shipments.json'), JSON.stringify(shipments));
// The orders JSON was only a vehicle for building the parquet. Shipping it
// too would put 3.4 MB of the same rows next to the 177 kB that replaced them.
await rm(ordersJson, { force: true });

connection.closeSync();
instance.closeSync();

console.log(
  `build-fixtures: ${String(orders.length)} orders (parquet), ` +
    `${String(users.length)} users (json), ` +
    `${String(shipments.length)} shipments (json, loaded in-app) → examples/public/data`
);
