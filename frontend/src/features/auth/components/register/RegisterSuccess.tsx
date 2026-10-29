import { CheckCircle2, Clock3, MailCheck, UsersRound } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ROUTES } from '@/app/router/routes'
import { fadeUp, staggerContainer } from '@/components/motion/presets'
import { Button } from '@/components/ui/button'
import type { RegisteredOffice } from '../../types'

const NEXT_STEPS = [
  { key: 'review', icon: Clock3 },
  { key: 'notify', icon: MailCheck },
  { key: 'team', icon: UsersRound },
] as const

/** Shown once the office is registered: it is pending until the platform reviews it. */
export const RegisterSuccess = ({ office }: { office: RegisteredOffice }) => {
  const { t } = useTranslation('auth')
  return (
    <motion.div
      variants={staggerContainer(0.08, 0.05)}
      initial="hidden"
      animate="visible"
      className="text-center"
    >
      <motion.div
        variants={{
          hidden: { opacity: 0, scale: 0.6 },
          visible: {
            opacity: 1,
            scale: 1,
            transition: { type: 'spring', stiffness: 260, damping: 18 },
          },
        }}
        className="mx-auto mb-6 grid size-16 place-items-center rounded-full bg-success-soft text-success shadow-soft"
      >
        <CheckCircle2 className="size-8" aria-hidden="true" />
      </motion.div>
      <motion.h1 variants={fadeUp} className="font-display text-3xl font-bold">
        {t('register.success.title')}
      </motion.h1>
      <motion.p variants={fadeUp} className="mt-3 leading-relaxed text-muted-foreground">
        {t('register.success.body', { office: office.name })}
      </motion.p>
      <motion.ul variants={fadeUp} className="mt-7 space-y-3 text-start">
        {NEXT_STEPS.map(({ key, icon: Icon }) => (
          <li key={key} className="flex gap-3 rounded-xl border border-border bg-surface p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-heading">
                {t(`register.success.next.${key}.title`)}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t(`register.success.next.${key}.body`)}
              </p>
            </div>
          </li>
        ))}
      </motion.ul>
      <motion.div variants={fadeUp} className="mt-8">
        <Button asChild size="lg" className="w-full">
          <Link to={ROUTES.onboarding}>{t('register.success.viewStatus')}</Link>
        </Button>
      </motion.div>
    </motion.div>
  )
}
