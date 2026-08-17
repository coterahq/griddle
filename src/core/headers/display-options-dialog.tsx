import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';
import { Button } from '../../ui/controls';
import { Switch } from '../../ui/controls';
import { cn } from '../../ui/cn';
import { ALIGNMENT_CLASS, formatDataGridNumber } from '../format';
import type {
  DataGridColumnAlignment,
  DataGridColumnDataType,
  DataGridColumnDisplayOptions,
  DataGridNumberFormat,
} from '../types';
import { Segmented } from './segmented';

const NUMBER_FORMATS: { value: DataGridNumberFormat; label: string }[] = [
  { value: 'number', label: 'Number' },
  { value: 'percent', label: 'Percent' },
  { value: 'compact', label: 'Compact' },
];

const ALIGNMENTS: { value: DataGridColumnAlignment; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];

const DECIMALS: { value: number | null; label: string }[] = [
  { value: null, label: 'Auto' },
  { value: 0, label: '0' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
];

const PREVIEW_VALUE = 0.4213;
const PREVIEW_TEXT = 'Sample value';

/**
 * Whether number formatting means anything for this column.
 *
 * `undefined` and `unknown` count as numeric-capable on purpose: a column that
 * never declared a type can still hold numbers, and the formatter decides at
 * runtime by looking at the value. An explicitly non-numeric column cannot,
 * so offering it a decimal count is offering a control that does nothing.
 */
const isNumericColumn = (type: DataGridColumnDataType | undefined): boolean =>
  type === undefined || type === 'number' || type === 'unknown';

export type DataGridDisplayOptionsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columnLabel: string;
  /** Drives which controls are shown; omitted behaves as an untyped column. */
  columnType?: DataGridColumnDataType;
  options: DataGridColumnDisplayOptions;
  onChange: (options: Partial<DataGridColumnDisplayOptions>) => void;
};

/**
 * Column presentation editor. Every change writes straight through to the
 * grid's display-options watchable so cells reformat without a remount.
 */
export const DataGridDisplayOptionsDialog: React.FC<
  DataGridDisplayOptionsDialogProps
> = ({ open, onOpenChange, columnLabel, columnType, options, onChange }) => {
  const numeric = isNumericColumn(columnType);
  const previewShare =
    numeric && options.inCellBar
      ? Math.min(1, Math.max(0, PREVIEW_VALUE / (options.barMax ?? 1)))
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="text-[11px] font-medium uppercase tracking-wide text-(color:--dg-muted-fg)">
            Display options
          </div>
          <DialogTitle className="truncate">{columnLabel}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Number formatting, decimals and the in-cell bar all operate on a
              numeric value. On a text or date column they are controls that
              visibly do nothing, so they are not offered. Alignment applies to
              every column. */}
          {numeric ? (
            <Segmented
              label="Number format"
              value={options.numberFormat}
              options={NUMBER_FORMATS}
              onChange={(numberFormat) => {
                onChange({ numberFormat });
              }}
            />
          ) : null}
          {numeric ? (
            <Segmented
              label="Decimals"
              value={options.decimals}
              options={DECIMALS}
              onChange={(decimals) => {
                onChange({ decimals });
              }}
            />
          ) : null}
          <Segmented
            label="Alignment"
            value={options.alignment}
            options={ALIGNMENTS}
            onChange={(alignment) => {
              onChange({ alignment });
            }}
          />

          {numeric ? (
            <div className="flex items-center justify-between rounded-lg border border-(color:--dg-border) px-3 py-2">
              <div>
                <div className="text-xs font-medium text-(color:--dg-fg)">
                  In-cell bar
                </div>
                <div className="text-[11px] text-(color:--dg-muted-fg)">
                  Draw a proportional bar behind numeric values
                </div>
              </div>
              <Switch
                checked={options.inCellBar}
                aria-label="In-cell bar"
                onCheckedChange={(inCellBar) => {
                  onChange({ inCellBar });
                }}
              />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-(color:--dg-muted-fg)">
              Preview
            </div>
            <div className="relative flex h-9 items-center overflow-hidden rounded-lg border border-(color:--dg-border) bg-(--dg-slider-track-bg) px-3">
              {previewShare !== null ? (
                <div
                  className="absolute inset-y-1 left-1 rounded bg-(--dg-segmented-thumb-bg)"
                  style={{ width: `${previewShare * 100}%` }}
                />
              ) : null}
              <span
                className={cn(
                  'relative flex w-full text-sm tabular-nums',
                  ALIGNMENT_CLASS[options.alignment]
                )}
              >
                {numeric
                  ? formatDataGridNumber(PREVIEW_VALUE, options)
                  : PREVIEW_TEXT}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            size="sm"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
