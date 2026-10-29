import { zodResolver } from '@hookform/resolvers/zod'
import { BadgeCheck, BookOpen, CalendarClock } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { TextField } from '@/components/shared/TextField'
import { lawyerSchema, type LawyerValues } from '../../schemas/register.schema'
import { StepFrame } from './StepFrame'

type LawyerStepProps = {
  defaultValues: LawyerValues
  onNext: (values: LawyerValues) => void
  onBack: () => void
}

export const LawyerStep = ({ defaultValues, onNext, onBack }: LawyerStepProps) => {
  const { t } = useTranslation('auth')
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LawyerValues>({
    resolver: zodResolver(lawyerSchema),
    defaultValues,
    mode: 'onTouched',
  })
  const optional = t('register.optional')

  return (
    <StepFrame step="lawyer" onSubmit={handleSubmit(onNext)} onBack={onBack}>
      <TextField
        id="barNumber"
        dir="ltr"
        label={t('register.fields.barNumber')}
        placeholder="PBA-00000"
        hint={t('register.hints.barNumber')}
        icon={BadgeCheck}
        error={errors.barNumber?.message}
        {...register('barNumber')}
      />
      <TextField
        id="specialty"
        label={t('register.fields.specialty')}
        optionalLabel={optional}
        placeholder={t('register.placeholders.specialty')}
        icon={BookOpen}
        error={errors.specialty?.message}
        {...register('specialty')}
      />
      <TextField
        id="yearsExperience"
        type="number"
        dir="ltr"
        min={0}
        max={70}
        inputMode="numeric"
        label={t('register.fields.yearsExperience')}
        optionalLabel={optional}
        icon={CalendarClock}
        error={errors.yearsExperience?.message}
        {...register('yearsExperience')}
      />
    </StepFrame>
  )
}
