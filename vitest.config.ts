import { defineConfig } from 'vitest/config';

/**
 * No `@vitejs/plugin-react` here on purpose.
 *
 * Vitest resolves its own nested copy of Vite, so a plugin built against the
 * top-level one is a structurally different `Plugin` type and does not
 * typecheck. The plugin exists for Fast Refresh and Babel transforms, neither
 * of which a test run uses — Vitest's esbuild transform already picks up
 * `jsx: "react-jsx"` from tsconfig, which is all these specs need. The
 * examples app has its own Vite config and does use the plugin.
 */
export default defineConfig({
  test: {
    globals: true,
    // jsdom, not happy-dom. The grid sizes itself entirely from ResizeObserver
    // and IntersectionObserver and leans on getBoundingClientRect and scroll
    // geometry — exactly where the two DOM shims diverge. These versions match
    // what the Cotera app runs, so a spec passing here is evidence it passes
    // there, which is the whole basis of the L1 parity gate.
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**'],
    reporters: ['default'],
  },
});
