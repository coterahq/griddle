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
        'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        'disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm',
        variant === 'default' &&
          'bg-primary text-primary-foreground hover:bg-primary/80 active:bg-primary/90',
        variant === 'outline' &&
          'border border-border bg-background hover:bg-muted',
        variant === 'ghost' && 'hover:bg-muted',
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
        'flex h-8 w-full rounded-sm border border-border bg-background px-2 py-1 text-xs',
        'text-foreground placeholder:text-muted-foreground',
        'outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
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
        'outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground/30',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform',
          'data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5'
        )}
      />
    </SwitchPrimitive.Root>
  );
}
