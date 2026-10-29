import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { BadgeCheck, Building2, Mail, MailWarning, UserRound } from 'lucide-react'
import { motion } from 'motion/react'
import { useForm, useWatch, type FieldErrors, type UseFormRegister } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { ROUTES, invitationPath } from '@/app/router/routes'
import { fadeUp, staggerContainer } from '@/components/motion/presets'
import { Alert } from '@/components/shared/Alert'
import { FormField } from '@/components/shared/FormField'
import { TextField } from '@/components/shared/TextField'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useDocumentTitle } from '@/hooks/use-document-title'
import type { ApiError } from '@/services/api/api-error'
import { queryKeys } from '@/services/api/query-keys'
import { authService, onboardingService } from '../api'
import { useAuth } from '../auth-context'
import { AuthHeading } from '../components/AuthHeading'
import { AuthLayout } from '../components/AuthLayout'
import { PasswordInput } from '../components/PasswordInput'
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter'
import {
  acceptLawyerSchema,
  toAcceptInput,
  type AcceptLawyerValues,
} from '../schemas/invitation.schema'
import {
  accountSchema,
  emptyAccount,
  emptyLawyer,
  type AccountValues,
} from '../schemas/register.schema'
import type { InvitationPreview } from '../types'

type AcceptVariables = { account: AccountValues | null; lawyer: AcceptLawyerValues | null }

const useAcceptInvitation = (token: string) => {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  return useMutation({
    onSuccess: () => void navigate(ROUTES.dashboard, { replace: true }),
    mutationFn: async ({ account, lawyer }: AcceptVariables) => {
      if (account) {
        await authService.signUp({
          name: account.fullName.trim(),
          email: account.email.trim(),
          password: account.password,
        })
        await refresh()
      }
      await onboardingService.acceptInvitation(token, toAcceptInput(lawyer))
      await refresh()
    },
  })
}

const InvitationSummary = ({ invitation }: { invitation: InvitationPreview }) => {
  const { t } = useTranslation('auth')
  return (
    <motion.div
      variants={fadeUp}
      className="mt-6 flex gap-4 rounded-2xl border border-border bg-surface p-5 shadow-soft"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
        <Building2 className="size-5" aria-hidden="true" />
      </span>
      <dl className="grid min-w-0 gap-1 text-sm">
        <dt className="sr-only">{t('invite.office')}</dt>
        <dd className="font-display text-lg font-bold text-heading">{invitation.office_name}</dd>
        <dt className="sr-only">{t('invite.role')}</dt>
        <dd className="text-muted-foreground">
          {t('invite.asRole', { role: t(`roles.${invitation.role}`) })}
        </dd>
        <dt className="sr-only">{t('invite.sentTo')}</dt>
        <dd className="text-muted-foreground" dir="ltr">
          <span className="inline-flex items-center gap-1.5">
            <Mail className="size-3.5" aria-hidden="true" />
            {invitation.email_hint}
          </span>
        </dd>
      </dl>
    </motion.div>
  )
}

type LawyerDetailsProps = {
  register: UseFormRegister<AcceptLawyerValues>
  errors: FieldErrors<AcceptLawyerValues>
}

const LawyerDetails = ({ register, errors }: LawyerDetailsProps) => {
  const { t } = useTranslation('auth')
  const optional = t('register.optional')
  return (
    <fieldset className="space-y-4 rounded-xl border border-border p-4">
      <legend className="px-1 text-sm font-semibold text-heading">
        {t('invite.lawyerDetails')}
      </legend>
      <TextField
        id="inviteBar"
        dir="ltr"
        label={t('register.fields.barNumber')}
        optionalLabel={optional}
        icon={BadgeCheck}
        error={errors.barNumber?.message}
        {...register('barNumber')}
      />
      <TextField
        id="inviteSpecialty"
        label={t('register.fields.specialty')}
        optionalLabel={optional}
        error={errors.specialty?.message}
        {...register('specialty')}
      />
      <TextField
        id="inviteYears"
        type="number"
        dir="ltr"
        min={0}
        max={70}
        inputMode="numeric"
        label={t('register.fields.yearsExperience')}
        optionalLabel={optional}
        error={errors.yearsExperience?.message}
        {...register('yearsExperience')}
      />
    </fieldset>
  )
}

/** Signed-in path: confirm and join. */
type InvitationFormProps = {
  invitation: InvitationPreview
  accept: ReturnType<typeof useAcceptInvitation>
}

const AcceptForm = ({ invitation, accept }: InvitationFormProps) => {
  const { t } = useTranslation('auth')
  const { t: tc } = useTranslation('common')
  const { session, signOut } = useAuth()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AcceptLawyerValues>({
    resolver: zodResolver(acceptLawyerSchema),
    defaultValues: emptyLawyer,
  })

  const onSubmit = handleSubmit((lawyer) =>
    accept.mutate({ account: null, lawyer: invitation.role === 'lawyer' ? lawyer : null }),
  )

  return (
    <motion.form variants={fadeUp} noValidate onSubmit={onSubmit} className="mt-6 space-y-5">
      <p className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
        {t('register.signedInAs', { email: session?.user.email ?? '' })}
      </p>
      {accept.isError && (
        <Alert tone="error" title={t('invite.errorTitle')}>
          <p>{tc(`errors.${accept.error.code}`)}</p>
          {accept.error.code === 'INVITATION_EMAIL_MISMATCH' && (
            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-1 font-semibold text-accent underline-offset-4 hover:underline"
            >
              {t('invite.useOtherAccount')}
            </button>
          )}
        </Alert>
      )}
      {invitation.role === 'lawyer' && <LawyerDetails register={register} errors={errors} />}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={accept.isPending}
        loadingText={t('invite.joining')}
      >
        {t('invite.accept', { office: invitation.office_name })}
      </Button>
    </motion.form>
  )
}

