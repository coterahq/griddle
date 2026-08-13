import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { createGridStore } from './store';
import { derivedGridStore } from './derived';
import { useGridStore } from './use-store';

describe('useGridStore', () => {
  it('renders the current value and re-renders on change', () => {
    const store = createGridStore('first');
    const Probe = (): React.ReactElement => <span>{useGridStore(store)}</span>;

    render(<Probe />);
    expect(screen.getByText('first')).toBeInTheDocument();

    act(() => {
      store.set('second');
    });
    expect(screen.getByText('second')).toBeInTheDocument();
  });

  it('does not re-render when a write is dropped as identical', () => {
    const rows = ['a'];
    const store = createGridStore(rows);
    const renders = vi.fn();
    const Probe = (): React.ReactElement => {
      renders();
      return <span>{useGridStore(store).join(',')}</span>;
    };

    render(<Probe />);
    const initial = renders.mock.calls.length;

    act(() => {
      store.set(rows);
    });

    expect(renders.mock.calls.length).toBe(initial);
  });

  // The useCallback pair in useGridStore exists for exactly this. If subscribe
  // were an inline closure, every render would tear down and re-establish the
  // subscription — multiplied by every cell in the grid.
  it('subscribes once across many re-renders', () => {
    const inner = createGridStore(0);
    const subscribeSpy = vi.fn();
    const store = {
      snapshot: () => inner.snapshot(),
      subscribe: (listener: (value: number) => void) => {
        subscribeSpy();
        return inner.subscribe(listener);
      },
    };
    const Probe = (): React.ReactElement => <span>{useGridStore(store)}</span>;

    render(<Probe />);
    const afterMount = subscribeSpy.mock.calls.length;

    act(() => {
      inner.set(1);
    });
    act(() => {
      inner.set(2);
    });

    expect(subscribeSpy.mock.calls.length).toBe(afterMount);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('works with a derived store without looping on snapshot identity', () => {
    const expanded = createGridStore(false);
    const layout = derivedGridStore([expanded], () => ({
      height: expanded.snapshot() ? 124 : 40,
    }));
    const renders = vi.fn();
    const Probe = (): React.ReactElement => {
      renders();
      return <span>{useGridStore(layout).height}</span>;
    };

    render(<Probe />);
    expect(screen.getByText('40')).toBeInTheDocument();
    const afterMount = renders.mock.calls.length;

    act(() => {
      expanded.set(true);
    });

    expect(screen.getByText('124')).toBeInTheDocument();
    // One change, a bounded number of renders — not a runaway loop.
    expect(renders.mock.calls.length).toBeLessThanOrEqual(afterMount + 2);
  });
});
