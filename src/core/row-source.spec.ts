import { describe, expect, it, vi } from 'vitest';
import { createPatchableRowSource } from './row-source';

type Row = { id: string; name: string; score: number | null };

const rowsOf = (...names: string[]): Row[] =>
  names.map((name, index) => ({ id: `r-${index}`, name, score: index }));

const sourceOf = () =>
  createPatchableRowSource<Row>({
    getRowId: (row) => row.id,
    loadMore: vi.fn(),
  });

describe('createPatchableRowSource', () => {
  describe('update-cell', () => {
    it('replaces only the row it names, leaving the others identical', () => {
      const source = sourceOf();
      const before = rowsOf('a', 'b');
      source.rows.set(before);

      source.applyPatch({
        type: 'update-cell',
        rowId: 'r-1',
        columnId: 'name',
        value: 'changed',
      });

      const after = source.rows.snapshot();
      // Identity is the contract: memoized rows and cells skip rendering on it.
      expect(after[0]).toBe(before[0]);
      expect(after[1]).not.toBe(before[1]);
      expect(after[1]).toMatchObject({ id: 'r-1', name: 'changed' });
    });

    it('keeps every row identical when the value is already what it holds', () => {
      // A reconcile restates every loaded row, so most of what arrives is this.
      // Minting a new row object for it re-rendered the grid — and invalidated
      // the header distributions — to redisplay what was already on screen.
      const source = sourceOf();
      const before = rowsOf('a', 'b');
      source.rows.set(before);

      source.applyPatch({
        type: 'update-cell',
        rowId: 'r-1',
        columnId: 'name',
        value: 'b',
      });

      expect(source.rows.snapshot()).toBe(before);
    });

    it('treats null as a value rather than as absence', () => {
      const source = sourceOf();
      const before = rowsOf('a');
      source.rows.set(before);

      source.applyPatch({
        type: 'update-cell',
        rowId: 'r-0',
        columnId: 'score',
        value: null,
      });

      expect(source.rows.snapshot()[0]).toMatchObject({ score: null });
    });

    it('ignores a patch for a row it does not hold', () => {
      const source = sourceOf();
      const before = rowsOf('a');
      source.rows.set(before);

      source.applyPatch({
        type: 'update-cell',
        rowId: 'missing',
        columnId: 'name',
        value: 'x',
      });

      expect(source.rows.snapshot()).toBe(before);
    });
  });
});