/** Signed-out path: create the account with the invited address, then join. */
const SignUpAndAcceptForm = ({
  token,
  invitation,
  accept,
}: InvitationFormProps & { token: string }) => {
  const { t } = useTranslation('auth')
  const { t: tc } = useTranslation('common')
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<AccountValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: emptyAccount,
    mode: 'onTouched',
  })
  const password = useWatch({ control, name: 'password' })

  const onSubmit = handleSubmit((account) => accept.mutate({ account, lawyer: null }))

  return (
    <motion.form
      variants={fadeUp}
      noValidate
      onSubmit={onSubmit}
      className="mt-6 space-y-5"
      aria-busy={accept.isPending}
    >
      {accept.isError && (
        <Alert tone="error" title={t('invite.errorTitle')}>
          {tc(`errors.${accept.error.code}`)}
        </Alert>
      )}
      <TextField
        id="inviteName"
        label={t('register.fields.fullName')}
        autoComplete="name"
        icon={UserRound}
        error={errors.fullName?.message}
        {...register('fullName')}
      />
      <TextField
        id="inviteEmail"
        type="email"
        dir="ltr"
        inputMode="email"
        autoComplete="email"
        label={t('register.fields.email')}
        hint={t('invite.useInvitedEmail', { hint: invitation.email_hint })}
        icon={Mail}
        error={errors.email?.message}
        {...register('email')}
      />
      <FormField
        id="invitePassword"
        label={t('register.fields.password')}
        error={errors.password?.message}
      >
        <PasswordInput
          id="invitePassword"
          autoComplete="new-password"
          aria-invalid={errors.password ? true : undefined}
          aria-describedby="invitePassword-strength"
          {...register('password')}
        />
        <PasswordStrengthMeter id="invitePassword-strength" password={password} />
      </FormField>
      <FormField
        id="inviteConfirm"
        label={t('register.fields.confirmPassword')}
        error={errors.confirmPassword?.message}
      >
        <PasswordInput
          id="inviteConfirm"
          autoComplete="new-password"
          aria-invalid={errors.confirmPassword ? true : undefined}
          {...register('confirmPassword')}
        />
      </FormField>
      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={accept.isPending}
        loadingText={t('invite.joining')}
      >
        {t('invite.createAndJoin')}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {t('invite.haveAccount')}{' '}
        <Link
          to={ROUTES.login}
          state={{ from: invitationPath(token) }}
          className="font-semibold text-accent underline-offset-4 hover:underline"
        >
          {t('invite.signInToAccept')}
        </Link>
      </p>
    </motion.form>
  )
}

const InvitationPage = () => {
  const { t } = useTranslation('auth')
  const { token = '' } = useParams()
  const { status, session } = useAuth()
  useDocumentTitle(t('invite.metaTitle'))
  const accept = useAcceptInvitation(token)
  // Keep the sign-up form in place while the account it just created finishes joining.
  const showSignUp = !session || (accept.isPending && accept.variables.account !== null)
  const preview = useQuery<InvitationPreview, ApiError>({
    queryKey: queryKeys.invitations.preview(token),
    queryFn: () => onboardingService.previewInvitation(token),
    retry: false,
  })

  const invitation = preview.data
  const unusable =
    preview.isError || (invitation && (invitation.state !== 'pending' || !invitation.office_active))
  const unusableKey = preview.isError
    ? 'invalid'
    : invitation && !invitation.office_active
      ? 'officeInactive'
      : (invitation?.state ?? 'invalid')

  return (
    <AuthLayout footer={t('footer.rights', { year: new Date().getFullYear() })}>
      <motion.div variants={staggerContainer(0.06, 0.1)} initial="hidden" animate="visible">
        <AuthHeading
          eyebrow={t('invite.eyebrow')}
          title={t('invite.title')}
          subtitle={t('invite.subtitle')}
        />
        {(preview.isPending || status === 'loading') && (
          <div className="mt-10 grid place-items-center text-muted-foreground" role="status">
            <Spinner className="size-6" />
            <span className="sr-only">{t('invite.loading')}</span>
          </div>
        )}
        {unusable && !preview.isPending && (
          <motion.div variants={fadeUp} className="mt-6">
            <Alert tone="error" title={t(`invite.unusable.${unusableKey}.title`)}>
              <p>{t(`invite.unusable.${unusableKey}.body`)}</p>
            </Alert>
            <Button asChild variant="outline" className="mt-6 w-full">
              <Link to={session ? ROUTES.onboarding : ROUTES.login}>
                <MailWarning className="size-4" aria-hidden="true" />
                {t('invite.unusable.back')}
              </Link>
            </Button>
          </motion.div>
        )}
        {invitation && !unusable && status !== 'loading' && (
          <>
            <InvitationSummary invitation={invitation} />
            {showSignUp ? (
              <SignUpAndAcceptForm token={token} invitation={invitation} accept={accept} />
            ) : (
              <AcceptForm invitation={invitation} accept={accept} />
            )}
          </>
        )}
      </motion.div>
    </AuthLayout>
  )
}

export default InvitationPage
