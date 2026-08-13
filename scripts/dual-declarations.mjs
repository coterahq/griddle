import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Mirrors every emitted `.d.ts` to a `.d.cts` sibling.
 *
 * The package is `"type": "module"`, so its CommonJS output is `.cjs` — and a
 * `.cjs` file's types must be `.d.cts`. TypeScript will not fall back to
 * `.d.ts` there: it reads the `.d.ts` as ESM, sees the shapes disagree with a
 * `require()` call, and reports the package as "masquerading as CJS". Copying
 * is sufficient because the declaration bodies are identical; only the
 * extension carries the module-format signal.
 *
 * `attw --pack` in CI is what proves this actually worked.
 */
const DIST = new URL('../dist/', import.meta.url).pathname;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.name.endsWith('.d.ts')) {
      yield path;
    }
  }
}

let count = 0;
for await (const path of walk(DIST)) {
  const source = await readFile(path, 'utf8');
  // The sourcemap comment points at a `.d.ts.map` that describes a file which,
  // under the .cts name, no longer exists. Drop it rather than ship a 404.
  const body = source.replace(/^\/\/# sourceMappingURL=.*$/gm, '').trimEnd();
  await writeFile(path.replace(/\.d\.ts$/, '.d.cts'), `${body}\n`);
  count += 1;
}

console.log(`dual-declarations: wrote ${String(count)} .d.cts files`);
if (count === 0) {
  console.error('dual-declarations: no .d.ts files found — did tsc run?');
  process.exit(1);
}
