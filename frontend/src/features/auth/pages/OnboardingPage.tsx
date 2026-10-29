import { useMutation } from '@tanstack/react-query'
import { Building2, Hourglass, Link2, RefreshCw, ShieldAlert } from 'lucide-react'
import { motion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router'
import { ROUTES } from '@/app/router/routes'
import { PageLoader } from '@/components/layout/PageLoader'
import { fadeUp, staggerContainer } from '@/components/motion/presets'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useAuth } from '../auth-context'
import { AuthHeading } from '../components/AuthHeading'
import { AuthLayout } from '../components/AuthLayout'
import { AccessBadge, RoleBadge } from '../components/StatusBadge'
import { destinationFor } from '../session-routing'
import type { Membership } from '../types'

const Card = ({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: ReactNode
}) => (
  <motion.section
    variants={fadeUp}
    className="rounded-2xl border border-border bg-surface p-5 shadow-soft"
  >
    <div className="flex gap-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <h2 className="font-semibold text-heading">{title}</h2>
        {children}
      </div>
    </div>
  </motion.section>
)

const MembershipRow = ({ membership }: { membership: Membership }) => (
  <li className="flex flex-wrap items-center gap-2 text-sm">
    <span className="font-medium text-foreground">{membership.office_name}</span>
    <RoleBadge membership={membership} />
    <AccessBadge membership={membership} />
  </li>
)

/**
 * For a signed-in account with no office it can enter yet: explains a pending, rejected or
 * suspended office, or offers the two legitimate ways in — register an office or be invited.
 */
const OnboardingPage = () => {
  const { t } = useTranslation('auth')
  const { t: tc } = useTranslation('common')
  const { status, session, refresh, signOut } = useAuth()
  useDocumentTitle(t('onboarding.metaTitle'))
  const recheck = useMutation({ mutationFn: refresh })

  if (status === 'loading') return <PageLoader />
  if (!session) return <Navigate to={ROUTES.login} replace />
  const destination = destinationFor(session)
  if (destination !== ROUTES.onboarding) return <Navigate to={destination} replace />

  const pendingOwned = session.memberships.filter(
    (membership) => membership.is_owner && membership.office_status === 'pending',
  )
  const blocked = session.memberships.filter((membership) => !pendingOwned.includes(membership))
  const canRegister = pendingOwned.length === 0

  return (
    <AuthLayout footer={t('footer.rights', { year: new Date().getFullYear() })}>
      <motion.div
        variants={staggerContainer(0.07, 0.15)}
        initial="hidden"
        animate="visible"
        className="space-y-4"
      >
        <AuthHeading
          eyebrow={t('onboarding.eyebrow', { name: session.user.full_name })}
          title={pendingOwned.length ? t('onboarding.pendingTitle') : t('onboarding.title')}
          subtitle={
            pendingOwned.length ? t('onboarding.pendingSubtitle') : t('onboarding.subtitle')
          }
        />

        {pendingOwned.length > 0 && (
          <Card icon={Hourglass} title={t('onboarding.underReview')}>
            <ul className="space-y-1.5">
              {pendingOwned.map((membership) => (
                <MembershipRow key={membership.office_id} membership={membership} />
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">{t('onboarding.underReviewBody')}</p>
            <Button
              variant="outline"
              size="sm"
              loading={recheck.isPending}
              loadingText={t('onboarding.checking')}
              onClick={() => recheck.mutate()}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {t('onboarding.checkStatus')}
            </Button>
          </Card>
        )}

        {blocked.length > 0 && (
          <Card icon={ShieldAlert} title={t('onboarding.blockedTitle')}>
            <ul className="space-y-1.5">
              {blocked.map((membership) => (
                <MembershipRow key={membership.office_id} membership={membership} />
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">{t('onboarding.blockedBody')}</p>
          </Card>
        )}

        {canRegister && (
          <Card icon={Building2} title={t('onboarding.registerTitle')}>
            <p className="text-sm text-muted-foreground">{t('onboarding.registerBody')}</p>
            <Button asChild size="sm">
              <Link to={ROUTES.register}>{t('onboarding.registerAction')}</Link>
            </Button>
          </Card>
        )}

        <Card icon={Link2} title={t('onboarding.inviteTitle')}>
          <p className="text-sm text-muted-foreground">{t('onboarding.inviteBody')}</p>
        </Card>

        <motion.div variants={fadeUp} className="pt-2 text-center">
          <Button variant="ghost" onClick={() => void signOut()}>
            {tc('actions.signOut')}
          </Button>
        </motion.div>
      </motion.div>
    </AuthLayout>
  )
}

export default OnboardingPage
