import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Mail, MailCheck } from 'lucide-react'
import { motion } from 'motion/react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { z } from 'zod'
import { ROUTES } from '@/app/router/routes'
import { fadeUp, staggerContainer } from '@/components/motion/presets'
import { Alert } from '@/components/shared/Alert'
import { TextField } from '@/components/shared/TextField'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { authService } from '../api'
import { AuthHeading } from '../components/AuthHeading'
import { AuthLayout } from '../components/AuthLayout'
import { loginSchema } from '../schemas/login.schema'

const forgotSchema = z.object({ email: loginSchema.shape.email })
type ForgotValues = z.infer<typeof forgotSchema>

/**
 * Requests a reset link. The answer is identical whether or not the address has an account,
 * so the form cannot be used to discover who is registered.
 */
const ForgotPasswordPage = () => {
  const { t } = useTranslation('auth')
  const { t: tc } = useTranslation('common')
  useDocumentTitle(t('forgot.metaTitle'))
  const request = useMutation({
    mutationFn: ({ email }: ForgotValues) =>
      authService.requestPasswordReset(email, `${window.location.origin}${ROUTES.resetPassword}`),
  })
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
    mode: 'onTouched',
  })

  return (
    <AuthLayout footer={t('footer.rights', { year: new Date().getFullYear() })}>
      <motion.div variants={staggerContainer(0.06, 0.15)} initial="hidden" animate="visible">
        <AuthHeading
          eyebrow={t('forgot.eyebrow')}
          title={t('forgot.title')}
          subtitle={t('forgot.subtitle')}
        />
        {request.isSuccess ? (
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="mt-7 space-y-6"
          >
            <div
              className="flex gap-3 rounded-xl border border-success/30 bg-success-soft p-4 text-sm"
              role="status"
            >
              <MailCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-semibold text-success">{t('forgot.sentTitle')}</p>
                <p className="text-foreground/80">
                  {t('forgot.sentBody', { email: request.variables.email })}
                </p>
              </div>
            </div>
            <Button asChild variant="outline" size="lg" className="w-full">
              <Link to={ROUTES.login}>{tc('actions.backToLogin')}</Link>
            </Button>
          </motion.div>
        ) : (
          <motion.form
            variants={fadeUp}
            noValidate
            onSubmit={handleSubmit((values) => request.mutate(values))}
            className="mt-7 space-y-5"
            aria-busy={request.isPending}
          >
            {request.isError && (
              <Alert tone="error" title={t('forgot.errorTitle')}>
                {tc(`errors.${request.error.code}`)}
              </Alert>
            )}
            <TextField
              id="email"
              type="email"
              dir="ltr"
              inputMode="email"
              autoComplete="email"
              label={t('login.email')}
              placeholder={t('login.emailPlaceholder')}
              icon={Mail}
              error={errors.email?.message}
              {...register('email')}
            />
            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={request.isPending}
              loadingText={t('forgot.sending')}
            >
              {t('forgot.submit')}
            </Button>
            <p className="text-center text-sm">
              <Link
                to={ROUTES.login}
                className="font-semibold text-accent underline-offset-4 hover:underline"
              >
                {tc('actions.backToLogin')}
              </Link>
            </p>
          </motion.form>
        )}
      </motion.div>
    </AuthLayout>
  )
}

export default ForgotPasswordPage
