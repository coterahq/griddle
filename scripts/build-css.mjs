import { execFile } from 'node:child_process';
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = new URL('../', import.meta.url).pathname;
const STYLES = join(ROOT, 'styles');
const DIST = join(ROOT, 'dist');

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

if (!(await exists(join(STYLES, 'grid.css')))) {
  console.log(
    'build-css: styles/grid.css not present yet (arrives at L2) — skipping'
  );
  process.exit(0);
}

await mkdir(join(DIST, 'themes'), { recursive: true });

const raw = join(DIST, 'style.raw.css');
await run('npx', [
  '@tailwindcss/cli',
  '-i',
  join(STYLES, 'grid.css'),
  '-o',
  raw,
  '--minify',
]);

/**
 * Tailwind emits its theme layer as `@layer theme { :root, :host { --spacing: … } }`.
 *
 * Shipping `:root` custom properties from a library is leakage: a consumer who
 * defines `--spacing` globally is then in a load-order race with us. Rescoping
 * to the grid's own root class fixes it — custom properties inherit, so every
 * descendant still sees them.
 */
let css = await readFile(raw, 'utf8');
css = css.replace(/(^|[},])\s*:root\s*,\s*:host\s*\{/g, '$1.cotera-data-grid{');
css = css.replace(/(^|[},])\s*:root\s*\{/g, '$1.cotera-data-grid{');
css = css.replace(/(^|[},])\s*:host\s*\{/g, '$1.cotera-data-grid{');

// The guarantee, not a hope: if any selector survived, the build fails loudly
// rather than silently shipping globals into every consumer's page.
const leaked = css.match(/(^|[},\s])(:root|:host)\b/g);
if (leaked !== null) {
  console.error(
    `build-css: ${String(leaked.length)} :root/:host selector(s) survived rescoping.\n` +
      'These would leak library globals into the host page. Fix the rewrite above.'
  );
  process.exit(1);
}

await writeFile(join(DIST, 'style.css'), css);

for (const file of await readdir(join(STYLES, 'themes'))) {
  await copyFile(join(STYLES, 'themes', file), join(DIST, 'themes', file));
}

console.log(
  `build-css: wrote dist/style.css (${String(css.length)} bytes), themes copied`
);
