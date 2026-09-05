import type { HTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react';
import { cn } from './utils';

export function Field({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-ui="field"
      className={cn('grid min-w-0 gap-1.5', className)}
      {...props}
    />
  );
}

export interface FieldLabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  hint?: ReactNode;
}

export function FieldLabel({
  children,
  className,
  hint,
  ...props
}: FieldLabelProps) {
  return (
    <label
      data-ui="field-label"
      className={cn(
        'flex min-w-0 items-center justify-between gap-3 text-xs font-semibold text-foreground',
        className,
      )}
      {...props}
    >
      <span>{children}</span>
      {hint ? (
        <span className="font-normal text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export function FieldDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-ui="field-description"
      className={cn('text-xs leading-5 text-muted-foreground', className)}
      {...props}
    />
  );
}
