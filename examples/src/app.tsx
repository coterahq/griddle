import * as React from 'react';
import {
  createDataGridViewModel,
  createGridStore,
  DataGrid,
  DATA_GRID_THEME_CLASS,
} from '../../src';
import type { DataGridCellEdit } from '../../src';
import { makeOrders, ORDER_COLUMNS, orderStats } from './data';
import type { Order } from './data';

/*
 * The shipped theme files, as URLs rather than as imports.
 *
 * A bundled `import './themes/dark.css'` is unconditional and permanent, and
 * this page needs to swap between them. Real `<link>` elements are also what a
 * consumer actually writes, so the switcher below exercises the published
 * artifacts rather than a reimplementation of them.
 */
import lightHref from '../../dist/themes/light.css?url';
import darkHref from '../../dist/themes/dark.css?url';
import coteraHref from '../../dist/themes/cotera.css?url';

/**
 * The visual baseline for the theming milestone, and the seed of the demo site
 * L7 grows here.
 *
 * Its job is to put every colour token on screen at once from the *published*
 * stylesheet — `dist/style.css`, after the `:root` rescoping, not
 * `styles/grid.css` — under both palettes and both schemes.
 *
 * The two axes are separate on purpose. `cotera.css` is nine lines of
 * `--dg-bg: var(--background)`, and the library ships no dark-mode rules at
 * all; switching to `cotera` + `dark` moves only the *host's* tokens, and the
 * grid follows through the aliases. If that pair ever needs a rule inside the
 * library, the two-tier design has failed and this page is where it shows.
 */

type Palette = 'library' | 'cotera';
type Scheme = 'light' | 'dark';

const ROWS = makeOrders(500);
const STATS = orderStats(ROWS);

/**
 * Both axes are addressable as `?palette=cotera&scheme=dark`.
 *
 * Screenshot capture needs it — a headless browser can load a URL but cannot
 * click a toggle — and it makes any particular combination linkable in a bug
 * report, which is worth more than the six lines it costs.
 */
const fromQuery = <T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T
): T => {
  const value = new URLSearchParams(window.location.search).get(key);
  return allowed.find((candidate) => candidate === value) ?? fallback;
};

export function App(): React.ReactElement {
  const [palette, setPalette] = React.useState<Palette>(() =>
    fromQuery('palette', ['library', 'cotera'] as const, 'library')
  );
  const [scheme, setScheme] = React.useState<Scheme>(() =>
    fromQuery('scheme', ['light', 'dark'] as const, 'light')
  );
  const [edits, setEdits] = React.useState<DataGridCellEdit[]>([]);

  const rows = React.useMemo(() => createGridStore<Order[]>(ROWS), []);
  const columnStats = React.useMemo(() => createGridStore(STATS), []);
  const viewModel = React.useMemo(
    () =>
      createDataGridViewModel<Order>({
        columns: ORDER_COLUMNS,
        totalRows: ROWS.length,
        totalLoadedRows: ROWS.length,
        // Non-zero, so the row detail panel — and its expand gutter — exist.
        expansionHeight: 96,
      }),
    []
  );

  React.useEffect(() => {
    const link = (href: string, enabled: boolean): void => {
      const id = `theme-${href}`;
      let element = document.getElementById(id) as HTMLLinkElement | null;
      if (element === null) {
        element = document.createElement('link');
        element.id = id;
        element.rel = 'stylesheet';
        element.href = href;
        document.head.append(element);
      }
      element.disabled = !enabled;
    };

    // One `.dark` for the whole page. Under `library` the grid reads it via
    // `dark.css`; under `cotera` the grid never sees it — `host.css` moves
    // `--background` and the aliases carry it the rest of the way.
    document.documentElement.classList.toggle('dark', scheme === 'dark');
    document.documentElement.dataset['hostTheme'] = palette;

    link(lightHref, palette === 'library');
    link(darkHref, palette === 'library');
    link(coteraHref, palette === 'cotera');
  }, [palette, scheme]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>@cotera/data-grid</h1>
          <p>
            L2 theming baseline — {ROWS.length.toLocaleString()} rows, nine
            tier-1 tokens, no host palette required.
          </p>
        </div>
        <div className="switches">
          <div className="switch" role="radiogroup" aria-label="Palette">
            {(['library', 'cotera'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={palette === option}
                onClick={() => {
                  setPalette(option);
                }}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="switch" role="radiogroup" aria-label="Colour scheme">
            {(['light', 'dark'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={scheme === option}
                onClick={() => {
                  setScheme(option);
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/*
       * The token scope. Everything the grid paints is defined here, so the
       * page around it keeps its own styling untouched — which is the claim
       * `style.css` shipping zero `:root` selectors is meant to support.
       */}
      <main className={`${DATA_GRID_THEME_CLASS} grid-frame`}>
        <DataGrid<Order>
          rows={rows}
          columnStats={columnStats}
          getRowId={(row) => row.id}
          viewModel={viewModel}
          onCellEdit={(edit) => {
            setEdits((current) => [...current, edit]);
          }}
          onSaveEdits={() => {
            setEdits([]);
          }}
          onRevertEdits={() => {
            setEdits([]);
          }}
          renderRowDetail={({ row }) => (
            <div className="detail">
              <strong>{row.id}</strong> · {row.customer} · {row.region} ·{' '}
              {row.items} items
            </div>
          )}
        />
      </main>

      <footer className="page-footer">
        {edits.length === 0
          ? 'Double-click a Customer or Status cell to edit · click the chevron in the gutter for column stats.'
          : `${String(edits.length)} pending edit(s)`}
      </footer>
    </div>
  );
}
