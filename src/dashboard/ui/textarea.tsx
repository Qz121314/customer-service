import type { TextareaHTMLAttributes } from 'react';
import { cn } from './utils';

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      data-ui="textarea"
      className={cn(
        'min-h-24 w-full resize-y rounded-[var(--radius-control)] border border-input bg-card px-3 py-2.5 text-sm leading-6 text-foreground outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/72 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/12 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
