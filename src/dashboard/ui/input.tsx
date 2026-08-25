import type { InputHTMLAttributes } from 'react';
import { cn } from './utils';

export function Input({
  className,
  type,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      data-ui="input"
      className={cn(
        'h-10 w-full min-w-0 rounded-[var(--radius-control)] border border-input bg-card px-3 text-sm text-foreground shadow-[inset_0_1px_2px_rgb(15_23_42_/_2%)] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/72 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/12 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
