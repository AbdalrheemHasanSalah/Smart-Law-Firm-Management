import type { LucideIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { FormField } from './FormField'

type TextFieldProps = Omit<ComponentProps<'input'>, 'id'> & {
  id: string
  label: string
  /** i18n-encoded error from the Zod schema, rendered by FormField */
  error?: string
  icon?: LucideIcon
  hint?: ReactNode
  labelAside?: ReactNode
  optionalLabel?: string
}

/** Label + optional leading icon + input + hint/error, wired for accessibility. */
export const TextField = ({
  id,
  label,
  error,
  icon: Icon,
  hint,
  labelAside,
  optionalLabel,
  className,
  ...inputProps
}: TextFieldProps) => {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ')
  return (
    <FormField
      id={id}
      label={optionalLabel ? `${label} (${optionalLabel})` : label}
      error={error}
      labelAside={labelAside}
    >
      <div className="group relative">
        {Icon && (
          <Icon
            aria-hidden="true"
            className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-accent"
          />
        )}
        <Input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(Icon && 'ps-11', className)}
          {...inputProps}
        />
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[0.8rem] text-muted-foreground">
          {hint}
        </p>
      )}
    </FormField>
  )
}
