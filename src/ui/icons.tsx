import * as React from 'react';

/**
 * The eighteen glyphs the default chrome draws.
 *
 * Vendored as inline SVG rather than taken as a dependency: an icon package is
 * a large install and a version to keep in step, for a fixed set the library
 * never adds to at runtime. Geometry follows Heroicons (outline, 1.5 stroke)
 * and Lucide (2 stroke), both permissively licensed — see NOTICE.
 *
 * A host with its own icon set overrides them through
 * {@link DataGridIconsProvider} rather than restyling these.
 */
export type DataGridIconName =
  | 'adjustments-horizontal'
  | 'arrow-left-end-on-rectangle'
  | 'arrow-right-end-on-rectangle'
  | 'calendar-days'
  | 'chevron-down'
  | 'chevron-right'
  | 'clear-filters'
  | 'clock-reset'
  | 'ellipsis-horizontal'
  | 'eye-slash'
  | 'file-text'
  | 'list-bullet'
  | 'list-ordered'
  | 'list-todo'
  | 'magnifying-glass'
  | 'pin-off'
  | 'sort-asc'
  | 'sort-desc'
  | 'table-cells'
  | 'x-mark';

export type DataGridIconComponent = React.ComponentType<{
  className?: string;
  style?: React.CSSProperties;
}>;

type SvgProps = { className?: string; style?: React.CSSProperties };

const Svg = ({
  children,
  strokeWidth = 1.5,
  ...props
}: SvgProps & {
  children: React.ReactNode;
  strokeWidth?: number;
}): React.ReactElement => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    {children}
  </svg>
);

