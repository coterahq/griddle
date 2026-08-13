import * as React from 'react';
import { DataGrid, createDataGridViewModel } from '../../../src';
import { createGridController } from '../../../src/source';
import { createMemoryDataSource } from '../../../src/memory';
import { makeOrders, ORDER_COLUMNS } from '../data';
import type { Order } from '../data';
import { DemoFrame } from '../demo-frame';

/**
 * The theme playground, which doubles as the theming documentation.
 *
 * Nine tier-1 tokens. That is the entire surface a theme has to supply, and
 * the point of putting an editor on screen is that you can watch all 39
 * derived tokens move with them — a row stripe, a focus ring, a chart bar and
 * a skeleton pulse all follow from `--dg-muted` and `--dg-accent` without any
 * of them being named here.
 *
 * The derived values are `color-mix(in oklab, var(--dg-accent) N%, transparent)`
 * — byte for byte the expression Tailwind compiles `bg-primary/N` to, which is
 * what makes "pixel-identical to the grid this was extracted from" a claim
 * that can be checked rather than asserted.
 */

const ROWS = makeOrders(400);

type Token =
  | '--dg-bg'
  | '--dg-fg'
  | '--dg-muted'
  | '--dg-muted-fg'
  | '--dg-border'
  | '--dg-accent'
  | '--dg-accent-fg'
  | '--dg-popover'
  | '--dg-popover-fg';

const PRESETS: Record<string, Record<Token, string>> = {
  light: {
    '--dg-bg': '#ffffff',
    '--dg-fg': '#0a0a0a',
    '--dg-muted': '#f4f4f5',
    '--dg-muted-fg': '#71717a',
    '--dg-border': '#e4e4e7',
    '--dg-accent': '#2563eb',
    '--dg-accent-fg': '#fafafa',
    '--dg-popover': '#ffffff',
    '--dg-popover-fg': '#0a0a0a',
  },
  dark: {
    '--dg-bg': '#09090b',
    '--dg-fg': '#fafafa',
    '--dg-muted': '#27272a',
    '--dg-muted-fg': '#a1a1aa',
    '--dg-border': '#27272a',
    '--dg-accent': '#3b82f6',
    '--dg-accent-fg': '#0a0a0a',
    '--dg-popover': '#18181b',
    '--dg-popover-fg': '#fafafa',
  },
  cotera: {
    '--dg-bg': '#fffdf9',
    '--dg-fg': '#2a2118',
    '--dg-muted': '#f3ece1',
    '--dg-muted-fg': '#8a7a66',
    '--dg-border': '#e6dccc',
    '--dg-accent': '#b45309',
    '--dg-accent-fg': '#fffdf9',
    '--dg-popover': '#fffdf9',
    '--dg-popover-fg': '#2a2118',
  },
  terminal: {
    '--dg-bg': '#0b1210',
    '--dg-fg': '#c8f2d8',
    '--dg-muted': '#16241f',
    '--dg-muted-fg': '#6f9a84',
    '--dg-border': '#1d332b',
    '--dg-accent': '#31d68b',
    '--dg-accent-fg': '#04120b',
    '--dg-popover': '#0f1a16',
    '--dg-popover-fg': '#c8f2d8',
  },
};

const LABELS: Record<Token, string> = {
  '--dg-bg': 'Surface',
  '--dg-fg': 'Text',
  '--dg-muted': 'Muted surface',
  '--dg-muted-fg': 'Muted text',
  '--dg-border': 'Border',
  '--dg-accent': 'Accent',
  '--dg-accent-fg': 'On accent',
  '--dg-popover': 'Popover surface',
  '--dg-popover-fg': 'Popover text',
};

const TOKENS = Object.keys(LABELS) as Token[];

export function ThemingDemo(): React.ReactElement {
  const [tokens, setTokens] = React.useState(
    PRESETS['light'] as Record<Token, string>
  );

  const viewModel = React.useMemo(
    () => createDataGridViewModel<Order>({ columns: ORDER_COLUMNS }),
    []
  );
  const controller = React.useMemo(
    () =>
      createGridController<Order>({
        source: createMemoryDataSource<Order>({
          rows: ROWS,
          columns: ORDER_COLUMNS,
        }),
        viewModel,
        getRowId: (row) => row.id,
      }),
    [viewModel]
  );
  React.useEffect(
    () => () => {
      controller.dispose();
    },
    [controller]
  );

  // Set on the grid's own wrapper rather than on `:root`, which is the shape a
  // consumer's override takes and the reason the library defines nothing
  // globally.
  const style = Object.fromEntries(
    TOKENS.map((token) => [token, tokens[token]])
  ) as React.CSSProperties;

  return (
    <DemoFrame
      title="Theme playground"
      blurb={
        <>
          Nine tokens. Everything else — the row stripe, three focus-ring
          weights, the chart bars, the skeleton pulse — is derived from them
          with <code>color-mix</code>, so a theme is nine lines and never a
          colour audit.
        </>
      }
      toolbar={
        <div className="preset-row">
          {Object.keys(PRESETS).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                setTokens(PRESETS[name] as Record<Token, string>);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      }
      details={{
        label: 'These nine values, as CSS',
        body: `.cotera-data-grid {\n${TOKENS.map(
          (token) => `  ${token}: ${tokens[token]};`
        ).join('\n')}\n}`,
      }}
    >
      <div className="theming-layout" style={style}>
        <div className="token-editor">
          {TOKENS.map((token) => (
            <label key={token}>
              <input
                type="color"
                value={tokens[token]}
                onChange={(event) => {
                  setTokens((current) => ({
                    ...current,
                    [token]: event.target.value,
                  }));
                }}
              />
              <span>
                {LABELS[token]}
                <code>{token}</code>
              </span>
            </label>
          ))}
        </div>
        <div className="theming-grid">
          <DataGrid<Order>
            {...controller.gridProps}
            getRowId={(row) => row.id}
            viewModel={viewModel}
          />
        </div>
      </div>
    </DemoFrame>
  );
}
