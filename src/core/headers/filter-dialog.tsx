import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';
import { Button } from '../../ui/controls';
import { Input } from '../../ui/controls';
import { useDataGridModalHost } from '../../ui/modal-host';
import { comparisonTakesValue, isComparisonFilterValue } from '../filters';
import type {
  DataGridColumnDataType,
  DataGridComparisonFilterValue,
  DataGridFilterComparison,
} from '../types';
import { Segmented } from './segmented';

type ComparisonOption = { value: DataGridFilterComparison; label: string };

const EMPTINESS: ComparisonOption[] = [
  { value: 'isNull', label: 'Empty' },
  { value: 'isNotNull', label: 'Filled' },
];

const TEXT_COMPARISONS: ComparisonOption[] = [
  { value: 'contains', label: 'Contains' },
  { value: 'equals', label: '=' },
  { value: 'notEquals', label: '≠' },
  ...EMPTINESS,
];

/** Ordered so the two rows of the grid read as "equality" then "range". */
const ORDERED_COMPARISONS: ComparisonOption[] = [
  { value: 'equals', label: '=' },
  { value: 'notEquals', label: '≠' },
  { value: 'greaterThan', label: '>' },
  { value: 'greaterThanOrEqual', label: '≥' },
  { value: 'lessThan', label: '<' },
  { value: 'lessThanOrEqual', label: '≤' },
  ...EMPTINESS,
];

const comparisonOptionsFor = (
  columnType: DataGridColumnDataType
): ComparisonOption[] =>
  columnType === 'number' || columnType === 'date' || columnType === 'timestamp'
    ? ORDERED_COMPARISONS
    : TEXT_COMPARISONS;

const defaultComparisonFor = (
  columnType: DataGridColumnDataType
): DataGridFilterComparison =>
  columnType === 'text' || columnType === 'category' || columnType === 'unknown'
    ? 'contains'
    : 'equals';

const inputTypeFor = (columnType: DataGridColumnDataType): string => {
  switch (columnType) {
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'timestamp':
      return 'datetime-local';
    default:
      return 'text';
  }
};

type FormState = {
  comparison: DataGridFilterComparison;
  /** The value input's raw text; parsed against the column type on submit. */
  text: string;
  booleanValue: boolean;
};

/** Reopening a filter starts from the filter that is already applied. */
const initialFormState = (
  value: unknown,
  columnType: DataGridColumnDataType
): FormState => {
  if (isComparisonFilterValue(value)) {
    return {
      comparison: value.comparison,
      text: value.value === null ? '' : String(value.value),
      booleanValue: value.value === true,
    };
  }
  // Bare scalars are the older "substring match" filters.
  const legacy =
    typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return {
    comparison: defaultComparisonFor(columnType),
    text: legacy,
    booleanValue: true,
  };
};

type BooleanChoice = 'true' | 'false' | 'isNull' | 'isNotNull';

const BOOLEAN_CHOICES: { value: BooleanChoice; label: string }[] = [
  { value: 'true', label: 'True' },
  { value: 'false', label: 'False' },
  { value: 'isNull', label: 'Empty' },
  { value: 'isNotNull', label: 'Filled' },
];

const DataGridFilterForm: React.FC<{
  columnLabel: string;
  columnType: DataGridColumnDataType;
  value: unknown;
  onSubmit: (value: DataGridComparisonFilterValue) => void;
  onCancel: () => void;
}> = ({ columnLabel, columnType, value, onSubmit, onCancel }) => {
  const [state, setState] = React.useState<FormState>(() =>
    initialFormState(value, columnType)
  );
  const takesValue = comparisonTakesValue(state.comparison);
  const numeric = Number(state.text);
  const canSubmit =
    !takesValue ||
    columnType === 'boolean' ||
    (state.text.trim() !== '' &&
      (columnType !== 'number' || Number.isFinite(numeric)));

  const booleanChoice: BooleanChoice =
    state.comparison === 'isNull'
      ? 'isNull'
      : state.comparison === 'isNotNull'
        ? 'isNotNull'
        : state.booleanValue
          ? 'true'
          : 'false';

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    onSubmit({
      kind: 'compare',
      comparison: state.comparison,
      value: !takesValue
        ? null
        : columnType === 'boolean'
          ? state.booleanValue
          : columnType === 'number'
            ? numeric
            : state.text,
    });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {columnType === 'boolean' ? (
        <Segmented
          label="Matches"
          value={booleanChoice}
          options={BOOLEAN_CHOICES}
          onChange={(choice) => {
            setState((current) => ({
              ...current,
              comparison:
                choice === 'isNull' || choice === 'isNotNull'
                  ? choice
                  : 'equals',
              booleanValue: choice === 'true',
            }));
          }}
        />
      ) : (
        <>
          <Segmented
            label="Condition"
            className="grid grid-cols-4"
            value={state.comparison}
            options={comparisonOptionsFor(columnType)}
            onChange={(comparison) => {
              setState((current) => ({ ...current, comparison }));
            }}
          />
          {takesValue ? (
            <div className="space-y-1.5">
              <label
                htmlFor="data-grid-filter-value"
                className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                Value
              </label>
              <Input
                id="data-grid-filter-value"
                autoFocus
                type={inputTypeFor(columnType)}
                placeholder={`Filter ${columnLabel}`}
                value={state.text}
                onChange={(event) => {
                  setState((current) => ({
                    ...current,
                    text: event.target.value,
                  }));
                }}
              />
            </div>
          ) : null}
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSubmit}>
          Apply filter
        </Button>
      </div>
    </form>
  );
};

export type DataGridFilterDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columnLabel: string;
  columnType: DataGridColumnDataType | undefined;
  /** The filter already applied to the column, if any. */
  value: unknown;
  onApply: (value: DataGridComparisonFilterValue) => void;
};

/**
 * The header's filter editor, shaped by the column's type — a number pad for
 * numbers, true/false for booleans, a date picker for dates.
 *
 * It prefers the app's modal stack so it layers like every other app modal;
 * when the grid renders without one (tests, isolated embeds) it falls back to
 * its own dialog rather than losing the affordance.
 */
export const DataGridFilterDialog: React.FC<DataGridFilterDialogProps> = (
  props
) => {
  const { open, onOpenChange, columnLabel, columnType, value, onApply } = props;
  const modal = useDataGridModalHost();
  // The pushed view outlives this render, so it reads the current props through
  // a ref instead of capturing them — otherwise every parent render would have
  // to pop and re-push to stay current.
  const latest = React.useRef(props);
  React.useEffect(() => {
    latest.current = props;
  });

  React.useEffect(() => {
    if (!open || modal === null) {
      return;
    }
    modal.push({
      title: 'Filter',
      subtitle: latest.current.columnLabel,
      view: () => (
        <DataGridFilterForm
          columnLabel={latest.current.columnLabel}
          columnType={latest.current.columnType ?? 'unknown'}
          value={latest.current.value}
          onSubmit={(next) => {
            latest.current.onApply(next);
            latest.current.onOpenChange(false);
          }}
          onCancel={() => {
            latest.current.onOpenChange(false);
          }}
        />
      ),
      onClose: () => {
        latest.current.onOpenChange(false);
      },
    });
    return () => {
      modal.pop();
    };
  }, [open, modal]);

  if (modal !== null) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Filter
          </div>
          <DialogTitle className="truncate">{columnLabel}</DialogTitle>
        </DialogHeader>
        <DataGridFilterForm
          columnLabel={columnLabel}
          columnType={columnType ?? 'unknown'}
          value={value}
          onSubmit={(next) => {
            onApply(next);
            onOpenChange(false);
          }}
          onCancel={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
