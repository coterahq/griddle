import * as React from 'react';
import * as HoverCardPrimitive from '@radix-ui/react-hover-card';
import { cn } from './cn';
import { useDataGridPortalContainer } from './portal';
import { DataGridThemeScope } from './theme-scope';

export type TooltipSide =
  'right' | 'top' | 'bottom' | 'left' | 'center' | 'start' | 'end' | 'auto';

/**
 * Radix aligns a hover card along the trigger's cross axis; the grid's callers
 * think in sides. Mapping preserved verbatim from the original so hover
 * placement is unchanged.
 */
const alignFor = (
  side: TooltipSide
): 'center' | 'start' | 'end' | undefined => {
  switch (side) {
    case 'auto':
      return undefined;
    case 'right':
    case 'end':
      return 'end';
    case 'left':
    case 'start':
      return 'start';
    case 'top':
    case 'bottom':
    case 'center':
      return 'center';
    default:
      return 'center';
  }
};

/**
 * A hover card presented as a tooltip.
 *
 * Not `@radix-ui/react-tooltip`: a real tooltip closes on pointer-down and
 * cannot hold interactive content, and the grid's header tooltips carry
 * multi-line descriptions the user is expected to read while moving toward
 * them. The 700ms open delay is the original's, and it matters — headers are
 * dense, so a shorter one flickers as the pointer crosses the row.
 */
export function Tooltip({
  side,
  children,
  tooltipContent,
  hidden = false,
  className,
  asChild = false,
  trigger = 'hover',
  openDelay = 700,
  closeDelay = 300,
  onOpenChange,
}: {
  side: TooltipSide;
  children: React.ReactNode;
  tooltipContent?: React.ReactNode;
  hidden?: boolean;
  className?: string;
  asChild?: boolean;
  trigger?: 'hover' | 'click';
  openDelay?: number;
  closeDelay?: number;
  onOpenChange?: (open: boolean) => void;
}): React.ReactNode {
  const [open, setOpen] = React.useState(false);
  const container = useDataGridPortalContainer();

  if (hidden) {
    return children;
  }

  return (
    <HoverCardPrimitive.Root
      open={trigger === 'click' ? open : undefined}
      openDelay={openDelay}
      closeDelay={closeDelay}
      onOpenChange={onOpenChange}
    >
      <HoverCardPrimitive.Trigger
        asChild={asChild}
        onClick={() => {
          if (trigger === 'click') {
            setOpen(true);
          }
        }}
      >
        {children}
      </HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal container={container ?? undefined}>
        <DataGridThemeScope>
          <HoverCardPrimitive.Content
            onMouseLeave={() => {
              if (trigger === 'click') {
                setOpen(false);
              }
            }}
            align={alignFor(side)}
            sideOffset={4}
            className={cn(
              'z-50 w-fit rounded-md border border-(color:--dg-border) bg-(--dg-bg) p-2 text-sm text-(color:--dg-fg) shadow-md outline-hidden',
              className
            )}
          >
            {tooltipContent}
          </HoverCardPrimitive.Content>
        </DataGridThemeScope>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}
