import * as React from 'react';
import { CsvDemo } from './demos/csv';
import { MemoryDemo } from './demos/memory';
import { ParquetDemo } from './demos/parquet';
import { TaxiDemo } from './demos/taxi';
import { HttpDemo } from './demos/http';
import { OverridesDemo } from './demos/overrides';
import { ThemingDemo } from './demos/theming';
import { ThreeSourcesDemo } from './demos/three-sources';

/*
 * The shipped theme files, as URLs rather than as imports.
 *
 * A bundled `import './themes/dark.css'` is unconditional and permanent, and
 * this page swaps between them. Real `<link>` elements are also what a
 * consumer writes, so the switcher exercises the published artifacts rather
 * than a reimplementation of them.
 */
import lightHref from '../../dist/themes/light.css?url';
import darkHref from '../../dist/themes/dark.css?url';

type DemoId =
  | 'parquet'
  | 'csv'
  | 'three-sources'
  | 'taxi'
  | 'memory'
  | 'http'
  | 'theming'
  | 'overrides';
type Scheme = 'light' | 'dark';

/*
 * Order is the argument.
 *
 * One parquet file first, because "point it at a file, get a working grid" is
 * the smallest true thing this library does and the fastest to understand. The
 * cross-source join is the interesting claim, but it lands better once you have
 * already seen the simple case work.
 *
 * Then the taxi data, immediately after the join it is the proof of. The
 * generated fixture explains the mechanism on a shape we chose; 609,698 real
 * rows and someone else's normalised lookup table are the part that is hard to
 * argue with. It goes second-to-the-join rather than first because 8.7 MB of
 * parquet is a poor thing to open on, and because "sorting by a joined column
 * is a query, not a page reorder" is a claim you have to have already heard.
 */
const DEMOS: { id: DemoId; label: string; render: () => React.ReactElement }[] =
  [
    { id: 'parquet', label: 'A parquet file', render: () => <ParquetDemo /> },
    { id: 'csv', label: 'Any CSV', render: () => <CsvDemo /> },
    {
      id: 'three-sources',
      label: 'Three sources',
      render: () => <ThreeSourcesDemo />,
    },
    { id: 'taxi', label: '600k real rows', render: () => <TaxiDemo /> },
    { id: 'memory', label: 'In memory', render: () => <MemoryDemo /> },
    { id: 'http', label: 'Over HTTP', render: () => <HttpDemo /> },
    { id: 'theming', label: 'Theming', render: () => <ThemingDemo /> },
    { id: 'overrides', label: 'Overrides', render: () => <OverridesDemo /> },
  ];

/**
 * Both axes are addressable as `?demo=memory&scheme=dark`.
 *
 * Screenshot capture needs it — a headless browser can load a URL but cannot
 * click a tab — and it makes any particular state linkable in a bug report,
 * which is worth more than the few lines it costs.
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
  const [demo, setDemo] = React.useState<DemoId>(() =>
    fromQuery(
      'demo',
      DEMOS.map((entry) => entry.id),
      'parquet'
    )
  );
  const [scheme, setScheme] = React.useState<Scheme>(() =>
    fromQuery('scheme', ['light', 'dark'] as const, 'light')
  );

  React.useEffect(() => {
    const link = (href: string): void => {
      const id = `theme-${href}`;
      if (document.getElementById(id) !== null) {
        return;
      }
      const element = document.createElement('link');
      element.id = id;
      element.rel = 'stylesheet';
      element.href = href;
      document.head.append(element);
    };

    // The class strategy: both files stay loaded and `.dark` decides. The
    // library ships no dark-mode rules of its own — `dark.css` reassigns the
    // same nine tokens, and all 39 derived ones follow.
    link(lightHref);
    link(darkHref);
    document.documentElement.classList.toggle('dark', scheme === 'dark');

    const url = new URL(window.location.href);
    url.searchParams.set('demo', demo);
    url.searchParams.set('scheme', scheme);
    window.history.replaceState(null, '', url);
  }, [demo, scheme]);

  const active = DEMOS.find((entry) => entry.id === demo) ?? DEMOS[0];

  return (
    <div className="page">
      <header className="page-header">
        <div className="brand">
          <h1>@cotera/griddle</h1>
          <p>
            A React data grid that joins multiple data sources into one view.
          </p>
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
      </header>

      <nav className="demo-nav" aria-label="Demos">
        {DEMOS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-current={entry.id === demo ? 'page' : undefined}
            onClick={() => {
              setDemo(entry.id);
            }}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {/*
       * Keyed, so switching demos unmounts the previous one rather than
       * reconciling two different grids onto the same view model — and so a
       * controller's `dispose` actually runs.
       */}
      <React.Fragment key={active?.id}>{active?.render()}</React.Fragment>
    </div>
  );
}
