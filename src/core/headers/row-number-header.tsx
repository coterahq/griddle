import { cn } from '@cotera/client/v0/lib/utils';
import { Icon } from '@cotera/client/app/components/ui/icon';
import { Tooltip } from '@cotera/client/app/components/ui/tooltip';
import type { DataGridRowNumberLayoutItem } from '../types';

/**
 * Geometry shared by the gutter's two chevrons — this header's stats
 * disclosure and each row's expand toggle.
 *
 * They sit in different components but in the same visual column, so the
 * placement lives in one place rather than being matched by eye twice.
 */
export const DATA_GRID_GUTTER_CHEVRON_CLASS =
  'absolute left-1 flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground';

/**
 * The row-number gutter, which also hosts the stats disclosure. Putting the
 * toggle here keeps it attached to the header band it expands, rather than
 * floating in the top bar away from the thing it controls.
 */
export function RowNumberHeader({
  column,
  headerHeight,
  statsExpanded,
  onToggleStats,
}: {
  column: DataGridRowNumberLayoutItem;
  headerHeight: number;
  statsExpanded: boolean;
  onToggleStats: () => void;
}) {
  const label = statsExpanded ? 'Hide column stats' : 'Show column stats';

  return (
    <div
      role="columnheader"
      aria-colindex={1}
      // In flow inside the left pinned group, which is the sticky element.
      // Laid out like a body row — chevron pinned left, label right-aligned —
      // so both line up down the gutter, and `#` sits over the row numbers.
      // `items-start` rather than centred because the header grows tall when
      // stats expand and the chevron must stay beside the first line.
      className="relative flex items-start justify-end border-b border-r border-border bg-muted/80 px-2 py-2"
      style={{ width: column.width, height: headerHeight, flexShrink: 0 }}
    >
      <Tooltip asChild side="top" tooltipContent={label}>
        <button
          type="button"
          aria-label={label}
          aria-expanded={statsExpanded}
          onClick={onToggleStats}
          className={cn(DATA_GRID_GUTTER_CHEVRON_CLASS, 'top-2')}
        >
          <Icon
            icon={statsExpanded ? 'chevron-down' : 'chevron-right'}
            size="small"
          />
        </button>
      </Tooltip>
      <span className="text-xs font-semibold text-muted-foreground">#</span>
    </div>
  );
}
