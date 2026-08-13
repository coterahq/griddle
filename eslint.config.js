import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'examples/dist/**',
      'coverage/**',
      // Still verbatim Cotera imports; excluded from tsconfig until the
      // DuckDB milestone (L5), so the type-aware rules have no program for it.
      // (`src/source/layers` came off this list at L4.)
      'src/duckdb/**',
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
    files: ['scripts/**', '*.config.ts', '*.config.js'],
    rules: { '@typescript-eslint/no-unsafe-assignment': 'off' },
  }
);
