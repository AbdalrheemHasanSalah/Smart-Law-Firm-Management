import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const Input = ({ className, type = 'text', ...props }: ComponentProps<'input'>) => (
  <input
    type={type}
    className={cn(
      'h-12 w-full rounded-lg border border-input bg-surface px-4 text-[0.95rem] text-foreground shadow-[inset_0_1px_2px_rgb(0_0_0/0.03)]',
      'placeholder:text-muted-foreground/60',
      'transition-[border-color,box-shadow,background-color] duration-300 ease-elegant',
      'hover:border-border-strong',
      'focus-visible:border-gold focus-visible:ring-4 focus-visible:ring-accent-soft focus-visible:outline-none',
      'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive-soft',
      'disabled:cursor-not-allowed disabled:opacity-60',
      className,
    )}
    {...props}
  />
)
