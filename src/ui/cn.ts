import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional class names, with later Tailwind utilities beating earlier ones.
 *
 * `tailwind-merge` is not decoration: `DataGridProps.className` and the
 * per-column overrides are documented to win over the defaults, and plain
 * concatenation would leave both classes present and let source order in the
 * stylesheet decide.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
