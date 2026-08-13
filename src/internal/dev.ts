/**
 * `process` is not a browser global, and this package ships its source
 * unbundled — a consumer's bundler may replace `process.env.NODE_ENV` with a
 * literal, or may leave it alone and hand the browser a ReferenceError.
 *
 * Declared locally rather than by adding `@types/node`, which would pull a
 * Node standard library into the types of a React component package.
 */
declare const process: { env?: Record<string, string | undefined> } | undefined;

/**
 * True when this is demonstrably not a production build.
 *
 * Guards development-only warnings — a layer stealing another's row detail, a
 * sort on a column that cannot be sorted. Those are worth saying loudly to
 * whoever is wiring the grid up and worth saying nothing at all to an end
 * user.
 *
 * Note which way the uncertainty falls: when `process` is absent there is no
 * evidence either way, and the answer is `false`. A warning that fails to
 * appear in development costs one debugging session; a warning that appears in
 * production is in every user's console forever.
 */
export const isDevelopment = (): boolean =>
  typeof process !== 'undefined' && process?.env?.['NODE_ENV'] !== 'production';
