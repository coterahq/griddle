// The grid itself.
export * from './core/types';
export * from './core/view-model';
export * from './core/virtualization';
export * from './core/row-offsets';
export * from './core/column-layout';
export * from './core/column-type';
export * from './core/filters';
export * from './core/format';
export * from './core/keyboard';
export * from './core/row-source';
export * from './core/selection';
export * from './core/overlay';
export * from './core/data-grid';
export * from './core/cells/base-cell';
export * from './core/cells/cell-editor';
export * from './core/cells/rich-cell';
export * from './core/headers/header';
export * from './core/headers/column-stats';
export * from './core/headers/display-options-dialog';
export * from './core/headers/filter-dialog';
export * from './core/headers/row-number-header';

// Reactivity. Every store-typed prop on the grid accepts anything satisfying
// ReadonlyGridStore, so a host with its own observable does not have to adopt
// these — but they are here for hosts that have nothing.
export { createGridStore, derivedGridStore, useGridStore } from './store';
export type {
  GridStore,
  ReadonlyGridStore,
  CreateGridStoreOptions,
} from './store';

// Integration seams: theming, portals, the host's modal stack, and icons.
// Not the vendored primitives themselves — a consumer wanting different
// controls replaces `HeaderComponent`.
export {
  DataGridThemeScope,
  DATA_GRID_THEME_CLASS,
  DataGridPortalProvider,
  useDataGridPortalContainer,
  DataGridModalHostProvider,
  useDataGridModalHost,
  DataGridIconsProvider,
} from './ui';
export type {
  DataGridModalHost,
  DataGridIconName,
  DataGridIconComponent,
} from './ui';
export type { DataGridModalPage } from './ui/modal-host';
