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

---

## A confession

Everything above was true when we wrote this section except one part, and we
only found out because we wrote the test first.

The claim was that inserting a row doesn't re-render the grid. The test said
otherwise: inserting one row re-rendered every row on screen, and so did
deleting one. Cell updates were already surgical, so the bug had been hiding
behind the case people check.

The cause was a single dependency array. The function that builds each cell's
context is a prop on every memoized row, and it listed the virtual window's
`endIndex`. That index is clamped by the row count, so it moved on every insert
and delete, which gave the callback a new identity, which busted the memo on
every row, which threw away the exact row-identity work the patchable source
exists to do. One ref later it was fixed, and there are now nine tests standing
on it.

We're telling you because "high performance" in a README is worth about as much
as the paper it's printed on. The tests are in the repo. Run them.
