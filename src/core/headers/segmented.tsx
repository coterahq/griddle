import { cn } from '../../ui/cn';

export type SegmentedProps<TValue extends string | number | boolean | null> = {
  label: string;
  value: TValue;
  options: { value: TValue; label: string }[];
  onChange: (value: TValue) => void;
  className?: string;
};

/** A compact radio group for the small, closed choices header forms are made of. */
export function Segmented<TValue extends string | number | boolean | null>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedProps<TValue>) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn(
          'flex gap-1 rounded-lg border border-border bg-muted/40 p-1',
          className
        )}
      >
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            className={cn(
              'flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
              option.value === value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-background hover:text-foreground'
            )}
            onClick={() => {
              onChange(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
