import * as React from 'react';
import { DATA_GRID_THEME_CLASS } from '../../src';

/**
 * The chrome around every demo: a title, a claim, and the grid.
 *
 * Written in plain CSS with no Tailwind and no `--dg-*`, because the page is
 * standing in for an app we do not control. If importing the library ever
 * changed how this header or these buttons look, that is the leak
 * `dist/style.css` shipping zero `:root` selectors exists to prevent, and this
 * is where it would show.
 */
export function DemoFrame({
  title,
  blurb,
  children,
  footnote,
  details,
  error,
  pending,
  toolbar,
}: {
  title: string;
  blurb: React.ReactNode;
  children: React.ReactNode;
  footnote?: string;
  details?: { label: string; body: string };
  error?: Error | null;
  pending?: string | null;
  toolbar?: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="demo">
      <header className="demo-header">
        <div>
          <h2>{title}</h2>
          <p>{blurb}</p>
        </div>
        {toolbar === undefined ? null : (
          <div className="demo-toolbar">{toolbar}</div>
        )}
      </header>

      {/*
       * The token scope. Also applied by `DataGrid` to its own root, so this
       * is belt and braces — but it is what a consumer theming a wider region
       * would write, and the demo should show that rather than rely on the
       * grid doing it silently.
       */}
      <div className={`${DATA_GRID_THEME_CLASS} demo-grid`}>
        {error != null ? (
          <p className="demo-error">{error.message}</p>
        ) : pending != null ? (
          <p className="demo-pending">{pending}</p>
        ) : (
          children
        )}
      </div>

      {details === undefined ? null : (
        <details className="demo-details">
          <summary>{details.label}</summary>
          <pre>{details.body}</pre>
        </details>
      )}
      {footnote === undefined ? null : (
        <p className="demo-footnote">{footnote}</p>
      )}
    </section>
  );
}
