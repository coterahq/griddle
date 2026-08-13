import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';

/*
 * The published stylesheet, not `styles/grid.css`.
 *
 * `dist/style.css` is the post-processed artifact — Tailwind's theme layer
 * already rescoped off `:root`. Importing the source would skip that step and
 * make the examples app the one place in the world where the library's central
 * guarantee is not exercised. Run `bun run build:css` first.
 */
import '../../dist/style.css';
import './host.css';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('missing #root');
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
