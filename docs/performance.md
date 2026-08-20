# Performance

<kbd><a href="../README.md">← README</a></kbd>

The design goal is that a live update repaints what changed and not the grid.
Three mechanisms back that, and `src/core/__tests__/render-cost.spec.tsx`
measures all of them by counting per-row renders through a real
`CellComponent`.

## Virtualization

Rows and columns are both virtualized. A 100,000-row source mounts fewer than
sixty rows on first paint, and there's a test pinning that number so nobody
quietly regresses it.

## Row identity survives a patch

`createPatchableRowSource` replaces only the row objects a patch actually
touched, and rows are `React.memo`'d, so an untouched row with an unchanged
object doesn't render at all. Concretely, and all asserted:

| Change                             | Rows re-rendered       |
| ---------------------------------- | ---------------------- |
| Insert a row                       | no existing row        |
| Delete a row                       | no surviving row       |
| Update one cell                    | that row, nothing else |
| Write a value a cell already holds | **nothing at all**     |

That last one holds because the source hands back the same array reference and
the store's `Object.is` check drops the write before a single subscriber hears
about it. It sounds like a micro-optimization until you meet a reconcile loop
that restates every loaded row on a timer. Most of those writes change nothing,
and now they cost nothing.

## Fine-grained subscription

Every store-typed prop goes through `useSyncExternalStore`, and column stats are
per column, so a histogram arriving for one column doesn't re-render the header
row. Batched patches coalesce into a single notification.
