import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { ROUTES } from '@/app/router/routes'
import { fadeUp, staggerContainer } from '@/components/motion/presets'
import { Alert } from '@/components/shared/Alert'
import { FormField } from '@/components/shared/FormField'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { i18nMessage } from '@/lib/i18n-message'
import { authService } from '../api'
import { AuthHeading } from '../components/AuthHeading'
import { AuthLayout } from '../components/AuthLayout'
import { PasswordInput } from '../components/PasswordInput'
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter'
import { passwordSchema, withPasswordConfirmation } from '../schemas/register.schema'

const resetSchema = withPasswordConfirmation(
  z.object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, i18nMessage('validation:required')),
  }),
)
type ResetValues = z.infer<typeof resetSchema>

/**
 * Better Auth redirects the emailed link here with `?token=…`, or `?error=INVALID_TOKEN` when
 * the link is expired or already used. Every other session of the account is signed out on reset.
 */
const ResetPasswordPage = () => {
  const { t } = useTranslation('auth')
  const { t: tc } = useTranslation('common')
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token')
  const linkInvalid = !token || params.get('error') !== null
  useDocumentTitle(t('reset.metaTitle'))

  const reset = useMutation({
    mutationFn: ({ password }: ResetValues) => authService.resetPassword(token ?? '', password),
    onSuccess: () => {
      toast.success(t('reset.success'))
      void navigate(ROUTES.login, { replace: true })
    },
  })
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', confirmPassword: '' },
    mode: 'onTouched',
  })
  const password = useWatch({ control, name: 'password' })
  const tokenRejected = reset.error?.code === 'RESET_TOKEN_INVALID'

  return (
    <AuthLayout footer={t('footer.rights', { year: new Date().getFullYear() })}>
      <motion.div variants={staggerContainer(0.06, 0.15)} initial="hidden" animate="visible">
        <AuthHeading
          eyebrow={t('reset.eyebrow')}
          title={t('reset.title')}
          subtitle={t('reset.subtitle')}
        />
        {linkInvalid || tokenRejected ? (
          <motion.div variants={fadeUp} className="mt-7 space-y-6">
            <Alert tone="error" title={t('reset.invalidTitle')}>
              {tc('errors.RESET_TOKEN_INVALID')}
            </Alert>
            <Button asChild size="lg" className="w-full">
              <Link to={ROUTES.forgotPassword}>{t('reset.requestNew')}</Link>
            </Button>
          </motion.div>
        ) : (
          <motion.form
            variants={fadeUp}
            noValidate
            onSubmit={handleSubmit((values) => reset.mutate(values))}
            className="mt-7 space-y-5"
            aria-busy={reset.isPending}
          >
            {reset.isError && (
              <Alert tone="error" title={t('reset.errorTitle')}>
                {tc(`errors.${reset.error.code}`)}
              </Alert>
            )}
            <FormField
              id="newPassword"
              label={t('reset.newPassword')}
              error={errors.password?.message}
            >
              <PasswordInput
                id="newPassword"
                autoComplete="new-password"
                aria-invalid={errors.password ? true : undefined}
                aria-describedby="newPassword-strength"
                {...register('password')}
              />
              <PasswordStrengthMeter id="newPassword-strength" password={password} />
            </FormField>
            <FormField
              id="confirmNewPassword"
              label={t('register.fields.confirmPassword')}
              error={errors.confirmPassword?.message}
            >
              <PasswordInput
                id="confirmNewPassword"
                autoComplete="new-password"
                aria-invalid={errors.confirmPassword ? true : undefined}
                {...register('confirmPassword')}
              />
            </FormField>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={reset.isPending}
              loadingText={t('reset.saving')}
            >
              {t('reset.submit')}
            </Button>
          </motion.form>
        )}
      </motion.div>
    </AuthLayout>
  )
}

export default ResetPasswordPage
