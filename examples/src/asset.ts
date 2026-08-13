/**
 * An absolute URL for something in `public/`.
 *
 * `import.meta.env.BASE_URL` because the site deploys under a project subpath
 * on GitHub Pages, and *absolute* because these URLs are handed to DuckDB,
 * which resolves them inside a worker rather than against the document. A
 * relative `./data/orders.parquet` is correct for an `<img>` and wrong here —
 * the same class of bug as the worker script URL, and it also fails only in
 * production.
 */
export const asset = (path: string): string =>
  new URL(
    `${import.meta.env.BASE_URL}${path}`.replace(/\/{2,}/g, '/'),
    window.location.href
  ).href;
