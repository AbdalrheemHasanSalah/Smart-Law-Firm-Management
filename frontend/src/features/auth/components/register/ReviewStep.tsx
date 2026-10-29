import { zodResolver } from '@hookform/resolvers/zod'
import { PencilLine } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ROUTES } from '@/app/router/routes'
import { Alert } from '@/components/shared/Alert'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import type { ApiError } from '@/services/api/api-error'
import {
  reviewSchema,
  type LawyerValues,
  type OfficeValues,
  type ReviewValues,
} from '../../schemas/register.schema'
import { StepFrame } from './StepFrame'
import type { WizardStep } from './wizard-steps'

type Row = { label: string; value: string }

type ReviewStepProps = {
  accountSummary: Row[]
  office: OfficeValues
  lawyer: LawyerValues
  onEdit: (step: WizardStep) => void
  onBack: () => void
  onSubmit: () => void
  submitting: boolean
  error: ApiError | null
  canEditAccount: boolean
}

/** Errors that the user fixes by going back to a specific step. */
const ERROR_STEP: Partial<Record<ApiError['code'], WizardStep>> = {
  EMAIL_TAKEN: 'account',
  BAR_NUMBER_TAKEN: 'lawyer',
  BAR_NUMBER_MISMATCH: 'lawyer',
  VALIDATION: 'office',
}

const Section = ({
  title,
  rows,
  onEdit,
  editLabel,
}: {
  title: string
  rows: Row[]
  onEdit?: () => void
  editLabel: string
}) => (
  <section className="rounded-xl border border-border bg-surface-muted/60 p-4">
    <div className="mb-2 flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-heading">{title}</h3>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent-soft"
        >
          <PencilLine className="size-3.5" aria-hidden="true" />
          {editLabel}
        </button>
      )}
    </div>
    <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 font-medium break-words text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  </section>
)

export const ReviewStep = ({
  accountSummary,
  office,
  lawyer,
  onEdit,
  onBack,
  onSubmit,
  submitting,
  error,
  canEditAccount,
}: ReviewStepProps) => {
  const { t } = useTranslation('auth')
  const { t: tc } = useTranslation('common')
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ReviewValues>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { confirmAccuracy: false },
  })
  const notProvided = t('register.notProvided')
  const show = (value: string) => value.trim() || notProvided
  const editLabel = t('register.edit')
  const fixStep = error ? ERROR_STEP[error.code] : undefined

  return (
    <StepFrame
      step="review"
      onSubmit={handleSubmit(onSubmit)}
      onBack={onBack}
      submitLabel={t('register.submit')}
      submittingLabel={t('register.submitting')}
      submitting={submitting}
    >
      <AnimatePresence initial={false}>
        {error && (
          <motion.div
            key={error.code}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Alert tone="error" title={t('register.errorTitle')}>
              <p>{tc(`errors.${error.code}`)}</p>
              {error.code === 'EMAIL_TAKEN' && (
                <Link
                  to={ROUTES.login}
                  className="mt-1 inline-block font-semibold text-accent underline-offset-4 hover:underline"
                >
                  {t('register.signInInstead')}
                </Link>
              )}
              {fixStep && (fixStep !== 'account' || canEditAccount) && (
                <button
                  type="button"
                  onClick={() => onEdit(fixStep)}
                  className="ms-3 mt-1 font-semibold text-accent underline-offset-4 hover:underline"
                >
                  {t(`register.fix.${fixStep}`)}
                </button>
              )}
            </Alert>
          </motion.div>
        )}
      </AnimatePresence>

      <Section
        title={t('register.steps.account.title')}
        rows={accountSummary}
        onEdit={canEditAccount ? () => onEdit('account') : undefined}
        editLabel={editLabel}
      />
      <Section
        title={t('register.steps.office.title')}
        editLabel={editLabel}
        onEdit={() => onEdit('office')}
        rows={[
          { label: t('register.fields.officeName'), value: show(office.name) },
          { label: t('register.fields.phone'), value: show(office.phone) },
          { label: t('register.fields.city'), value: show(office.city) },
          { label: t('register.fields.officeEmail'), value: show(office.email) },
          { label: t('register.fields.address'), value: show(office.address) },
          { label: t('register.fields.licenseNumber'), value: show(office.licenseNumber) },
        ]}
      />
      <Section
        title={t('register.steps.lawyer.title')}
        editLabel={editLabel}
        onEdit={() => onEdit('lawyer')}
        rows={[
          { label: t('register.fields.barNumber'), value: show(lawyer.barNumber) },
          { label: t('register.fields.specialty'), value: show(lawyer.specialty) },
          { label: t('register.fields.yearsExperience'), value: show(lawyer.yearsExperience) },
        ]}
      />

      <p className="rounded-xl border border-dashed border-gold/50 px-4 py-3 text-xs leading-relaxed text-foreground/75">
        {t('register.reviewNotice')}
      </p>

      <div className="space-y-2">
        <div className="flex items-start gap-2.5">
          <Controller
            control={control}
            name="confirmAccuracy"
            render={({ field }) => (
              <Checkbox
                id="confirmAccuracy"
                className="mt-0.5"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                onBlur={field.onBlur}
                ref={field.ref}
                aria-invalid={errors.confirmAccuracy ? true : undefined}
                aria-describedby={errors.confirmAccuracy ? 'confirmAccuracy-error' : undefined}
              />
            )}
          />
          <Label
            htmlFor="confirmAccuracy"
            className="cursor-pointer leading-relaxed font-normal text-foreground/85"
          >
            {t('register.confirmAccuracy')}
          </Label>
        </div>
        {errors.confirmAccuracy?.message && (
          <p id="confirmAccuracy-error" role="alert" className="text-[0.8rem] text-destructive">
            {t(errors.confirmAccuracy.message)}
          </p>
        )}
      </div>
    </StepFrame>
  )
}
