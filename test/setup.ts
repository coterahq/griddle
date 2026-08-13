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

// Radix measures with this before positioning a popper; jsdom returns undefined.
if (globalThis.DOMRect === undefined) {
  Object.defineProperty(globalThis, 'DOMRect', {
    writable: true,
    configurable: true,
    value: class DOMRect {
      constructor(
        readonly x = 0,
        readonly y = 0,
        readonly width = 0,
        readonly height = 0
      ) {}
      get top(): number {
        return this.y;
      }
      get left(): number {
        return this.x;
      }
      get right(): number {
        return this.x + this.width;
      }
      get bottom(): number {
        return this.y + this.height;
      }
    },
  });
}
