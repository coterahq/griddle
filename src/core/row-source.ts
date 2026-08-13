import { createGridStore } from '../store';
import type { GridStore } from '../store';
import type {
  DataGridRowId,
  DataGridRowPatch,
  DataGridRowSource,
  DataGridVisibleWindow,
} from './types';

export type PatchableRowSourceOptions<TRow> = {
  getRowId: (row: TRow) => DataGridRowId;
  loadMore: () => void | Promise<void>;
  loadWindow?: (window: DataGridVisibleWindow) => void | Promise<void>;
  rows?: GridStore<TRow[]>;
  totalRows?: GridStore<number | null>;
  hasMore?: GridStore<boolean>;
  isLoading?: GridStore<boolean>;
};

export type PatchableRowSource<TRow> = DataGridRowSource<TRow> & {
  rows: GridStore<TRow[]>;
  totalRows: GridStore<number | null>;
  hasMore: GridStore<boolean>;
  isLoading: GridStore<boolean>;
  applyPatch: (patch: DataGridRowPatch<TRow>) => void;
  applyPatches: (patches: DataGridRowPatch<TRow>[]) => void;
};

/**
 * A row source that accepts granular patches instead of whole-array swaps.
 *
 * Row objects that a patch does not touch keep their identity, so memoized
 * row/cell components skip re-rendering. High-frequency producers should use
 * `applyPatches` to coalesce a batch into a single watchable update.
 */
export const createPatchableRowSource = <TRow>({
  getRowId,
  loadMore,
  loadWindow,
  rows = createGridStore<TRow[]>([]),
  totalRows = createGridStore<number | null>(null),
  hasMore = createGridStore(false),
  isLoading = createGridStore(false),
}: PatchableRowSourceOptions<TRow>): PatchableRowSource<TRow> => {
  const reduce = (
    current: TRow[],
    patch: DataGridRowPatch<TRow>
  ): { rows: TRow[]; totalDelta: number } => {
    switch (patch.type) {
      case 'update-cell': {
        const index = current.findIndex((row) => getRowId(row) === patch.rowId);
        if (index === -1) {
          return { rows: current, totalDelta: 0 };
        }
        const existing = current[index];
        if (existing === undefined) {
          return { rows: current, totalDelta: 0 };
        }
        // Writing the value a cell already holds is not a change, and this
        // source's whole promise is that untouched rows keep their identity so
        // memoized rows and cells can skip rendering. Producers that restate
        // rows wholesale — a reconcile repainting every loaded row — send mostly
        // these, and replacing the row object for them re-rendered the grid to
        // display exactly what it was already displaying.
        if (
          Object.is(
            (existing as Record<string, unknown>)[patch.columnId],
            patch.value
          )
        ) {
          return { rows: current, totalDelta: 0 };
        }
        const next = [...current];
        next[index] = { ...existing, [patch.columnId]: patch.value };
        return { rows: next, totalDelta: 0 };
      }
      case 'update-row': {
        const index = current.findIndex((row) => getRowId(row) === patch.rowId);
        if (index === -1) {
          return { rows: current, totalDelta: 0 };
        }
        const next = [...current];
        next[index] = patch.row;
        return { rows: next, totalDelta: 0 };
      }
      case 'insert-row': {
        const next = [...current];
        next.splice(patch.atIndex ?? next.length, 0, patch.row);
        return { rows: next, totalDelta: 1 };
      }
      case 'delete-row': {
        const next = current.filter((row) => getRowId(row) !== patch.rowId);
        return {
          rows: next,
          totalDelta: next.length - current.length,
        };
      }
      case 'splice-rows': {
        const next = [...current];
        next.splice(patch.startIndex, patch.deleteCount, ...patch.rows);
        return { rows: next, totalDelta: next.length - current.length };
      }
      default:
        return { rows: current, totalDelta: 0 };
    }
  };

  const applyPatches = (patches: DataGridRowPatch<TRow>[]) => {
    if (patches.length === 0) {
      return;
    }
    let current = rows.snapshot();
    let totalDelta = 0;
    for (const patch of patches) {
      const result = reduce(current, patch);
      current = result.rows;
      totalDelta += result.totalDelta;
    }
    rows.set(current);
    const currentTotal = totalRows.snapshot();
    if (currentTotal !== null && totalDelta !== 0) {
      totalRows.set(Math.max(0, currentTotal + totalDelta));
    }
  };

  return {
    rows,
    totalRows,
    hasMore,
    isLoading,
    loadMore,
    loadWindow,
    applyPatch: (patch) => {
      applyPatches([patch]);
    },
    applyPatches,
  };
};
