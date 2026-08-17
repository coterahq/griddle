import * as React from 'react';

/** The class the library's design tokens are defined on. */
export const GRIDDLE_THEME_CLASS = 'cotera-griddle';

/**
 * Re-establishes the token scope inside a portal.
 *
 * The `--dg-*` custom properties live on `.cotera-griddle` rather than
 * `:root`, so a library stylesheet cannot leak globals into the host page.
 * Custom properties inherit, so everything rendered *inside* the grid is
 * covered for free — but a React portal is not inside it. Content sent to
 * `document.body` (the cell overlay, and Radix's dialog, dropdown and
 * hover-card portals) lands outside the scope and would render with every
 * colour unresolved.
 *
 * `display: contents` so re-scoping costs no layout box.
 *
 * Every portal in this library must go through here. A missed one is invisible
 * in development against a host that happens to define the same tokens, and
 * obvious only in production against one that does not.
 */
export function DataGridThemeScope({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={`${GRIDDLE_THEME_CLASS} contents${className === undefined ? '' : ` ${className}`}`}
    >
      {children}
    </div>
  );
}
