import { cn } from '../../ui/cn';
import {
  ALIGNMENT_CLASS,
  formatDataGridValue,
  inCellBarShare,
} from '../format';
import { DEFAULT_DATA_GRID_DISPLAY_OPTIONS } from '../types';
import type { DataGridCellComponentProps } from '../types';
import { DataGridCellEditor, dataGridEditorKind } from './cell-editor';

/** Marks a cell that carries an unsaved edit. */
export const DataGridDirtyNotch = () => (
  <span
    aria-hidden
    className="pointer-events-none absolute right-0 top-0 h-0 w-0 border-l-[7px] border-t-[7px] border-l-transparent border-t-primary"
  />
);

export function BaseCell<TRow>({
  context,
  style,
  onClick,
}: DataGridCellComponentProps<TRow>) {
  const options = context.displayOptions ?? DEFAULT_DATA_GRID_DISPLAY_OPTIONS;
  const formatted = formatDataGridValue(
    context.value,
    options,
    context.column.type
  );
  const barShare = inCellBarShare(context.value, options);
  const editOptions = context.state.editing
    ? context.column.getEditOptions?.()
    : undefined;
  const rendered =
    context.column.renderCell?.(context) ??
    (formatted === null ? (
      <span className="text-muted-foreground">null</span>
    ) : (
      formatted
    ));

  return (
    <div
      ref={(element) => {
        context.anchorRef.current = element;
      }}
      id={`dg-cell-${context.address.rowIndex}-${context.address.columnIndex}`}
      role="gridcell"
      aria-colindex={context.address.columnIndex + 2}
      aria-selected={context.state.selected}
      data-focused={context.state.focused ? 'true' : 'false'}
      data-selected={context.state.cellSelected ? 'true' : 'false'}
      data-editing={context.state.editing ? 'true' : 'false'}
      data-dirty={context.state.dirty ? 'true' : 'false'}
      className={cn(
        'absolute flex h-full items-center overflow-hidden border-b border-r border-border/70 px-3 text-sm outline-none data-[focused=true]:ring-2 data-[focused=true]:ring-primary/70 data-[focused=true]:ring-inset data-[selected=true]:bg-primary/10',
        // The editing ring wins over focus/selection styling and lifts the
        // cell above its neighbours so the ring is never clipped.
        'data-[editing=true]:z-30 data-[editing=true]:overflow-visible data-[editing=true]:bg-background data-[editing=true]:ring-2 data-[editing=true]:ring-primary data-[editing=true]:ring-inset',
        ALIGNMENT_CLASS[options.alignment]
      )}
      style={style}
      title={context.state.editing ? undefined : (formatted ?? undefined)}
      onMouseDown={(event) => {
        if (event.button !== 0 || context.state.editing) {
          return;
        }
        context.commands.focus();
      }}
      onClick={context.state.editing ? undefined : onClick}
      onDoubleClick={(event) => {
        if (context.state.editable) {
          event.stopPropagation();
          context.commands.beginEdit();
          return;
        }
        context.commands.openDetail();
      }}
    >
      {context.state.editing ? (
        <DataGridCellEditor
          value={context.value}
          kind={
            context.column.editorKind ??
            dataGridEditorKind(context.column.type, editOptions)
          }
          options={editOptions}
          isBoolean={context.column.type === 'boolean'}
          onCommit={context.commands.commitEdit}
          onCancel={context.commands.cancelEdit}
        />
      ) : (
        <>
          {barShare !== null ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-1 left-1 rounded-sm bg-primary/15"
              style={{ width: `calc(${barShare * 100}% - 0.5rem)` }}
            />
          ) : null}
          <div className="relative min-w-0 truncate">{rendered}</div>
          {context.state.dirty ? <DataGridDirtyNotch /> : null}
        </>
      )}
    </div>
  );
}
