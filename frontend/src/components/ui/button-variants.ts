import { cva } from 'class-variance-authority'

export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium select-none',
    'transition-[background-color,color,border-color,box-shadow,transform] duration-300 ease-elegant',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:opacity-60',
    'motion-safe:active:scale-[0.98] [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary:
          'sheen bg-primary text-primary-foreground shadow-soft hover:bg-primary-hover hover:shadow-gold motion-safe:hover:-translate-y-0.5',
        accent:
          'sheen bg-accent text-accent-foreground shadow-soft hover:shadow-gold motion-safe:hover:-translate-y-0.5',
        outline:
          'border border-border-strong bg-surface text-heading hover:border-gold hover:bg-surface-muted',
        ghost: 'text-muted-foreground hover:bg-surface-muted hover:text-heading',
        link: 'h-auto px-0 text-accent underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-5 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'size-10',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)
