import { zodResolver } from '@hookform/resolvers/zod'
import { Mail, UserRound } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/shared/FormField'
import { TextField } from '@/components/shared/TextField'
import { accountSchema, type AccountValues } from '../../schemas/register.schema'
import { PasswordInput } from '../PasswordInput'
import { PasswordStrengthMeter } from '../PasswordStrengthMeter'
import { StepFrame } from './StepFrame'

type AccountStepProps = {
  defaultValues: AccountValues
  onNext: (values: AccountValues) => void
}

export const AccountStep = ({ defaultValues, onNext }: AccountStepProps) => {
  const { t } = useTranslation('auth')
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<AccountValues>({
    resolver: zodResolver(accountSchema),
    defaultValues,
    mode: 'onTouched',
  })
  const password = useWatch({ control, name: 'password' })

  return (
    <StepFrame step="account" onSubmit={handleSubmit(onNext)}>
      <TextField
        id="fullName"
        label={t('register.fields.fullName')}
        placeholder={t('register.placeholders.fullName')}
        autoComplete="name"
        icon={UserRound}
        error={errors.fullName?.message}
        {...register('fullName')}
      />
      <TextField
        id="email"
        type="email"
        dir="ltr"
        inputMode="email"
        label={t('register.fields.email')}
        placeholder={t('login.emailPlaceholder')}
        autoComplete="email"
        icon={Mail}
        error={errors.email?.message}
        {...register('email')}
      />
      <FormField
        id="password"
        label={t('register.fields.password')}
        error={errors.password?.message}
      >
        <PasswordInput
          id="password"
          autoComplete="new-password"
          placeholder={t('login.passwordPlaceholder')}
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={
            errors.password ? 'password-error password-strength' : 'password-strength'
          }
          {...register('password')}
        />
        <PasswordStrengthMeter id="password-strength" password={password} />
      </FormField>
      <FormField
        id="confirmPassword"
        label={t('register.fields.confirmPassword')}
        error={errors.confirmPassword?.message}
      >
        <PasswordInput
          id="confirmPassword"
          autoComplete="new-password"
          placeholder={t('login.passwordPlaceholder')}
          aria-invalid={errors.confirmPassword ? true : undefined}
          aria-describedby={errors.confirmPassword ? 'confirmPassword-error' : undefined}
          {...register('confirmPassword')}
        />
      </FormField>
    </StepFrame>
  )
}
