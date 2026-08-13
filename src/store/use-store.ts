import * as React from 'react';
import type { ReadonlyGridStore } from './store';

/**
 * Subscribes a component to one store.
 *
 * `useSyncExternalStore` rather than a `useState` + `useEffect` pair: React
 * re-reads the snapshot after subscribing, which closes the window where a
 * store changes between render and effect. It is also React 18+, so it covers
 * the whole supported peer range.
 *
 * The `useCallback`s are load-bearing. Inline closures would be new identities
 * every render, and `useSyncExternalStore` resubscribes whenever `subscribe`
 * changes — every cell in the grid tearing down and re-establishing a
 * subscription on each render is exactly the cost this whole design exists to
 * avoid.
 */
export function useGridStore<T>(store: ReadonlyGridStore<T>): T {
  const subscribe = React.useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store]
  );
  const getSnapshot = React.useCallback(() => store.snapshot(), [store]);
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
