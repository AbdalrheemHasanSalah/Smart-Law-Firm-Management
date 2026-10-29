import { AnimatePresence, motion, type Variants } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '@/hooks/use-language'
import { useAuth } from '../../auth-context'
import { useRegisterOffice } from '../../hooks/use-register-office'
import {
  emptyAccount,
  emptyLawyer,
  emptyOffice,
  type AccountValues,
  type LawyerValues,
  type OfficeValues,
} from '../../schemas/register.schema'
import type { RegisteredOffice } from '../../types'
import { AccountStep } from './AccountStep'
import { LawyerStep } from './LawyerStep'
import { OfficeStep } from './OfficeStep'
import { ReviewStep } from './ReviewStep'
import { StepIndicator } from './StepIndicator'
import { stepsFor, type WizardStep } from './wizard-steps'

/** Slides toward the reading direction when moving forward, back when moving backward. */
const slide: Variants = {
  enter: ({ forward, rtl }: { forward: boolean; rtl: boolean }) => ({
    opacity: 0,
    x: (forward ? 28 : -28) * (rtl ? -1 : 1),
  }),
  center: { opacity: 1, x: 0, transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } },
  exit: ({ forward, rtl }: { forward: boolean; rtl: boolean }) => ({
    opacity: 0,
    x: (forward ? -28 : 28) * (rtl ? -1 : 1),
    transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
  }),
}

type RegisterWizardProps = { onRegistered: (office: RegisteredOffice) => void }

export const RegisterWizard = ({ onRegistered }: RegisterWizardProps) => {
  const { t } = useTranslation('auth')
  const { direction } = useLanguage()
  const { session } = useAuth()
  // Fixed at mount: creating the account mid-way must not reshuffle the steps.
  const [steps] = useState(() => stepsFor(session !== null))
  const [signedInEmail] = useState(() => session?.user.email ?? null)
  const [index, setIndex] = useState(0)
  const [forward, setForward] = useState(true)
  const [account, setAccount] = useState<AccountValues>(emptyAccount)
  const [office, setOffice] = useState<OfficeValues>(emptyOffice)
  const [lawyer, setLawyer] = useState<LawyerValues>(emptyLawyer)
  const registration = useRegisterOffice()

  const step = steps[index] ?? 'review'
  const goTo = (target: WizardStep) => {
    const targetIndex = steps.indexOf(target)
    if (targetIndex < 0) return
    setForward(targetIndex > index)
    setIndex(targetIndex)
  }
  const next = () => {
    setForward(true)
    setIndex((current) => Math.min(current + 1, steps.length - 1))
  }
  const back = () => {
    setForward(false)
    setIndex((current) => Math.max(current - 1, 0))
  }

  const submit = () =>
    registration.mutate(
      { account: signedInEmail ? null : account, office, lawyer },
      { onSuccess: onRegistered },
    )

  const accountSummary = signedInEmail
    ? [{ label: t('register.fields.email'), value: signedInEmail }]
    : [
        { label: t('register.fields.fullName'), value: account.fullName },
        { label: t('register.fields.email'), value: account.email },
      ]

  return (
    <div className="space-y-7">
      <StepIndicator steps={steps} current={index} />
      {signedInEmail && (
        <p className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
          {t('register.signedInAs', { email: signedInEmail })}
        </p>
      )}
      <div className="relative">
        <AnimatePresence mode="wait" initial={false} custom={{ forward, rtl: direction === 'rtl' }}>
          <motion.div
            key={step}
            custom={{ forward, rtl: direction === 'rtl' }}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
          >
            {step === 'account' && (
              <AccountStep
                defaultValues={account}
                onNext={(values) => {
                  setAccount(values)
                  registration.reset()
                  next()
                }}
              />
            )}
            {step === 'office' && (
              <OfficeStep
                defaultValues={office}
                onBack={index > 0 ? back : undefined}
                onNext={(values) => {
                  setOffice(values)
                  next()
                }}
              />
            )}
            {step === 'lawyer' && (
              <LawyerStep
                defaultValues={lawyer}
                onBack={back}
                onNext={(values) => {
                  setLawyer(values)
                  registration.reset()
                  next()
                }}
              />
            )}
            {step === 'review' && (
              <ReviewStep
                accountSummary={accountSummary}
                office={office}
                lawyer={lawyer}
                canEditAccount={!signedInEmail && !session}
                onEdit={goTo}
                onBack={back}
                onSubmit={submit}
                submitting={registration.isPending}
                error={registration.error}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
