import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'examples/dist/**',
      // MSW's generated service worker. Vendored verbatim by `msw init`, and
      // regenerated on every version bump, so linting it would only produce
      // findings nobody may act on.
      'examples/public/mockServiceWorker.js',
      'coverage/**',
      // Plain-JS build tooling. `allowJs` is false (the package ships no JS
      // sources), so the type-aware project service has no program for these
      // and cannot parse them. Prettier still formats them.
      'eslint.config.js',
      'scripts/**/*.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Configured to match the Cotera repo exactly. The imported source was
      // written under these settings, so any divergence would force a rewrite
      // during the move — and rewriting during the move is what destroys the
      // L1 "behaviour-preserving" argument.
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowNullableString: true,
          allowNullableBoolean: true,
          allowAny: true,
        },
      ],

      // The grid uses `void`-returning handlers in JSX props throughout.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],

      // The imported source predates this repo's stricter config. Relaxed
      // rather than rewritten: rewriting during the extraction is exactly what
      // costs the "behaviour-preserving" argument. `pendingEdits` is a
      // Record keyed by a computed cell address, and deleting a key is how an
      // edit is discarded — the alternative spellings are all worse.
      '@typescript-eslint/no-dynamic-delete': 'off',

      // Numbers in template literals. `${rowCount} rows` is not a defect and
      // the source is full of it.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],

      // The grid passes command objects around as values by design — every
      // context object hands `commands.focus`, `commands.pin` and friends to
      // handlers. They are closures over the view model, not methods needing a
      // receiver, so the rule fires only false positives here.
      '@typescript-eslint/unbound-method': 'off',

      // Fires on defensive checks the type system believes are unreachable but
      // the runtime does not — API responses, and DOM globals a test
      // environment may not implement.
      '@typescript-eslint/no-unnecessary-condition': 'off',

      // A cell value is `unknown` by design — the grid renders whatever a data
      // source hands it. `String(value)` as a last-resort display is the
      // documented fallback, "[object Object]" included, and the alternative
      // is the grid deciding what someone else's data means.
      '@typescript-eslint/no-base-to-string': 'off',

      /*
       * This package runs in a browser. `@types/node` is a devDependency —
       * the DuckDB oracle spec imports `node:fs` — and installing it puts
       * Node's globals in scope for every file, which means library source
       * could reach for `process` or `Buffer` and still compile, then throw
       * on a consumer's page.
       *
       * Before `@types/node` existed here that was prevented by accident.
       * This makes it a rule. `src/internal/dev.ts` reads `process`
       * deliberately, behind a `typeof` guard and its own local declaration,
       * which shadows the global and so does not trip this.
       */
      'no-restricted-globals': [
        'error',
        {
          name: 'process',
          message:
            'Not a browser global. Guard it as `src/internal/dev.ts` does.',
        },
        { name: 'Buffer', message: 'Not a browser global.' },
        { name: '__dirname', message: 'Not available in ESM or a browser.' },
        { name: '__filename', message: 'Not available in ESM or a browser.' },
      ],

      curly: ['error', 'all'],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx', 'test/**'],
    rules: {
      // The ported Cotera specs are the extraction's contract, so they are
      // changed only on their import lines. Two of this repo's stricter rules
      // fire on them, and relaxing the rule is the cheaper of the two prices:
      // an `async` test stub that awaits nothing, and `expect(() => f())` on a
      // void-returning call, which is the only way to assert it does not
      // throw.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',

      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: [
      'scripts/**',
      'examples/**',
      '*.config.ts',
      '*.config.js',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      'src/**/__tests__/**',
      'test/**',
    ],
    // These do run on Node, or under a bundler that provides the shims.
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    files: ['scripts/**', '*.config.ts', '*.config.js'],
    rules: { '@typescript-eslint/no-unsafe-assignment': 'off' },
  }
);
