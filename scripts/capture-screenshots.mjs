import { execFile } from 'node:child_process';
import { access, mkdir, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Captures the examples app in every palette × scheme combination.
 *
 * This is the milestone's visual evidence, and the reason it is a script
 * rather than four manual screenshots is that a baseline nobody can reproduce
 * is not a baseline. L7 turns these into a visual-regression check; for now
 * they are the before/after for the theming rewrite.
 *
 * Deliberately no Playwright. The captures need one thing a headless browser
 * already does from the command line — load a URL, wait, write a PNG — and the
 * app makes both axes addressable as query parameters precisely so no click
 * driver is required. A browser-automation dependency for four screenshots
 * would be the largest devDependency in the repo.
 *
 *   bun run examples:build && node scripts/capture-screenshots.mjs
 */

const ROOT = new URL('../', import.meta.url).pathname;
const DIST = join(ROOT, 'examples/dist');
const OUT = join(ROOT, 'screenshots');
const PORT = 8817;

const CHROME_CANDIDATES = [
  process.env['CHROME_PATH'],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((path) => typeof path === 'string' && path !== '');

const COMBINATIONS = [
  { name: 'library-light', palette: 'library', scheme: 'light' },
  { name: 'library-dark', palette: 'library', scheme: 'dark' },
  { name: 'cotera-light', palette: 'cotera', scheme: 'light' },
  { name: 'cotera-dark', palette: 'cotera', scheme: 'dark' },
];

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const chrome = await (async () => {
  for (const candidate of CHROME_CANDIDATES) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return null;
})();

if (chrome === null) {
  console.error(
    'capture-screenshots: no Chrome or Chromium found.\n' +
      'Set CHROME_PATH to a binary, or install one of:\n' +
      CHROME_CANDIDATES.map((c) => `  ${c}`).join('\n')
  );
  process.exit(1);
}

if (!(await exists(join(DIST, 'index.html')))) {
  console.error(
    'capture-screenshots: examples/dist is empty — run `bun run examples:build` first.'
  );
  process.exit(1);
}

await mkdir(OUT, { recursive: true });

// A static server rather than file://, because the app is an ES module and
// module scripts are blocked by CORS on the file protocol.
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${String(PORT)}`);
  const path = join(DIST, normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  const file = path.endsWith('/') ? join(path, 'index.html') : path;
  createReadStream(file)
    .on('error', () => {
      response.writeHead(404).end();
    })
    .once('open', () => {
      response.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      });
    })
    .pipe(response);
});

await new Promise((resolve) => server.listen(PORT, resolve));

try {
  for (const { name, palette, scheme } of COMBINATIONS) {
    const url = `http://localhost:${String(PORT)}/index.html?palette=${palette}&scheme=${scheme}`;
    await run(chrome, [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      // The grid measures itself from ResizeObserver and renders rows in an
      // effect, so a naive capture races the first paint. Virtual time runs
      // the clock forward without waiting for it.
      '--virtual-time-budget=4000',
      '--window-size=1500,940',
      `--screenshot=${join(OUT, `${name}.png`)}`,
      url,
    ]);
    console.log(`  ${name}.png`);
  }
} finally {
  server.close();
}

const written = (await readdir(OUT)).filter((f) => f.endsWith('.png'));
console.log(
  `capture-screenshots: wrote ${String(written.length)} to screenshots/`
);
