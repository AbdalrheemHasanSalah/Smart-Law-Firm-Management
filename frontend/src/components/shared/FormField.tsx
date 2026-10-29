import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type FormFieldProps = {
  id: string
  label: string
  /** i18n key (e.g. `validation:required`) or `{ key, values }` produced by the Zod schema */
  error?: string
  labelAside?: ReactNode
  className?: string
  children: ReactNode
}

/** Splits `validation:passwordMin|{"min":8}` into a key + interpolation values. */
const parseErrorMessage = (raw: string): { key: string; values?: Record<string, unknown> } => {
  const [key = raw, json] = raw.split('|')
  if (!json) return { key }
  try {
    return { key, values: JSON.parse(json) as Record<string, unknown> }
  } catch {
    return { key }
  }
}

/** Label + control + animated, translated error message. Errors re-translate on language change. */
export const FormField = ({
  id,
  label,
  error,
  labelAside,
  className,
  children,
}: FormFieldProps) => {
  const { t } = useTranslation()
  const parsed = error ? parseErrorMessage(error) : null

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {labelAside}
      </div>
      {children}
      <AnimatePresence initial={false}>
        {parsed && (
          <motion.p
            key={parsed.key}
            id={`${id}-error`}
            role="alert"
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden text-[0.8rem] text-destructive"
          >
            {t(parsed.key, parsed.values)}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