const DEFAULT_ICONS: Record<DataGridIconName, DataGridIconComponent> = {
  'adjustments-horizontal': (p) => (
    <Svg {...p}>
      <path d="M3 6h18M3 12h18M3 18h18" />
      <circle cx="8" cy="6" r="2" fill="currentColor" stroke="none" />
      <circle cx="16" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="18" r="2" fill="currentColor" stroke="none" />
    </Svg>
  ),
  'arrow-left-end-on-rectangle': (p) => (
    <Svg {...p}>
      <path d="M9 15 5.25 12 9 9" />
      <path d="M5.25 12H15" />
      <path d="M15 4.5h1.5a2.25 2.25 0 0 1 2.25 2.25v10.5A2.25 2.25 0 0 1 16.5 19.5H15" />
    </Svg>
  ),
  'arrow-right-end-on-rectangle': (p) => (
    <Svg {...p}>
      <path d="m15 15 3.75-3L15 9" />
      <path d="M18.75 12H9" />
      <path d="M9 4.5H7.5a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 7.5 19.5H9" />
    </Svg>
  ),
  'calendar-days': (p) => (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="M7.5 14h.01M12 14h.01M16.5 14h.01M7.5 17.5h.01M12 17.5h.01" />
    </Svg>
  ),
  'chevron-down': (p) => (
    <Svg {...p} strokeWidth={2}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  ),
  'chevron-right': (p) => (
    <Svg {...p} strokeWidth={2}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  ),
  'clear-filters': (p) => (
    <Svg {...p}>
      <path d="M3 4.5h18l-7 8v6l-4 2v-8z" />
      <path d="m16 16 5 5M21 16l-5 5" strokeWidth={2} />
    </Svg>
  ),
  'clock-reset': (p) => (
    <Svg {...p} strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  ),
  'ellipsis-horizontal': (p) => (
    <Svg {...p}>
      <circle cx="5.5" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.25" fill="currentColor" stroke="none" />
    </Svg>
  ),
  'eye-slash': (p) => (
    <Svg {...p}>
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
      <path d="M9.4 5.4A9.6 9.6 0 0 1 12 5c5 0 9 4.5 9 7a11 11 0 0 1-2.4 3.5" />
      <path d="M6.2 6.7C4.2 8.1 3 10.2 3 12c0 2.5 4 7 9 7a9.4 9.4 0 0 0 3.6-.7" />
    </Svg>
  ),
  'file-text': (p) => (
    <Svg {...p} strokeWidth={2}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </Svg>
  ),
  'list-bullet': (p) => (
    <Svg {...p}>
      <path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12" />
      <circle cx="4" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="17.5" r="1" fill="currentColor" stroke="none" />
    </Svg>
  ),
  'list-ordered': (p) => (
    <Svg {...p} strokeWidth={2}>
      <path d="M10 6h11M10 12h11M10 18h11" />
      <path d="M4 6h1v4M4 10h2" />
      <path d="M4 15.5a1 1 0 0 1 2 0c0 .8-2 1.3-2 2.5h2" />
    </Svg>
  ),
  'list-todo': (p) => (
    <Svg {...p} strokeWidth={2}>
      <rect x="3" y="4" width="6" height="6" rx="1" />
      <path d="m4.5 7 1.3 1.3L8 6" />
      <path d="M12 6h9M12 12h9M12 18h9" />
      <path d="M4 14.5h4M4 18h4" />
    </Svg>
  ),
  'magnifying-glass': (p) => (
    <Svg {...p}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </Svg>
  ),
  'pin-off': (p) => (
    <Svg {...p} strokeWidth={2}>
      <path d="M3 3l18 18" />
      <path d="M15 4.5 19.5 9l-2.7 1.4a4 4 0 0 0-1.6 1.6l-.5 1L10 9.3l1-.5a4 4 0 0 0 1.6-1.6z" />
      <path d="m10.5 13.5-5 5" />
    </Svg>
  ),
  // NOTE: the original mapped 'sort-asc' to a Z→A glyph and 'sort-desc' to an
  // A→Z one, which is inverted. Corrected here — a new library should not ship
  // with the arrows pointing the wrong way.
  'sort-asc': (p) => (
    <Svg {...p} strokeWidth={2}>
      <path d="M5 6v13M5 19l-2.5-2.5M5 19l2.5-2.5" />
      <path d="M11 7h4M11 12h7M11 17h10" />
    </Svg>
  ),
  'sort-desc': (p) => (
    <Svg {...p} strokeWidth={2}>
      <path d="M5 18V5M5 5 2.5 7.5M5 5l2.5 2.5" />
      <path d="M11 7h10M11 12h7M11 17h4" />
    </Svg>
  ),
  'table-cells': (p) => (
    <Svg {...p} strokeWidth={2}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M3 15h18M9 4v16M15 4v16" />
    </Svg>
  ),
  'x-mark': (p) => (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  ),
};

const IconsContext = React.createContext<
  Partial<Record<DataGridIconName, DataGridIconComponent>>
>({});

/**
 * Substitutes the host's own glyphs for any subset of the defaults.
 *
 * Exists so an app embedding the grid keeps one visual vocabulary rather than
 * two — and so a migration off an existing in-app grid can be pixel-identical
 * on day one, then drop the mapping once someone confirms the defaults look
 * right.
 */
export function DataGridIconsProvider({
  icons,
  children,
}: {
  icons: Partial<Record<DataGridIconName, DataGridIconComponent>>;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <IconsContext.Provider value={icons}>{children}</IconsContext.Provider>
  );
}

const SIZES = {
  small: 'w-3 h-3',
  regular: 'w-4 h-4',
  large: 'w-5 h-5',
} as const;

export function Icon({
  icon,
  className,
  size = 'regular',
  style,
}: {
  icon: DataGridIconName;
  className?: string;
  size?: keyof typeof SIZES;
  style?: React.CSSProperties;
}): React.ReactElement {
  const overrides = React.useContext(IconsContext);
  const Component = overrides[icon] ?? DEFAULT_ICONS[icon];
  return (
    <Component
      className={`${SIZES[size]}${className === undefined ? '' : ` ${className}`}`}
      style={style}
    />
  );
}
