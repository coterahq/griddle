import { execFile } from 'node:child_process';
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
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

/**
 * The two theming rules that fail silently, enforced before Tailwind runs.
 *
 * Neither produces an error on its own. A `text-`, `border-` or `ring-`
 * utility is ambiguous between a colour and a size, so `text-(--dg-fg)`
 * without the data-type hint compiles to `font-size: var(--dg-fg)` — a valid
 * rule that renders wrong. And an opacity modifier on an arbitrary var
 * (`bg-(--dg-accent)/10`) re-derives an alpha at the call site, which breaks
 * the one-`color-mix`-per-pair argument that makes pixel parity checkable.
 *
 * Both are review-checklist items in the handoff. A checklist item that a
 * build can assert should be an assertion.
 */
const AMBIGUOUS = [
  'text',
  'border',
  'border-t',
  'border-b',
  'border-l',
  'border-r',
  'border-x',
  'border-y',
  'ring',
  'divide',
  'outline',
  'decoration',
  'fill',
  'stroke',
  'caret',
  'accent',
  'shadow',
];

const sources = (await readdir(join(ROOT, 'src'), { recursive: true })).filter(
  (f) => f.endsWith('.ts') || f.endsWith('.tsx')
);

const missingHint = new RegExp(
  `(?<![\\w-])(${AMBIGUOUS.join('|')})-\\(--dg-[a-z0-9-]+\\)`,
  'g'
);
const strayAlpha = /-\((?:color:)?--dg-[a-z0-9-]+\)\/[\d[]/g;
const violations = [];

for (const file of sources) {
  const text = await readFile(join(ROOT, 'src', file), 'utf8');
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(missingHint)) {
      violations.push(
        `src/${file}:${String(i + 1)}  missing (color:…) hint — ${m[0]}`
      );
    }
    for (const m of line.matchAll(strayAlpha)) {
      violations.push(
        `src/${file}:${String(i + 1)}  opacity modifier on an arbitrary var — ${m[0]}`
      );
    }
  });
}

if (violations.length > 0) {
  console.error(
    `build-css: ${String(violations.length)} theming rule violation(s):\n` +
      violations.map((v) => `  ${v}`).join('\n') +
      '\nSee the tier-2 comment block in styles/grid.css.'
  );
  process.exit(1);
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
css = css.replace(/(^|[},])\s*:root\s*,\s*:host\s*\{/g, '$1.cotera-griddle{');
css = css.replace(/(^|[},])\s*:root\s*\{/g, '$1.cotera-griddle{');
css = css.replace(/(^|[},])\s*:host\s*\{/g, '$1.cotera-griddle{');

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

/**
 * Every `--dg-*` a utility reads must be one the base layer defines.
 *
 * This catches two silent failures with one check. A typo at a call site —
 * `bg-(--dg-header-bh)` — is a perfectly valid Tailwind candidate that
 * compiles to `background-color: var(--dg-header-bh)`, resolves to nothing and
 * renders transparent. And a stray candidate scraped out of a file that is not
 * grid source mints a utility for a token that was never a token.
 *
 * Definitions are `--dg-x:` at the head of a declaration; references are
 * `var(--dg-x)`. Geometry set as inline style by `DataGrid` is declared in
 * `styles/grid.css` too, so it is covered rather than exempted.
 */
const defined = new Set(
  [...css.matchAll(/[{;]\s*(--dg-[a-z0-9-]+)\s*:/g)].map((m) => m[1])
);
const referenced = new Set(
  [...css.matchAll(/var\(\s*(--dg-[a-z0-9-]+)/g)].map((m) => m[1])
);
const undefinedTokens = [...referenced].filter((t) => !defined.has(t)).sort();
if (undefinedTokens.length > 0) {
  console.error(
    `build-css: ${String(undefinedTokens.length)} --dg-* token(s) are used but never defined:\n` +
      undefinedTokens.map((t) => `  ${t}`).join('\n') +
      '\nEach renders as an unset custom property — transparent, not an error.\n' +
      'Either the call site has a typo, or a non-source file leaked a candidate\n' +
      'into the scan (check `source(none)` and `@source` in styles/grid.css).'
  );
  process.exit(1);
}

await writeFile(join(DIST, 'style.css'), css);
// The pre-rescope intermediate. It still carries `:root`/`:host`, and `files:
// ["dist"]` would publish it — so it does not get to outlive this script.
await rm(raw, { force: true });

for (const file of await readdir(join(STYLES, 'themes'))) {
  await copyFile(join(STYLES, 'themes', file), join(DIST, 'themes', file));
}

console.log(
  `build-css: wrote dist/style.css (${String(css.length)} bytes), themes copied`
);
