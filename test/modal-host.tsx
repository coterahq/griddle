import * as React from 'react';
import { DataGridModalHostProvider } from '../src/ui/modal-host';
import type {
  DataGridModalHost,
  DataGridModalPage,
} from '../src/ui/modal-host';

/**
 * A minimal stand-in for a host application's modal stack.
 *
 * The grid's filter dialog has two paths: render itself as a plain dialog, or
 * hand its content to whatever modal system the host already has. This is the
 * second path, implemented the smallest way that still exercises it — push a
 * page, render it with its title and subtitle, pop it on close.
 *
 * Test-only, so it deliberately has no animation, no focus trap and no
 * stacking. Those are the host's business, and none of them is what the grid's
 * specs are asserting.
 */
export function TestModalHostProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [pages, setPages] = React.useState<DataGridModalPage[]>([]);

  const host = React.useMemo<DataGridModalHost>(
    () => ({
      push: (page) => {
        setPages((current) => [...current, page]);
      },
      pop: () => {
        setPages((current) => current.slice(0, -1));
      },
    }),
    []
  );

  const top = pages.at(-1);

  return (
    <DataGridModalHostProvider host={host}>
      {children}
      {top === undefined ? null : (
        <div role="dialog" aria-label={top.title} data-testid="test-modal">
          <div>{top.title}</div>
          {top.subtitle === undefined ? null : <div>{top.subtitle}</div>}
          {top.view()}
        </div>
      )}
    </DataGridModalHostProvider>
  );
}
