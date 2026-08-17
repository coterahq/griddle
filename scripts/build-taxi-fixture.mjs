import { DuckDBInstance } from '@duckdb/node-api';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

/**
 * Builds the half-million-row demo fixture from real NYC taxi data.
 *
 *   node scripts/build-taxi-fixture.mjs
 *
 * Separate from `build-fixtures.mjs` on purpose. That script is a generator —
 * a fixed seed, no clock, no network, and a byte-identical parquet every run.
 * This one *downloads* 48 MB from a CDN, which is a different enough thing
 * that mixing them would make the offline script look like it needs a network.
 *
 * The output is committed, like the other fixtures, so neither the dev server
 * nor the Pages build ever depends on the TLC's CDN being up. That matters
 * more here than it does for the generated ones: the TLC serves no
 * `access-control-allow-origin`, so the browser could not read these files
 * cross-origin even if we wanted it to. Self-hosting is not a preference, it
 * is the only option.
 *
 * Deterministic despite the download: the source files are archival releases
 * that have not changed since 2024, and the slice is a fixed date range. Rerun
 * it and the diff stays empty.
 *
 * ## Why this dataset
 *
 * Because the join it needs is not a contrivance. A trip record identifies
 * where it started as `PULocationID` — the integer 132 — and the fact that 132
 * means "JFK Airport" lives in a different file entirely. Any grid can show
 * you 132. Sorting 609,698 trips by pickup *zone* requires the join to be in
 * the query, which is the argument this library exists to make, and here it is
 * being made by someone else's data model rather than by ours.
 *
 * ## Provenance
 *
 * NYC Taxi & Limousine Commission trip records, yellow taxi, January 2024,
 * sliced to the first week. Published by the TLC as public data:
 * https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page
 *
 * The zone lookup is the TLC's own `taxi_zone_lookup.csv`, unmodified except
 * for lowercasing the column names.
 *
 * The data is left as it was published, including the parts that look broken:
 * 28,098 trips have no `passengers` recorded, and 8,178 have a negative
 * `total_amount` (refunds and disputed fares). Cleaning those would make a
 * tidier fixture and a worse demo — nulls and negatives are what the stats
 * charts and filters are *for*, and every real dataset a user points this grid
 * at will have both.
 */

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = join(ROOT, 'examples/public/data');
// Gitignored: 48 MB of source data that only this script reads, kept so a
// rerun costs nothing.
const CACHE = join(ROOT, '.cache/tlc');

const TRIPS_URL =
  'https://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_2024-01.parquet';
const ZONES_URL =
  'https://d37ci6vzurychx.cloudfront.net/misc/taxi_zone_lookup.csv';

// The first week of January 2024. A calendar slice rather than a sample,
// because "the first week of January" is a thing a person can hold in their
// head and `USING SAMPLE 500000` is not — and because a contiguous range keeps
// the timestamps sorted, which is most of why the file compresses to 8.7 MB.
const FROM = '2024-01-01';
const TO = '2024-01-08';

/** Downloads once, then never again. */
const cached = async (url, name) => {
  const path = join(CACHE, name);
  const existing = await stat(path).catch(() => null);
  if (existing !== null) {
    console.log(`cached   ${name} (${(existing.size / 1e6).toFixed(1)} MB)`);
    return path;
  }
  console.log(`fetching ${url}`);
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`${url} → ${String(response.status)}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
  return path;
};

await mkdir(CACHE, { recursive: true });
await mkdir(OUT, { recursive: true });

const tripsSource = await cached(TRIPS_URL, 'yellow_tripdata_2024-01.parquet');
const zonesSource = await cached(ZONES_URL, 'taxi_zone_lookup.csv');

const instance = await DuckDBInstance.create(':memory:');
const connection = await instance.connect();

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const rows = async (sql) =>
  await (await connection.run(sql)).getRowObjectsJson();

/*
 * The TLC's column names are three naming conventions in one table
 * (`VendorID`, `tpep_pickup_datetime`, `trip_distance`). The demo reads its
 * schema off the file with `describeSource` and renders the names as headers,
 * so they get normalised here rather than aliased in seven different places
 * later.
 *
 * `trip_id` is ours. The TLC ships no primary key, and the grid needs a stable
 * `getRowId` — without one, row selection is positional and breaks the moment
 * somebody sorts. Assigned over a fully-specified ordering so it is the same
 * integer on every run.
 */
await connection.run(`CREATE TABLE trips AS
  SELECT
    row_number() OVER (
      ORDER BY tpep_pickup_datetime, tpep_dropoff_datetime,
               PULocationID, DOLocationID, total_amount
    ) AS trip_id,
    tpep_pickup_datetime   AS picked_up_at,
    tpep_dropoff_datetime  AS dropped_off_at,
    PULocationID::INTEGER  AS pickup_location_id,
    DOLocationID::INTEGER  AS dropoff_location_id,
    passenger_count::INTEGER AS passengers,
    trip_distance          AS distance_miles,
    fare_amount,
    tip_amount,
    tolls_amount,
    total_amount,
    payment_type::INTEGER  AS payment_type,
    VendorID::INTEGER      AS vendor_id,
    store_and_fwd_flag
  FROM ${literal(tripsSource)}
  WHERE tpep_pickup_datetime >= TIMESTAMP ${literal(FROM)}
    AND tpep_pickup_datetime <  TIMESTAMP ${literal(TO)}`);

/*
 * Written sorted by `trip_id`, which is pickup order.
 *
 * Not cosmetic. DuckDB writes one row group per 122,880 rows and records each
 * one's min/max per column in the footer; a query with a timestamp predicate
 * skips the row groups that cannot match, and over HTTP that is the difference
 * between fetching a few hundred kB and fetching the file. Clustering the sort
 * key is what makes those statistics selective enough to be worth having.
 */
await connection.run(
  `COPY (SELECT * FROM trips ORDER BY trip_id) ` +
    `TO ${literal(join(OUT, 'taxi-trips.parquet'))} ` +
    `(FORMAT PARQUET, COMPRESSION ZSTD)`
);

/*
 * The zones as JSON rather than the CSV they arrive as, so DuckDB reads them
 * with `registerJsonSource` exactly like `users.json` — one fetch, no CSV
 * sniffing. 265 rows, 12 kB; it is a lookup table, not a data source.
 */
const zones = await rows(
  `SELECT "LocationID"::INTEGER AS location_id,
          "Borough" AS borough,
          "Zone" AS zone,
          "service_zone"
   FROM read_csv_auto(${literal(zonesSource)})
   ORDER BY location_id`
);
// Indented, with a trailing newline, because `format:check` runs over
// `examples/public/data` and this is what Prettier would rewrite it to. A
// fixture the formatter wants to change is a permanently dirty repo.
await writeFile(
  join(OUT, 'taxi-zones.json'),
  `${JSON.stringify(zones, null, 2)}\n`
);

const [summary] = await rows(`SELECT count(*) AS n FROM trips`);
const { size } = await stat(join(OUT, 'taxi-trips.parquet'));

console.log(
  `build-taxi-fixture: ${Number(summary.n).toLocaleString('en-US')} trips ` +
    `(parquet, ${(size / 1e6).toFixed(1)} MB), ` +
    `${String(zones.length)} zones (json) → examples/public/data`
);

connection.closeSync();
instance.closeSync();
