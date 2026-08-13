import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from './cn';

/**
 * The three form controls the default header's dialogs need.
 *
 * Deliberately minimal — no `class-variance-authority`, no icon slot, no
 * loading state, no analytics hook. The originals carry all of that because
 * they are an application's shared buttons; here they exist only so the filter
 * and display-options dialogs render, and every one of those extras would be
 * surface this library then has to keep working.
 *
 * Not exported from the package. A consumer wanting different controls
 * replaces `HeaderComponent` wholesale.
 */

export function Button({
  className,
  variant = 'default',
  size = 'default',
  type = 'button',
  ...props
}: React.ComponentProps<'button'> & {
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm';
}): React.ReactElement {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium',
        'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-(color:--dg-focus-ring-control)',
        'disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm',
        variant === 'default' &&
          'bg-(--dg-accent) text-(color:--dg-accent-fg) hover:bg-(--dg-accent-hover) active:bg-(--dg-accent-active)',
        variant === 'outline' &&
          'border border-(color:--dg-border) bg-(--dg-bg) hover:bg-(--dg-muted)',
        variant === 'ghost' && 'hover:bg-(--dg-muted)',
        className
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  type = 'text',
  ...props
}: React.ComponentProps<'input'>): React.ReactElement {
  return (
    <input
      type={type}
      className={cn(
        'flex h-8 w-full rounded-sm border border-(color:--dg-border) bg-(--dg-bg) px-2 py-1 text-xs',
        'text-(color:--dg-fg) placeholder:text-(color:--dg-muted-fg)',
        'outline-none focus-visible:ring-2 focus-visible:ring-(color:--dg-focus-ring-soft)',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>): React.ReactElement {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-(color:--dg-focus-ring-soft)',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-(--dg-accent) data-[state=unchecked]:bg-(--dg-switch-track)',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-(--dg-bg) shadow-sm ring-0 transition-transform',
          'data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5'
        )}
      />
    </SwitchPrimitive.Root>
  );
}
