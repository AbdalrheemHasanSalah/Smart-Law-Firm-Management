import { Check } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

type StepIndicatorProps = {
  steps: readonly string[]
  current: number
}

/** Numbered progress for the registration wizard; completed steps show a check. */
export const StepIndicator = ({ steps, current }: StepIndicatorProps) => {
  const { t } = useTranslation('auth')
  return (
    <nav aria-label={t('register.progressLabel')}>
      <p className="mb-3 text-xs font-medium text-muted-foreground">
        {t('register.stepOf', { current: current + 1, total: steps.length })}
      </p>
      <ol className="flex items-center gap-2">
        {steps.map((step, index) => {
          const done = index < current
          const active = index === current
          return (
            <li
              key={step}
              className="flex flex-1 items-center gap-2 last:flex-none"
              aria-current={active ? 'step' : undefined}
            >
              <span
                className={cn(
                  'relative grid size-8 shrink-0 place-items-center rounded-full border text-xs font-semibold transition-colors duration-300',
                  done && 'border-primary bg-primary text-primary-foreground',
                  active && 'border-gold bg-accent-soft text-accent shadow-gold',
                  !done && !active && 'border-border bg-surface text-muted-foreground',
                )}
              >
                {done ? <Check className="size-4" aria-hidden="true" /> : index + 1}
                <span className="sr-only">
                  {t(`register.steps.${step}.title`)}
                  {done ? ` — ${t('register.stepDone')}` : ''}
                </span>
              </span>
              {index < steps.length - 1 && (
                <span className="relative h-px flex-1 overflow-hidden bg-border" aria-hidden="true">
                  <motion.span
                    className="absolute inset-0 origin-left bg-gold rtl:origin-right"
                    initial={false}
                    animate={{ scaleX: done ? 1 : 0 }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  />
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
