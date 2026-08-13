import React from 'react';
import { Icon } from '../../ui/icons';
import { Tooltip } from '../../ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { cn } from '../../ui/cn';
import { dataGridColumnTypeIcon } from '../column-type';
import { DEFAULT_DATA_GRID_DISPLAY_OPTIONS } from '../types';
import type { DataGridHeaderComponentProps } from '../types';
import { DataGridColumnStatsView } from './column-stats';
import { DataGridDisplayOptionsDialog } from './display-options-dialog';
import { DataGridFilterDialog } from './filter-dialog';

const columnLabel = (header: React.ReactNode, fallback: string): string =>
  typeof header === 'string' ? header : fallback;

export function DataGridHeader<TRow>({
  context,
  style,
  actions,
}: DataGridHeaderComponentProps<TRow>) {
  const rendered =
    context.column.renderHeader?.(context) ?? context.column.header;
  const label = columnLabel(context.column.header, context.column.id);
  const [resizeStart, setResizeStart] = React.useState<{
    x: number;
    width: number;
  } | null>(null);
  const [displayOptionsOpen, setDisplayOptionsOpen] = React.useState(false);
  const [filterOpen, setFilterOpen] = React.useState(false);

  React.useEffect(() => {
    if (resizeStart === null) {
      return;
    }

    const onMouseMove = (event: MouseEvent) => {
      context.commands.resize(
        resizeStart.width + event.clientX - resizeStart.x
      );
    };
    const onMouseUp = () => {
      setResizeStart(null);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [context.commands, resizeStart]);

  const sortable = context.column.sortable !== false;
  const stats =
    context.column.renderHeaderStats?.(context) ??
    (context.statsExpanded ? (
      <DataGridColumnStatsView
        stats={context.stats}
        columnLabel={label}
        filterValue={context.filter?.value}
        onSelectStatFilter={context.commands.toggleStatFilter}
      />
    ) : null);

  return (
    <div
      role="columnheader"
      aria-colindex={context.columnIndex + 2}
      aria-sort={
        context.sort === null
          ? 'none'
          : context.sort.direction === 'asc'
            ? 'ascending'
            : 'descending'
      }
      data-sorted={context.sort !== null ? 'true' : 'false'}
      data-filtered={context.filter !== null ? 'true' : 'false'}
      className={cn(
        'group/header absolute flex h-full flex-col border-b border-r border-border bg-muted/40 text-xs font-medium text-muted-foreground',
        'data-[sorted=true]:bg-primary/5 data-[filtered=true]:bg-primary/10'
      )}
      style={style}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', context.column.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const sourceColumnId = event.dataTransfer.getData('text/plain');
        if (sourceColumnId !== '' && sourceColumnId !== context.column.id) {
          context.commands.reorderBefore(sourceColumnId);
        }
      }}
    >
      <div className="flex min-h-10 items-center gap-1.5 px-2.5">
        {context.column.computed === true ? (
          <span
            aria-label="Computed column"
            title="Computed column"
            className="shrink-0 rounded bg-muted px-1 font-mono text-[9px] italic text-muted-foreground"
          >
            fx
          </span>
        ) : (
          <Icon
            icon={dataGridColumnTypeIcon(context.column.type)}
            size="small"
            className="shrink-0 text-muted-foreground/70"
          />
        )}
        <Tooltip
          asChild
          side="top"
          tooltipContent={
            <div className="whitespace-nowrap text-xs">
              <div className="font-medium text-foreground">{label}</div>
              {context.column.typeLabel !== undefined ? (
                <div className="text-muted-foreground">
                  {context.column.typeLabel}
                </div>
              ) : null}
            </div>
          }
        >
          <button
            type="button"
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1 truncate text-left text-[11px] font-semibold uppercase tracking-wide',
              context.sort !== null ? 'text-primary' : 'text-foreground/80'
            )}
            onClick={() => {
              if (sortable) {
                context.commands.toggleSort(
                  context.sort?.direction === 'asc' ? 'desc' : 'asc'
                );
              }
            }}
          >
            <span className="min-w-0 truncate">{rendered}</span>
            {context.sort !== null ? (
              <span
                aria-label={
                  context.sort.direction === 'asc'
                    ? 'Sorted ascending'
                    : 'Sorted descending'
                }
                className="shrink-0 font-normal"
              >
                {context.sort.direction === 'asc' ? '↑' : '↓'}
              </span>
            ) : null}
            {context.sort !== null &&
            context.sortCount > 1 &&
            context.sortIndex !== null ? (
              <span
                className="shrink-0 text-[9px] font-semibold leading-none tabular-nums"
                aria-label={`Sort priority ${context.sortIndex + 1}`}
              >
                {context.sortIndex + 1}
              </span>
            ) : null}
          </button>
        </Tooltip>
        {/* The column's own controls, between its name and the grid's menu.
            Sibling of the title rather than inside it, so pressing one does not
            also toggle the sort. `normal-case` because the header's uppercase
            treatment is for the label, not for a control beside it. */}
        {actions === undefined || actions === null ? null : (
          <span className="flex shrink-0 items-center gap-1 normal-case">
            {actions}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${label} column options`}
              className="shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover/header:opacity-100 data-[state=open]:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
            >
              <Icon icon="ellipsis-horizontal" size="small" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-48"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            {sortable ? (
              <>
                <DropdownMenuItem
                  onSelect={() => {
                    context.commands.setSort('asc');
                  }}
                >
                  <Icon icon="sort-asc" size="small" />
                  Sort ascending
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    context.commands.setSort('desc');
                  }}
                >
                  <Icon icon="sort-desc" size="small" />
                  Sort descending
                </DropdownMenuItem>
                {context.sort !== null ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      context.commands.setSort(null);
                    }}
                  >
                    <Icon icon="x-mark" size="small" />
                    Clear sort
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
              </>
            ) : null}
            {context.column.pinned !== 'left' ? (
              <DropdownMenuItem
                onSelect={() => {
                  context.commands.pin('left');
                }}
              >
                <Icon icon="arrow-left-end-on-rectangle" size="small" />
                Pin left
              </DropdownMenuItem>
            ) : null}
            {context.column.pinned !== 'right' ? (
              <DropdownMenuItem
                onSelect={() => {
                  context.commands.pin('right');
                }}
              >
                <Icon icon="arrow-right-end-on-rectangle" size="small" />
                Pin right
              </DropdownMenuItem>
            ) : null}
            {context.column.pinned !== null &&
            context.column.pinned !== undefined ? (
              <DropdownMenuItem
                onSelect={() => {
                  context.commands.unpin();
                }}
              >
                <Icon icon="pin-off" size="small" />
                Unpin
              </DropdownMenuItem>
            ) : null}
            {context.column.filterable === true ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    setFilterOpen(true);
                  }}
                >
                  <Icon icon="magnifying-glass" size="small" />
                  {context.filter !== null ? 'Edit filter…' : 'Filter…'}
                </DropdownMenuItem>
                {context.filter !== null ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      context.commands.clearFilter();
                    }}
                  >
                    <Icon icon="clear-filters" size="small" />
                    Clear filter
                  </DropdownMenuItem>
                ) : null}
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                setDisplayOptionsOpen(true);
              }}
            >
              <Icon icon="adjustments-horizontal" size="small" />
              Display options…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                context.commands.hide();
              }}
            >
              <Icon icon="eye-slash" size="small" />
              Hide column
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {context.statsExpanded && stats !== null ? (
        <div className="min-h-0 flex-1 overflow-visible px-2.5 pb-2">
          {stats}
        </div>
      ) : null}
      <button
        type="button"
        aria-label={`Resize ${context.column.id}`}
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize"
        onMouseDown={(event) => {
          event.preventDefault();
          setResizeStart({
            x: event.clientX,
            width: context.column.width ?? 160,
          });
        }}
      />
      <DataGridFilterDialog
        open={filterOpen}
        onOpenChange={setFilterOpen}
        columnLabel={label}
        columnType={context.column.type}
        value={context.filter?.value}
        onApply={context.commands.setFilter}
      />
      <DataGridDisplayOptionsDialog
        open={displayOptionsOpen}
        onOpenChange={setDisplayOptionsOpen}
        columnLabel={label}
        options={context.displayOptions ?? DEFAULT_DATA_GRID_DISPLAY_OPTIONS}
        onChange={context.commands.setDisplayOptions}
      />
    </div>
  );
}
