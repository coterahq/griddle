import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from './cn';
import { useDataGridPortalContainer } from './portal';
import { DataGridThemeScope } from './theme-scope';

export const Dialog = DialogPrimitive.Root;

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>): React.ReactElement {
  const container = useDataGridPortalContainer();
  return (
    <DialogPrimitive.Portal container={container ?? undefined}>
      <DataGridThemeScope>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-(--dg-scrim) data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
            'rounded-md border border-(color:--dg-border) bg-(--dg-bg) p-4 text-(color:--dg-fg) shadow-lg outline-hidden',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
            className
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Content>
      </DataGridThemeScope>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  className,
  ...props
}: React.ComponentProps<'div'>): React.ReactElement {
  return (
    <div className={cn('mb-3 flex flex-col gap-1', className)} {...props} />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>): React.ReactElement {
  return (
    <DialogPrimitive.Title
      className={cn('text-sm font-medium text-(color:--dg-fg)', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<
  typeof DialogPrimitive.Description
>): React.ReactElement {
  return (
    <DialogPrimitive.Description
      className={cn('text-xs text-(color:--dg-muted-fg)', className)}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  ...props
}: React.ComponentProps<'div'>): React.ReactElement {
  return (
    <div
      className={cn('mt-4 flex items-center justify-end gap-2', className)}
      {...props}
    />
  );
}
