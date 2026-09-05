import type { HTMLAttributes } from 'react';
import { cn } from './utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-ui="card"
      className={cn(
        'rounded-[var(--radius-lg)] border border-border bg-card text-card-foreground shadow-[0_1px_2px_rgb(15_23_42_/_4%)]',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-ui="card-header"
      className={cn('flex items-start justify-between gap-3 p-4', className)}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-ui="card-content"
      className={cn('px-4 pb-4', className)}
      {...props}
    />
  );
}
