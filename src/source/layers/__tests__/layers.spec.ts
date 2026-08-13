import { describe, expect, it, vi } from 'vitest';
import { DuckDbLayerStack } from '../layers';
import type {
  DuckDbLayerGrid,
  DuckDbPresentationContext,
  DuckDbSourceLayer,
} from '../layers';

type Row = { id: string };

const presentationContext = (): DuckDbPresentationContext<Row> => ({
  gridHolder: { current: null },
  rowsHolder: { current: [] },
  getRowId: (row) => row.id,
});

const layerGrid = (): DuckDbLayerGrid => ({
  patch: vi.fn(),
  insertRow: vi.fn(),
  deleteRow: vi.fn(),
  loadedRowIds: () => [],
});

/** A layer that projects one column, joining a table named after its id. */
const projectingLayer = (
  id: string,
  columnName: string
): DuckDbSourceLayer<Row> => ({
  id,
  project: ({ baseAlias, alias }) => ({
    selectExpressions: [`${alias('t')}.value AS "${columnName}"`],
    joins: [
      `LEFT JOIN ${id} AS ${alias('t')} ON ${alias(
        't'
      )}.key = ${baseAlias}."row_id"`,
    ],
    columns: [{ name: columnName, type: 'VARCHAR' }],
  }),
});

