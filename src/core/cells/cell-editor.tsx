import React from 'react';
import { cn } from '@cotera/client/v0/lib/utils';
import { toDataGridDate } from '../format';
import type {
  DataGridCellValue,
  DataGridColumnDataType,
  DataGridEditorKind,
} from '../types';

export const dataGridEditorKind = (
  type: DataGridColumnDataType | undefined,
  options: readonly string[] | undefined
): DataGridEditorKind => {
  if (options !== undefined && options.length > 0) {
    return 'select';
  }
  switch (type) {
    case 'number':
      return 'number';
    case 'date':
    case 'timestamp':
      return 'date';
    case 'boolean':
      return 'select';
    default:
      return 'text';
  }
};

const BOOLEAN_OPTIONS = ['true', 'false'] as const;

/** `<input type="date">` needs YYYY-MM-DD, whatever the stored shape is. */
const toDateInputValue = (value: unknown): string =>
  toDataGridDate(value)?.toISOString().slice(0, 10) ?? '';

const toEditorValue = (value: unknown, kind: DataGridEditorKind): string => {
  if (value === null || value === undefined) {
    return '';
  }
  return kind === 'date' ? toDateInputValue(value) : String(value);
};

const parseEditorValue = (
  raw: string,
  kind: DataGridEditorKind
): DataGridCellValue => {
  if (raw === '') {
    return null;
  }
  if (kind === 'number') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (raw === 'true' || raw === 'false') {
    return raw === 'true';
  }
  return raw;
};

const EDITOR_CLASS =
  'h-full w-full min-w-0 bg-transparent px-0 text-sm outline-none';

export type DataGridCellEditorProps = {
  value: unknown;
  kind: DataGridEditorKind;
  options?: readonly string[];
  isBoolean?: boolean;
  onCommit: (value: DataGridCellValue) => void;
  onCancel: () => void;
};

/**
 * In-place cell editor. Enter and Tab commit, Escape cancels, and blur commits
 * so clicking elsewhere keeps the typed value. `settled` guards against a
 * cancel being followed by the blur that cancelling itself causes.
 */
export const DataGridCellEditor: React.FC<DataGridCellEditorProps> = ({
  value,
  kind,
  options,
  isBoolean = false,
  onCommit,
  onCancel,
}) => {
  const [draft, setDraft] = React.useState(() => toEditorValue(value, kind));
  const settled = React.useRef(false);

  const commit = React.useCallback(
    (raw: string) => {
      if (settled.current) {
        return;
      }
      settled.current = true;
      onCommit(parseEditorValue(raw, kind));
    },
    [kind, onCommit]
  );

  const cancel = React.useCallback(() => {
    if (settled.current) {
      return;
    }
    settled.current = true;
    onCancel();
  }, [onCancel]);

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    // Keystrokes must not reach the grid's navigation handler.
    event.stopPropagation();
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      commit(event.currentTarget.value);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  };

  const selectOptions =
    isBoolean && (options === undefined || options.length === 0)
      ? BOOLEAN_OPTIONS
      : options ?? [];

  if (kind === 'select') {
    return (
      <select
        autoFocus
        aria-label="Edit cell"
        className={cn(EDITOR_CLASS, 'cursor-pointer')}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          commit(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        onBlur={(event) => commit(event.target.value)}
        onClick={(event) => event.stopPropagation()}
      >
        <option value="">—</option>
        {selectOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      autoFocus
      aria-label="Edit cell"
      type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'}
      className={EDITOR_CLASS}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={(event) => commit(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
};
