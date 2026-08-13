/**
 * The grid's reactivity contract.
 *
 * Deliberately the smallest surface that supports fine-grained subscription:
 * a value you can read now, and a way to hear about the next one. It is a
 * strict structural subset of Cotera's jotai-backed `Watchable`, which is what
 * lets an app already holding `Watchable`s pass them straight in — no adapter,
 * no wrapper, no conversion at the boundary.
 *
 * Keep it that way. Adding a member here (an `asAtom`, a `map`, a
 * `lastUpdateTime`) is not a local decision: it re-imposes an implementation on
 * every caller that currently satisfies this by accident.
 */
export type ReadonlyGridStore<T> = {
  snapshot(): T;
  /** Returns an unsubscribe. Safe to call from inside a notification. */
  subscribe(listener: (value: T) => void): () => void;
};

export type GridStore<T> = ReadonlyGridStore<T> & {
  set(value: T): void;
};

export type CreateGridStoreOptions<T> = {
  /**
   * Applied to every incoming value before it is stored.
   *
   * The grid uses this to clone `Set`s on write, so a caller mutating the set
   * it just handed over cannot reach into stored state.
   */
  updater?: (value: T) => T;
  /** Return true to drop a write. Runs against the *incoming* value, pre-updater. */
  equalityFn?: (previous: T, next: T) => boolean;
};

/**
 * Two guards, in this order, mirroring what the jotai-backed original did:
 *
 *  1. the explicit `equalityFn`, applied to the value as handed in;
 *  2. an `Object.is` bail after the updater has run, which is what jotai's own
 *     store did underneath and which several call sites depend on — the
 *     patchable row source returns the *same array reference* for a no-op cell
 *     write specifically so this fires and no re-render happens.
 *
 * Dropping either one changes render counts, so both are load-bearing.
 */
export function createGridStore<T>(
  initial: T,
  options: CreateGridStoreOptions<T> = {}
): GridStore<T> {
  const updater = options.updater ?? ((value: T): T => value);
  const { equalityFn } = options;

  let current = initial;
  const listeners = new Set<(value: T) => void>();

  return {
    snapshot: (): T => current,

    subscribe(listener: (value: T) => void): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },

    set(next: T): void {
      if (equalityFn !== undefined && equalityFn(current, next)) {
        return;
      }
      const applied = updater(next);
      if (Object.is(current, applied)) {
        return;
      }
      current = applied;
      // Iterate a copy: a listener is allowed to unsubscribe itself, or another
      // listener, while being notified.
      for (const listener of [...listeners]) {
        listener(current);
      }
    },
  };
}
