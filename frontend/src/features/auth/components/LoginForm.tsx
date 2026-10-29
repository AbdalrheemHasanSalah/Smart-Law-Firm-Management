import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, ArrowRight, Mail } from 'lucide-react'
import { motion } from 'motion/react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { fadeUp, staggerContainer } from '@/components/motion/presets'
import { Alert } from '@/components/shared/Alert'
import { FormField } from '@/components/shared/FormField'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useLanguage } from '@/hooks/use-language'
import { env } from '@/lib/env'
import { DEMO_ACCOUNT_EMAIL, MOCK_PASSWORD } from '@/mocks/data/users'
import { ROUTES } from '@/app/router/routes'
import { useAuth } from '../auth-context'
import { useLogin } from '../hooks/use-login'
import { postLoginPath } from '../session-routing'
import { loginSchema, type LoginFormValues } from '../schemas/login.schema'
import { DemoCredentials } from './DemoCredentials'
import { PasswordInput } from './PasswordInput'

const DEFAULT_VALUES: LoginFormValues = { email: '', password: '', remember: false }

export const LoginForm = () => {
  const { t } = useTranslation('auth')
  const { t: tc } = useTranslation('common')
  const { direction } = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const { sessionExpired } = useAuth()
  const login = useLogin({
    onSuccess: (session) => {
      if (session) toast.success(t('login.success', { name: session.user.full_name }))
      void navigate(postLoginPath(location.state, session), { replace: true })
    },
  })

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: DEFAULT_VALUES,
    mode: 'onTouched',
  })

  const clearServerError = () => {
    if (login.isError) login.reset()
  }

  const onSubmit = handleSubmit((values) => login.mutate(values))

  const fillDemo = () => {
    clearServerError()
    setValue('email', DEMO_ACCOUNT_EMAIL, { shouldValidate: true, shouldDirty: true })
    setValue('password', MOCK_PASSWORD, { shouldValidate: true, shouldDirty: true })
  }

  const ForwardArrow = direction === 'rtl' ? ArrowLeft : ArrowRight
  const describedBy = (field: keyof LoginFormValues) =>
    errors[field] ? `${field}-error` : undefined

  return (
    <motion.div variants={staggerContainer(0.06, 0.15)} initial="hidden" animate="visible">
      <motion.p
        variants={fadeUp}
        className="mb-3 flex items-center gap-3 text-xs font-semibold tracking-[0.18em] text-accent uppercase"
      >
        <span aria-hidden="true" className="h-px w-8 bg-gold" />
        {t('login.eyebrow')}
      </motion.p>
      <motion.h1
        variants={fadeUp}
        className="font-display text-[2.1rem] leading-tight font-bold sm:text-[2.5rem]"
      >
        {t('login.title')}
      </motion.h1>
      <motion.p variants={fadeUp} className="mt-3 leading-relaxed text-muted-foreground">
        {t('login.subtitle')}
      </motion.p>

      {env.useMocks && (
        <motion.div variants={fadeUp} className="mt-7">
          <DemoCredentials onFill={fillDemo} />
        </motion.div>
      )}

      <form
        noValidate
        onSubmit={onSubmit}
        onChange={clearServerError}
        className="mt-7 space-y-5"
        aria-busy={login.isPending}
      >
        {login.isError && (
          <Alert tone="error" title={t('login.errorTitle')}>
            {tc(`errors.${login.error.code}`)}
          </Alert>
        )}
        {!login.isError && sessionExpired && (
          <Alert tone="info" title={t('login.expiredTitle')}>
            {tc('errors.UNAUTHORIZED')}
          </Alert>
        )}

        <motion.div variants={fadeUp}>
          <FormField id="email" label={t('login.email')} error={errors.email?.message}>
            <div className="group relative">
              <Mail
                aria-hidden="true"
                className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-accent"
              />
              <Input
                id="email"
                type="email"
                dir="ltr"
                autoComplete="username"
                inputMode="email"
                placeholder={t('login.emailPlaceholder')}
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={describedBy('email')}
                className="px-11"
                {...register('email')}
              />
            </div>
          </FormField>
        </motion.div>

        <motion.div variants={fadeUp}>
          <FormField
            id="password"
            label={t('login.password')}
            error={errors.password?.message}
            labelAside={
              <Link
                to={ROUTES.forgotPassword}
                className="text-sm font-medium text-accent underline-offset-4 transition-colors hover:underline"
              >
                {t('login.forgot')}
              </Link>
            }
          >
            <PasswordInput
              id="password"
              autoComplete="current-password"
              placeholder={t('login.passwordPlaceholder')}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={describedBy('password')}
              {...register('password')}
            />
          </FormField>
        </motion.div>

        <motion.div variants={fadeUp} className="flex items-center gap-2.5">
          <Controller
            control={control}
            name="remember"
            render={({ field }) => (
              <Checkbox
                id="remember"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                onBlur={field.onBlur}
                ref={field.ref}
              />
            )}
          />
          <Label htmlFor="remember" className="cursor-pointer font-normal text-foreground/80">
            {t('login.remember')}
          </Label>
        </motion.div>

        <motion.div variants={fadeUp} className="pt-1">
          <Button
            type="submit"
            size="lg"
            className="group w-full"
            loading={login.isPending}
            loadingText={t('login.submitting')}
          >
            {t('login.submit')}
            <ForwardArrow
              aria-hidden="true"
              className="size-4 transition-transform duration-300 ease-elegant ltr:group-hover:translate-x-1 rtl:group-hover:-translate-x-1"
            />
          </Button>
        </motion.div>
      </form>

      <motion.div
        variants={fadeUp}
        className="mt-8 flex items-center gap-4 text-sm text-muted-foreground"
      >
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span>
          {t('login.noAccount')}{' '}
          <Link
            to={ROUTES.register}
            className="font-semibold text-accent underline-offset-4 hover:underline"
          >
            {t('login.register')}
          </Link>
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </motion.div>
    </motion.div>
  )
}