describe('DuckDbLayerStack', () => {
  describe('wrapSource', () => {
    it('leaves the source alone with no projecting layers', () => {
      const composed = new DuckDbLayerStack<Row>([{ id: 'a' }]);

      expect(composed.wrapSource('(SELECT * FROM t)')).toBe(
        '(SELECT * FROM t)'
      );
    });

    it('wraps once for one projecting layer', () => {
      const composed = new DuckDbLayerStack([projectingLayer('runs', 'state')]);

      expect(composed.wrapSource('(SELECT * FROM t)')).toBe(
        '(SELECT cotera_src_0.*, cotera_src_0_t.value AS "state" ' +
          'FROM (SELECT * FROM t) AS cotera_src_0 ' +
          'LEFT JOIN runs AS cotera_src_0_t ON cotera_src_0_t.key = cotera_src_0."row_id")'
      );
    });

    it('nests so a later layer can reference an earlier one’s column', () => {
      const composed = new DuckDbLayerStack([
        projectingLayer('runs', 'state'),
        projectingLayer('notes', 'note'),
      ]);
      const sql = composed.wrapSource('(SELECT * FROM t)');

      // Nested, not one flat wrap with two joins: a JOIN clause cannot see a
      // SELECT alias, but it can see a subquery's column, so the outer layer
      // can address "state" through its own base alias.
      expect(sql.startsWith('(SELECT cotera_src_1.*, ')).toBe(true);
      expect(sql).toContain('FROM (SELECT cotera_src_0.*, ');
    });

    it('gives two instances of the same layer kind distinct aliases', () => {
      const composed = new DuckDbLayerStack([
        projectingLayer('runs', 'a'),
        projectingLayer('runs', 'b'),
      ]);
      const sql = composed.wrapSource('(SELECT * FROM t)');

      expect(sql).toContain('AS cotera_src_0_t');
      expect(sql).toContain('AS cotera_src_1_t');
    });

    it('skips a layer that projects no columns', () => {
      const empty: DuckDbSourceLayer<Row> = {
        id: 'empty',
        project: () => ({ selectExpressions: [], joins: [], columns: [] }),
      };
      const composed = new DuckDbLayerStack([empty]);

      expect(composed.wrapSource('(SELECT * FROM t)')).toBe(
        '(SELECT * FROM t)'
      );
    });
  });

  it('collects projected columns in stack order', () => {
    const composed = new DuckDbLayerStack([
      projectingLayer('runs', 'state'),
      projectingLayer('notes', 'note'),
    ]);

    expect(composed.projectedColumns).toMatchObject([
      { name: 'state' },
      { name: 'note' },
    ]);
  });

  describe('materialize', () => {
    it('runs mutating layers in stack order, threading the schema', async () => {
      const executed: string[] = [];
      const exec = async (sql: string) => {
        executed.push(sql);
      };
      const adds = (id: string, column: string): DuckDbSourceLayer<Row> => ({
        id,
        mutate: ({ columns }) => ({
          statements: [`ALTER TABLE t ADD COLUMN ${column}`],
          columns: [...columns, { name: column, type: 'VARCHAR' }],
        }),
      });
      const composed = new DuckDbLayerStack([adds('a', 'x'), adds('b', 'y')]);

      const columns = await composed.materialize({
        exec,
        tableName: 't',
        baseColumns: [{ name: 'row_id', type: 'VARCHAR' }],
      });

      expect(executed).toMatchObject([
        'ALTER TABLE t ADD COLUMN x',
        'ALTER TABLE t ADD COLUMN y',
      ]);
      expect(columns).toMatchObject([
        { name: 'row_id' },
        { name: 'x' },
        { name: 'y' },
      ]);
    });

    it('re-resolves the row id column per layer when told how', async () => {
      const seen: (string | null)[] = [];
      const exec = async () => undefined;
      const observe = (id: string): DuckDbSourceLayer<Row> => ({
        id,
        mutate: ({ rowIdColumn }) => {
          seen.push(rowIdColumn);
          return { statements: [], columns: [{ name: 'renamed', type: null }] };
        },
      });
      const composed = new DuckDbLayerStack([observe('a'), observe('b')]);

      await composed.materialize({
        exec,
        tableName: 't',
        baseColumns: [{ name: 'original', type: null }],
        resolveRowIdColumn: (columns) => columns[0]?.name ?? null,
      });

      // A layer that renames the id column changes what the next one
      // addresses rows by.
      expect(seen).toMatchObject(['original', 'renamed']);
    });
  });

  describe('present', () => {
    const withColumn = (id: string): DuckDbSourceLayer<Row> => ({
      id,
      present: () => ({ columns: [{ id, header: id, getValue: () => null }] }),
    });

    it('emits grid columns outermost-first, the reverse of stack order', () => {
      // The array is base-first, but the outermost layer's column belongs
      // leftmost: `[operations, automations, selection]` renders as
      // `[select, workflows, ...]`.
      const composed = new DuckDbLayerStack([
        withColumn('workflows'),
        withColumn('select'),
      ]);

      expect(composed.present(presentationContext()).columns).toMatchObject([
        { id: 'select' },
        { id: 'workflows' },
      ]);
    });

    it('subscribes every layer and unsubscribes every layer', () => {
      const first = vi.fn();
      const second = vi.fn();
      const subscribing = (
        id: string,
        teardown: () => void
      ): DuckDbSourceLayer<Row> => ({
        id,
        present: () => ({ subscribe: () => teardown }),
      });
      const composed = new DuckDbLayerStack([
        subscribing('a', first),
        subscribing('b', second),
      ]);

      const unsubscribe = composed
        .present(presentationContext())
        .subscribe(layerGrid());
      expect(first).not.toHaveBeenCalled();

      unsubscribe();
      expect(first).toHaveBeenCalledOnce();
      expect(second).toHaveBeenCalledOnce();
    });

    it('is a no-op unsubscribe when no layer subscribes', () => {
      const composed = new DuckDbLayerStack<Row>([{ id: 'a' }]);

      expect(() =>
        composed.present(presentationContext()).subscribe(layerGrid())()
      ).not.toThrow();
    });

    describe('row detail', () => {
      const withDetail = (
        id: string,
        height: number
      ): DuckDbSourceLayer<Row> => ({
        id,
        present: () => ({ rowDetail: { height, render: () => null } }),
      });

      it('is null when no layer declares one', () => {
        const composed = new DuckDbLayerStack<Row>([{ id: 'a' }]);

        expect(composed.present(presentationContext()).rowDetail).toBeNull();
      });

      it('gives it to the first layer in stack order and warns about the rest', () => {
        // First-wins, not last-wins: presentation-only layers are appended by
        // callers, and a caller must not steal the row detail from the model
        // that owns the data.
        const warn = vi
          .spyOn(console, 'warn')
          .mockImplementation(() => undefined);
        const composed = new DuckDbLayerStack([
          withDetail('automations', 232),
          withDetail('selection', 100),
        ]);

        expect(composed.present(presentationContext()).rowDetail).toMatchObject(
          { ownerId: 'automations', height: 232 }
        );
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0]?.[0]).toContain('selection');
        expect(warn.mock.calls[0]?.[0]).toContain('automations');

        warn.mockRestore();
      });
    });
  });
});
