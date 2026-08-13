import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@cotera/client/v0/components/ui/dialog';
import { Button } from '@cotera/client/v0/components/ui/button';
import { Switch } from '@cotera/client/v0/components/ui/switch';
import { cn } from '@cotera/client/v0/lib/utils';
import { ALIGNMENT_CLASS, formatDataGridNumber } from '../format';
import type {
  DataGridColumnAlignment,
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

export type DataGridDisplayOptionsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columnLabel: string;
  options: DataGridColumnDisplayOptions;
  onChange: (options: Partial<DataGridColumnDisplayOptions>) => void;
};

/**
 * Column presentation editor. Every change writes straight through to the
 * grid's display-options watchable so cells reformat without a remount.
 */
export const DataGridDisplayOptionsDialog: React.FC<
  DataGridDisplayOptionsDialogProps
> = ({ open, onOpenChange, columnLabel, options, onChange }) => {
  const previewShare =
    options.inCellBar === true
      ? Math.min(1, Math.max(0, PREVIEW_VALUE / (options.barMax ?? 1)))
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Display options
          </div>
          <DialogTitle className="truncate">{columnLabel}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Segmented
            label="Number format"
            value={options.numberFormat}
            options={NUMBER_FORMATS}
            onChange={(numberFormat) => onChange({ numberFormat })}
          />
          <Segmented
            label="Decimals"
            value={options.decimals}
            options={DECIMALS}
            onChange={(decimals) => onChange({ decimals })}
          />
          <Segmented
            label="Alignment"
            value={options.alignment}
            options={ALIGNMENTS}
            onChange={(alignment) => onChange({ alignment })}
          />

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <div>
              <div className="text-xs font-medium text-foreground">
                In-cell bar
              </div>
              <div className="text-[11px] text-muted-foreground">
                Draw a proportional bar behind numeric values
              </div>
            </div>
            <Switch
              checked={options.inCellBar}
              aria-label="In-cell bar"
              onCheckedChange={(inCellBar) => onChange({ inCellBar })}
            />
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Preview
            </div>
            <div className="relative flex h-9 items-center overflow-hidden rounded-lg border border-border bg-muted/30 px-3">
              {previewShare !== null ? (
                <div
                  className="absolute inset-y-1 left-1 rounded bg-primary/15"
                  style={{ width: `${previewShare * 100}%` }}
                />
              ) : null}
              <span
                className={cn(
                  'relative flex w-full text-sm tabular-nums',
                  ALIGNMENT_CLASS[options.alignment]
                )}
              >
                {formatDataGridNumber(PREVIEW_VALUE, options)}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
