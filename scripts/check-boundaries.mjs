import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

/*
 * The core grid depends on no adapter, and no adapter's dependencies reach it.
 *
 * That is a packaging promise — `npm install @cotera/griddle` installs no
 * database driver — and a promise nothing enforced. It survives today because
 * `src/duckdb/wasm.ts` declares the duckdb-wasm shape structurally instead of
 * importing it, and because the adapters live behind their own entry points.
 * One `import type` in the wrong file, or one shared chunk that happens to
 * carry adapter code, would break it silently: the build stays green, the
 * bundle grows, and a consumer who never touches DuckDB finds it in their
 * install tree.
 *
 * So this asserts three things after a build:
 *
 *  1. Nothing under core/, source/, store/, ui/ or internal/ imports an
 *     adapter. The dependency arrow points one way.
 *  2. No entry point's module graph mentions `@duckdb/`, and the main entry's
 *     graph carries no adapter code at all.
 *  3. The manifest declares no hard dependency on a driver.
 */

const ROOT = new URL('../', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

const failures = [];
const fail = (message) => failures.push(message);

// --------------------------------------------------------------- 1. src graph

const ADAPTERS = ['duckdb', 'http', 'memory'];
const CORE_DIRS = ['core', 'source', 'store', 'ui', 'internal'];

/** `from '../duckdb'`, `from '../../http/source'`, and the `import type` forms. */
const adapterImport = new RegExp(
  `from\\s+'(?:\\.\\.\\/)+(${ADAPTERS.join('|')})(?:\\/[^']*)?'`,
  'g'
);

/** Every .ts/.tsx under a directory, tests excluded. */
const sourcesIn = async (dir) => {
  const found = [];
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') {
          await walk(path);
        }
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(path);
      }
    }
  };
  await walk(dir);
  return found;
};

for (const dir of CORE_DIRS) {
  for (const path of await sourcesIn(join(ROOT, 'src', dir))) {
    const contents = await readFile(path, 'utf8');
    for (const match of contents.matchAll(adapterImport)) {
      fail(
        `${relative(ROOT, path)} imports the ${match[1]} adapter. ` +
          'The core must not depend on an adapter.'
      );
    }
  }
}

// -------------------------------------------------------------- 2. dist graph

/**
 * Every file reachable from an entry, chunks included.
 *
 * Checking the entry file alone would miss the case that matters most: tsup
 * hoists shared code into `chunk-*.js`, so adapter code leaking into the core
 * bundle arrives through a chunk rather than through the entry itself.
 */
const graphOf = async (entry) => {
  const seen = new Set();
  const queue = [entry];
  const contents = new Map();

  while (queue.length > 0) {
    const path = queue.pop();
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);

    let source;
    try {
      source = await readFile(path, 'utf8');
    } catch {
      fail(`${relative(ROOT, path)} is missing — run \`bun run build\` first.`);
      continue;
    }
    contents.set(path, source);

    for (const [, specifier] of source.matchAll(
      /(?:from|require\()\s*["'](\.[^"']+)["']/g
    )) {
      queue.push(resolve(dirname(path), specifier));
    }
  }

  return contents;
};

/** Markers rather than the bare word, so a comment mentioning DuckDB is fine. */
const MARKERS = {
  duckdb: ['@duckdb/', 'createDuckDbDataSource', 'createDuckDbWasmQuery'],
  memory: ['createMemoryDataSource'],
  http: ['createHttpDataSource'],
};

const ENTRIES = [
  // The main entry carries no adapter at all.
  { file: 'index.js', forbid: ['duckdb', 'memory', 'http'] },
  { file: 'index.cjs', forbid: ['duckdb', 'memory', 'http'] },
  // The other adapters must not drag a driver in either.
  { file: 'memory/index.js', forbid: ['duckdb'] },
  { file: 'http/index.js', forbid: ['duckdb'] },
  { file: 'source/index.js', forbid: ['duckdb'] },
];

for (const { file, forbid } of ENTRIES) {
  const graph = await graphOf(join(DIST, file));
  for (const [path, source] of graph) {
    for (const adapter of forbid) {
      for (const marker of MARKERS[adapter]) {
        if (source.includes(marker)) {
          fail(
            `dist/${file} reaches ${relative(DIST, path)}, which contains ` +
              `"${marker}" — the ${adapter} adapter leaked into this entry.`
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------- 3. manifest

const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));

for (const name of Object.keys(manifest.dependencies ?? {})) {
  if (name.startsWith('@duckdb/')) {
    fail(`${name} is a hard dependency. A driver belongs in an optional peer.`);
  }
}

for (const name of Object.keys(manifest.peerDependencies ?? {})) {
  if (
    name.startsWith('@duckdb/') &&
    manifest.peerDependenciesMeta?.[name]?.optional !== true
  ) {
    fail(`${name} is a required peer. Mark it optional.`);
  }
}

// ------------------------------------------------------------------- verdict

if (failures.length > 0) {
  console.error('check-boundaries: the core is not adapter-free\n');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(
  'check-boundaries: core is adapter-free, no entry pulls a driver, manifest clean'
);
