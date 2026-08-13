import '@testing-library/jest-dom/vitest';

/**
 * jsdom implements neither observer, and the grid measures itself with both:
 * `ResizeObserver` drives the viewport size it virtualizes against, and
 * `IntersectionObserver` drives the bottom sentinel that calls `loadMore`.
 *
 * Hoisted here from the six spec files that each declared their own copy.
 * No-op is the right stub: specs that need a size set one explicitly, and
 * specs that need `loadMore` call it rather than faking an intersection.
 */
class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  configurable: true,
  value: NoopObserver,
});

Object.defineProperty(globalThis, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: NoopObserver,
});
