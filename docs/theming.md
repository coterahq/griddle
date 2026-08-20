# Theming and component overrides

<kbd><a href="../README.md">← README</a></kbd>

## Nine tokens

That's the whole surface:

```css
.cotera-griddle {
  --dg-bg: #ffffff;
  --dg-fg: #0a0a0a;
  --dg-muted: #f4f4f5;
  --dg-muted-fg: #71717a;
  --dg-border: #e4e4e7;
  --dg-accent: #2563eb;
  --dg-accent-fg: #fafafa;
  --dg-popover: #ffffff;
  --dg-popover-fg: #0a0a0a;
}
```

Thirty-nine more tokens sit behind those, one per thing the grid paints: the row
stripe, three different focus-ring weights, the chart bars, the skeleton pulse.
Each derives from the nine with `color-mix(in oklab, …)` and each can be
overridden on its own if you want to move one without moving the others.
Ready-made themes ship at
`@cotera/griddle/themes/{light,dark,dark-auto,cotera}.css`.

There are no dark-mode rules in the library at all. Colour only ever arrives
through those nine, which means `themes/cotera.css` is nine lines of
`--dg-bg: var(--background)` and dark mode follows your app's own `.dark` for
free.

## Nothing is defined on `:root`

Every custom property lives on `.cotera-griddle`, and the build fails if a
single `:root` or `:host` selector survives into `dist/style.css`. Drop this
stylesheet into a page you don't control and it cannot change anything outside
the grid. That's not a promise, it's an assertion in `scripts/build-css.mjs`.

## Set tokens on the grid, not on a wrapper

`DataGrid` puts `.cotera-griddle` on its own root, which is where those defaults
land — and a declaration on an element always beats a value inherited from an
ancestor. So setting tokens on a _wrapper_ does nothing:

```tsx
<DataGrid style={{ '--dg-accent': '#b45309' } as React.CSSProperties} … />
```

A rule that matches the grid itself (`.dark .cotera-griddle { … }`) works too. A
wrapper does not, and it fails silently, which is why it's called out here.

## Overriding components

`CellComponent`, `HeaderComponent`, `RowComponent`, `TopBarComponent` and
`FooterComponent` each replace a default wholesale. No config object, no
seventeen props to discover. Swap the component, render what you want. Anything
you write that paints with `--dg-*` follows the theme without knowing the theme
exists.
