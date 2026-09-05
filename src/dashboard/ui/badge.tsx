import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from './utils';

export const badgeVariants = cva(
  'inline-flex min-h-6 items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-0.5 text-xs font-semibold leading-none',
  {
    variants: {
      variant: {
        default: 'border-border bg-card text-foreground',
        muted: 'border-border bg-muted text-muted-foreground',
        accent: 'border-primary/15 bg-primary/8 text-primary',
        success: 'border-emerald-600/15 bg-emerald-50 text-emerald-700',
        warning: 'border-amber-600/15 bg-amber-50 text-amber-700',
        destructive: 'border-destructive/18 bg-destructive/8 text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      data-ui="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}
