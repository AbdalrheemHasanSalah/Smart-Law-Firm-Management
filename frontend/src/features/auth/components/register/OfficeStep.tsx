import { zodResolver } from '@hookform/resolvers/zod'
import { Building2, FileBadge, Mail, MapPin, Phone } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { TextField } from '@/components/shared/TextField'
import { officeSchema, type OfficeValues } from '../../schemas/register.schema'
import { StepFrame } from './StepFrame'

type OfficeStepProps = {
  defaultValues: OfficeValues
  onNext: (values: OfficeValues) => void
  onBack?: () => void
}

export const OfficeStep = ({ defaultValues, onNext, onBack }: OfficeStepProps) => {
  const { t } = useTranslation('auth')
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OfficeValues>({
    resolver: zodResolver(officeSchema),
    defaultValues,
    mode: 'onTouched',
  })
  const optional = t('register.optional')

  return (
    <StepFrame step="office" onSubmit={handleSubmit(onNext)} onBack={onBack}>
      <TextField
        id="officeName"
        label={t('register.fields.officeName')}
        placeholder={t('register.placeholders.officeName')}
        autoComplete="organization"
        icon={Building2}
        error={errors.name?.message}
        {...register('name')}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          id="officePhone"
          type="tel"
          dir="ltr"
          inputMode="tel"
          label={t('register.fields.phone')}
          placeholder="+970 59 000 0000"
          autoComplete="tel"
          icon={Phone}
          error={errors.phone?.message}
          {...register('phone')}
        />
        <TextField
          id="officeCity"
          label={t('register.fields.city')}
          placeholder={t('register.placeholders.city')}
          autoComplete="address-level2"
          icon={MapPin}
          error={errors.city?.message}
          {...register('city')}
        />
      </div>
      <TextField
        id="officeEmail"
        type="email"
        dir="ltr"
        inputMode="email"
        label={t('register.fields.officeEmail')}
        optionalLabel={optional}
        placeholder="info@office.ps"
        icon={Mail}
        error={errors.email?.message}
        {...register('email')}
      />
      <TextField
        id="officeAddress"
        label={t('register.fields.address')}
        optionalLabel={optional}
        placeholder={t('register.placeholders.address')}
        autoComplete="street-address"
        error={errors.address?.message}
        {...register('address')}
      />
      <TextField
        id="licenseNumber"
        dir="ltr"
        label={t('register.fields.licenseNumber')}
        optionalLabel={optional}
        hint={t('register.hints.licenseNumber')}
        icon={FileBadge}
        error={errors.licenseNumber?.message}
        {...register('licenseNumber')}
      />
    </StepFrame>
  )
}
