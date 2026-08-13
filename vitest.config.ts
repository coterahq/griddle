/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
    reporters: ['default'],
  },
});
