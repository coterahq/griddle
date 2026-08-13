import type { ReadonlyGridStore } from './store';

export type DerivedGridStore<T> = ReadonlyGridStore<T> & {
  /**
   * Releases the dependency subscriptions taken at construction.
   *
   * Only needed when the derived store's lifetime is shorter than its
   * dependencies'. The common case — a view model owning both — does not need
   * it, because the two die together.
   */
  dispose(): void;
};

/**
 * A store computed from other stores, with dependencies named explicitly.
 *
 * The original took a tracked getter (`from((get) => get(a) ? x : y)`) and
 * discovered dependencies by watching which stores the callback read. That
 * needs stores to carry an atom identity; this contract deliberately does not.
 * Naming the deps is the honest trade — a little more to write, and no hidden
 * coupling between the compute function's control flow and what it subscribes to.
 *
 * ## Why dependencies are watched from construction, not from first listener
 *
 * `snapshot()` has to be referentially stable between actual changes: React's
 * `useSyncExternalStore` calls it *during render*, before it has subscribed,
 * and compares results with `Object.is`. A compute returning a fresh object
 * each call reads as "changed on every render" and React bails out with
 * "The result of getSnapshot should be cached to avoid an infinite loop".
 *
 * So the cache cannot be conditional on being subscribed — which means the
 * dirty flag cannot be either, which means the dependencies must be watched
 * from the start. The cost is that a derived store keeps its dependencies
 * reachable for its own lifetime; {@link DerivedGridStore.dispose} is the exit
 * for the rare case where that matters.
 */
export function derivedGridStore<T>(
  dependencies: readonly ReadonlyGridStore<unknown>[],
  compute: () => T
): DerivedGridStore<T> {
  let cache: { value: T } | null = null;
  let dirty = true;
  const listeners = new Set<(value: T) => void>();

  const read = (): T => {
    if (!dirty && cache !== null) {
      return cache.value;
    }
    const next = compute();
    // Hold the previous box when the recomputed value is Object.is-equal, so a
    // dependency churning without changing this value does not hand React a
    // new identity.
    cache =
      cache !== null && Object.is(cache.value, next) ? cache : { value: next };
    dirty = false;
    return cache.value;
  };

  const onDependencyChange = (): void => {
    dirty = true;
    if (listeners.size === 0) {
      return;
    }
    const previous = cache;
    const next = read();
    if (previous !== null && Object.is(previous.value, next)) {
      return;
    }
    for (const listener of [...listeners]) {
      listener(next);
    }
  };

  const unsubscribes = dependencies.map((dependency) =>
    dependency.subscribe(onDependencyChange)
  );

  return {
    snapshot: read,

    subscribe(listener: (value: T) => void): () => void {
      // Establish a baseline if nothing has read yet. Subscribing means "tell
      // me when this changes from *now*", and without a cached previous value
      // the first dependency change has nothing to compare against and would
      // notify even when the computed value is unchanged.
      if (cache === null) {
        read();
      }
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },

    dispose(): void {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      listeners.clear();
    },
  };
}
