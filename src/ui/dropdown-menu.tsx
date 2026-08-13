import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from './cn';
import { useDataGridPortalContainer } from './portal';
import { DataGridThemeScope } from './theme-scope';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<
  typeof DropdownMenuPrimitive.Content
>): React.ReactElement {
  const container = useDataGridPortalContainer();
  return (
    <DropdownMenuPrimitive.Portal container={container ?? undefined}>
      <DataGridThemeScope>
        <DropdownMenuPrimitive.Content
          sideOffset={sideOffset}
          className={cn(
            'z-50 min-w-[12rem] overflow-hidden rounded-md border border-border',
            'bg-popover p-1 text-popover-foreground shadow-md outline-hidden',
            className
          )}
          {...props}
        />
      </DataGridThemeScope>
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<
  typeof DropdownMenuPrimitive.Item
>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[11px] outline-hidden',
        'focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<
  typeof DropdownMenuPrimitive.Separator
>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}
