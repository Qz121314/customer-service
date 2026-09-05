import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from './utils';

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] border text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/18 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border-primary/90 bg-primary text-primary-foreground shadow-[0_1px_2px_rgb(41_37_112_/_18%),0_7px_18px_rgb(75_67_190_/_10%)] hover:-translate-y-px hover:bg-primary/92 active:translate-y-0',
        secondary:
          'border-border bg-card text-foreground shadow-[0_1px_2px_rgb(15_23_42_/_4%)] hover:border-border-strong hover:bg-muted',
        outline:
          'border-border bg-transparent text-foreground hover:border-border-strong hover:bg-muted',
        ghost:
          'border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
        destructive:
          'border-destructive/20 bg-destructive/8 text-destructive hover:bg-destructive/14',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 rounded-[var(--radius-sm)] px-3 text-xs',
        lg: 'h-11 px-5',
        icon: 'size-10 p-0',
        'icon-sm': 'size-8 rounded-[var(--radius-sm)] p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  unstyled?: boolean;
}

export function Button({
  asChild = false,
  className,
  size,
  unstyled = false,
  variant,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  const legacyVariantClass =
    variant === 'secondary'
      ? 'secondary-button'
      : variant === 'ghost'
        ? 'ghost-button'
        : variant === 'outline'
          ? 'secondary-button'
          : variant === 'destructive'
            ? 'destructive-button'
            : 'primary-button';
  return (
    <Component
      data-ui="button"
      className={cn(
        !unstyled && buttonVariants({ size, variant }),
        !unstyled && legacyVariantClass,
        className,
      )}
      {...props}
    />
  );
}
