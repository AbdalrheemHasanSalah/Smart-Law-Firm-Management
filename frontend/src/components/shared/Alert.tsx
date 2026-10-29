import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type AlertTone = 'error' | 'success' | 'info'

type AlertProps = {
  tone: AlertTone
  title: string
  children?: ReactNode
  className?: string
}

const TONES: Record<AlertTone, { icon: typeof Info; className: string }> = {
  error: {
    icon: AlertCircle,
    className: 'border-destructive/30 bg-destructive-soft text-destructive',
  },
  success: { icon: CheckCircle2, className: 'border-success/30 bg-success-soft text-success' },
  info: { icon: Info, className: 'border-gold/40 bg-accent-soft text-accent' },
}

export const Alert = ({ tone, title, children, className }: AlertProps) => {
  const { icon: Icon, className: toneClassName } = TONES[tone]
  return (
    <motion.div
      role={tone === 'error' ? 'alert' : 'status'}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={cn('flex gap-3 rounded-xl border p-4 text-sm', toneClassName, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        {children && <div className="text-foreground/80">{children}</div>}
      </div>
    </motion.div>
  )
}
