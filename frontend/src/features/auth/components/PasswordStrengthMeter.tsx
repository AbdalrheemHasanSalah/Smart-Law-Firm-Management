import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { STRENGTH_LEVELS, scorePassword } from '../schemas/password-strength'

const SEGMENTS = [1, 2, 3, 4] as const
const SEGMENT_COLORS = [
  'bg-border',
  'bg-destructive',
  'bg-warning',
  'bg-gold',
  'bg-success',
] as const

/** Four-segment strength bar with a spoken label. Guidance only — the server enforces policy. */
export const PasswordStrengthMeter = ({ password, id }: { password: string; id: string }) => {
  const { t } = useTranslation('auth')
  const score = scorePassword(password)
  const level = STRENGTH_LEVELS[score]

  return (
    <div id={id} className="space-y-1.5" aria-live="polite">
      <div className="flex gap-1.5" aria-hidden="true">
        {SEGMENTS.map((segment) => (
          <span key={segment} className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
            <motion.span
              // grows from the reading start: left in English, right in Arabic
              className={cn(
                'block h-full origin-left rounded-full rtl:origin-right',
                SEGMENT_COLORS[score],
              )}
              initial={false}
              animate={{ scaleX: segment <= score ? 1 : 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            />
          </span>
        ))}
      </div>
      <p className="text-[0.8rem] text-muted-foreground">
        {score === 0
          ? t('password.hint')
          : t('password.strength', { level: t(`password.levels.${level}`) })}
      </p>
    </div>
  )
}
