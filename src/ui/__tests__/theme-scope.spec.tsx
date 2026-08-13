import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataGridOverlay } from '../../core/overlay';
import { Dialog, DialogContent } from '../dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../dropdown-menu';
import { DATA_GRID_THEME_CLASS } from '../theme-scope';
import { Tooltip } from '../tooltip';

/**
 * Every portal in this library must re-establish the token scope.
 *
 * `--dg-*` is defined on `.cotera-data-grid` rather than on `:root`, which is
 * what stops the stylesheet leaking globals into a host page. The cost is that
 * a React portal — which mounts to `document.body`, outside the grid — escapes
 * the scope and renders with every colour unresolved.
 *
 * That failure is close to undetectable by eye during development: a host app
 * that happens to define the same token names paints the portal correctly
 * anyway, and the bug only appears in production against a host that does not.
 * So it gets a test rather than a review checklist item.
 *
 * There are four portal sites. Each is asserted from the *content* outward —
 * `closest()` rather than a query on the wrapper — so the test still holds if
 * the scope moves to a different depth, and still fails if it disappears.
 */
const assertScoped = (node: HTMLElement | null): void => {
  expect(node).not.toBeNull();
  expect(node?.closest(`.${DATA_GRID_THEME_CLASS}`)).not.toBeNull();
};

describe('portalled content carries the theme scope', () => {
  it('scopes the cell overlay', () => {
    render(
      <DataGridOverlay
        overlay={{
          anchor: document.createElement('div'),
          content: <span>overlay body</span>,
        }}
        onClose={() => undefined}
      />
    );

    assertScoped(screen.getByText('overlay body'));
  });

  it('scopes dialog content', () => {
    render(
      <Dialog open>
        <DialogContent aria-label="Filter">
          <span>dialog body</span>
        </DialogContent>
      </Dialog>
    );

    assertScoped(screen.getByText('dialog body'));
  });

  it('scopes dropdown menu content', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuContent>
          <DropdownMenuItem>menu body</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    assertScoped(screen.getByText('menu body'));
  });

  it('scopes tooltip content', () => {
    render(
      <Tooltip
        asChild
        side="top"
        trigger="click"
        tooltipContent={<>tooltip body</>}
      >
        <button type="button">open</button>
      </Tooltip>
    );

    fireEvent.click(screen.getByRole('button', { name: 'open' }));

    assertScoped(screen.getByText('tooltip body'));
  });
});

describe('the theme scope itself', () => {
  // `display: contents` so re-scoping costs no layout box — a portal target
  // that suddenly had a block wrapper would break the positioned content
  // inside it.
  it('adds no layout box', () => {
    render(
      <DataGridOverlay
        overlay={{
          anchor: document.createElement('div'),
          content: <span>overlay body</span>,
        }}
        onClose={() => undefined}
      />
    );

    const scope = screen
      .getByText('overlay body')
      .closest(`.${DATA_GRID_THEME_CLASS}`);

    expect(scope?.className).toContain('contents');
  });
});
