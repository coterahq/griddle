import { describe, expect, it, vi } from 'vitest';
import { createGridStore } from './store';
import type { GridStore, ReadonlyGridStore } from './store';
import { derivedGridStore } from './derived';

describe('createGridStore', () => {
  it('reads back what was written and notifies subscribers', () => {
    const store = createGridStore(1);
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(2);

    expect(store.snapshot()).toBe(2);
    expect(listener).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('stops notifying after unsubscribe', () => {
    const store = createGridStore('a');
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.set('b');

    expect(store.snapshot()).toBe('b');
    expect(listener).not.toHaveBeenCalled();
  });

  // The row source returns the *same array reference* for a no-op cell write
  // precisely so this fires. Without it, typing into a cell and pressing escape
  // would re-render every row.
  it('drops a write of an identical value', () => {
    const rows = [{ id: 1 }];
    const store = createGridStore(rows);
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(rows);

    expect(listener).not.toHaveBeenCalled();
  });

  it('applies the updater before storing', () => {
    const store = createGridStore(new Set([1]), {
      updater: (value) => new Set(value),
    });
    const handedIn = new Set([1, 2]);

    store.set(handedIn);

    expect(store.snapshot()).toEqual(new Set([1, 2]));
    // Cloned, so mutating what the caller kept cannot reach stored state.
    expect(store.snapshot()).not.toBe(handedIn);
    handedIn.add(3);
    expect(store.snapshot()).toEqual(new Set([1, 2]));
  });

  it('consults equalityFn against the incoming value, before the updater', () => {
    const equalityFn = vi.fn(
      (previous: { v: number }, next: { v: number }) => previous.v === next.v
    );
    const updater = vi.fn((value: { v: number }) => ({ ...value }));
    const store = createGridStore({ v: 1 }, { equalityFn, updater });
    const listener = vi.fn();
    store.subscribe(listener);

    store.set({ v: 1 });

    expect(listener).not.toHaveBeenCalled();
    expect(updater).not.toHaveBeenCalled();
    expect(equalityFn).toHaveBeenCalledExactlyOnceWith({ v: 1 }, { v: 1 });
  });

  it('survives a listener unsubscribing another listener mid-notification', () => {
    const store = createGridStore(0);
    const second = vi.fn();
    const unsubscribeSecond = store.subscribe(second);
    store.subscribe(() => {
      unsubscribeSecond();
    });

    expect(() => {
      store.set(1);
    }).not.toThrow();
  });
});

describe('derivedGridStore', () => {
  it('recomputes when a dependency changes', () => {
    const expanded = createGridStore(false);
    const height = derivedGridStore([expanded], () =>
      expanded.snapshot() ? 124 : 40
    );

    expect(height.snapshot()).toBe(40);
    expanded.set(true);
    expect(height.snapshot()).toBe(124);
  });

  // This is what makes it safe to hand to useSyncExternalStore: React calls
  // getSnapshot during render and compares with Object.is, so a fresh object
  // every call reads as "changed every render" and loops.
  it('returns a referentially stable snapshot between changes', () => {
    const sorts = createGridStore<string[]>([]);
    const filters = createGridStore<string[]>([]);
    const params = derivedGridStore([sorts, filters], () => ({
      sorts: sorts.snapshot(),
      filters: filters.snapshot(),
    }));
    params.subscribe(() => undefined);

    const first = params.snapshot();

    expect(params.snapshot()).toBe(first);
    expect(params.snapshot()).toBe(first);

    sorts.set(['name']);
    expect(params.snapshot()).not.toBe(first);
    expect(params.snapshot()).toBe(params.snapshot());
  });

  it('does not notify when the recomputed value is unchanged', () => {
    const a = createGridStore(1);
    const parity = derivedGridStore([a], () => a.snapshot() % 2 === 0);
    const listener = vi.fn();
    parity.subscribe(listener);

    a.set(3); // still odd

    expect(listener).not.toHaveBeenCalled();

    a.set(4);
    expect(listener).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('releases its dependency subscriptions on dispose', () => {
    const source = createGridStore(0);
    const unsubscribeSpy = vi.fn();
    const tracked: ReadonlyGridStore<number> = {
      snapshot: () => source.snapshot(),
      subscribe: (listener) => {
        const inner = source.subscribe(listener);
        return () => {
          unsubscribeSpy();
          inner();
        };
      },
    };
    const doubled = derivedGridStore([tracked], () => source.snapshot() * 2);

    const unsubscribe = doubled.subscribe(() => undefined);
    unsubscribe();
    // Dependencies stay watched: the cache has to stay accurate for unsubscribed
    // `snapshot()` reads, which is what keeps React's getSnapshot stable.
    expect(unsubscribeSpy).not.toHaveBeenCalled();

    doubled.dispose();
    expect(unsubscribeSpy).toHaveBeenCalledOnce();
  });

  it('stays current on read while unsubscribed', () => {
    const source = createGridStore(1);
    const doubled = derivedGridStore([source], () => source.snapshot() * 2);

    expect(doubled.snapshot()).toBe(2);
    source.set(5);
    expect(doubled.snapshot()).toBe(10);
  });

  // The regression this file exists for: React calls getSnapshot during render,
  // before it has subscribed. If that path recomputes, an object-returning
  // compute hands back a new identity every time and React loops.
  it('is snapshot-stable while unsubscribed', () => {
    const source = createGridStore(1);
    const boxed = derivedGridStore([source], () => ({ n: source.snapshot() }));

    const first = boxed.snapshot();
    expect(boxed.snapshot()).toBe(first);

    source.set(2);
    const second = boxed.snapshot();
    expect(second).not.toBe(first);
    expect(boxed.snapshot()).toBe(second);
  });
});

/**
 * The L0 exit gate.
 *
 * Cotera's `Watchable` carries members this contract does not know about
 * (`map`, `asAtom`, `lastUpdateTime`) and is backed by jotai. If it is
 * structurally assignable to `GridStore` then an app already holding
 * `Watchable`s can pass them into the grid untouched, which is the entire
 * reason the contract was drawn this small. This test is the assertion — if it
 * stops compiling, the boundary has grown and a migration just became a
 * wrapper-writing exercise.
 */
describe('structural compatibility with a Watchable-shaped store', () => {
  type Atom<T> = { readonly __atom: T };

  class WatchableLike<T> {
    lastUpdateTime = 0;
    private value: T;
    private readonly listeners = new Set<(value: T) => void>();

    constructor(initial: T) {
      this.value = initial;
    }

    snapshot(): T {
      return this.value;
    }

    subscribe(callback: (value: T) => void): () => void {
      this.listeners.add(callback);
      return () => this.listeners.delete(callback);
    }

    set(value: T): void {
      this.value = value;
      this.lastUpdateTime += 1;
      for (const listener of this.listeners) {
        listener(value);
      }
    }

    map<U>(callback: (value: T) => U): WatchableLike<U> {
      return new WatchableLike(callback(this.value));
    }

    asAtom(): Atom<T> {
      return { __atom: this.value };
    }
  }

  it('satisfies GridStore and ReadonlyGridStore without an adapter', () => {
    const watchable = new WatchableLike(['a']);

    // The real assertion is that these two lines typecheck.
    const writable: GridStore<string[]> = watchable;
    const readable: ReadonlyGridStore<string[]> = watchable;

    const listener = vi.fn();
    readable.subscribe(listener);
    writable.set(['a', 'b']);

    expect(readable.snapshot()).toEqual(['a', 'b']);
    expect(listener).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
  });

  it('composes into derivedGridStore alongside a native store', () => {
    const foreign = new WatchableLike('sql');
    const native = createGridStore<string[]>([]);
    const params = derivedGridStore([foreign, native], () => ({
      query: foreign.snapshot(),
      filters: native.snapshot(),
    }));
    params.subscribe(() => undefined);

    expect(params.snapshot()).toMatchObject({ query: 'sql', filters: [] });

    foreign.set('select 1');
    expect(params.snapshot()).toMatchObject({ query: 'select 1' });
  });
});
