import { ArrowLeftRight, Building2, LogOut, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { navigationFor } from '@/app/navigation/role-navigation'
import { ROUTES } from '@/app/router/routes'
import { CenteredMessage } from '@/components/layout/CenteredMessage'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-context'
import { isUsableMembership } from '@/features/auth/session-routing'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { env } from '@/lib/env'

/** Temporary post-login landing until the dashboard is built in Phase 4. */
const SignedInPage = () => {
  const { t } = useTranslation()
  const { t: ta } = useTranslation('auth')
  const { session, signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  useDocumentTitle(`${t('signedIn.title')} — ${t('brand.name')}`)

  const handleSignOut = async () => {
    setSigningOut(true)
    if (!(await signOut())) setSigningOut(false)
  }

  const office = session?.active_office
  const sections = navigationFor(session?.role ?? null)
  const otherOffices = (session?.memberships ?? []).filter(
    (membership) => isUsableMembership(membership) && membership.office_id !== office?.office_id,
  )

  return (
    <CenteredMessage
      title={t('signedIn.title')}
      description={t('signedIn.description', { name: session?.user.full_name ?? '' })}
    >
      {office && session?.role && (
        <div className="w-full space-y-4">
          <p className="inline-flex items-center gap-2 text-sm text-heading">
            <Building2 className="size-4 text-accent" aria-hidden="true" />
            {t('signedIn.office', { office: office.office_name })} ·{' '}
            {office.is_owner ? ta('roles.owner') : ta(`roles.${session.role}`)}
          </p>
          <div>
            <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              {t('signedIn.sections')}
            </p>
            <ul className="flex flex-wrap justify-center gap-2">
              {sections.map((section) => (
                <li
                  key={section}
                  className="rounded-full border border-border bg-surface-muted px-3 py-1 text-xs text-foreground/80"
                >
                  {t(`navigation.${section}`)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {session?.user.is_platform_admin && (
        <p className="inline-flex items-center gap-2 text-xs text-accent">
          <ShieldCheck className="size-4" aria-hidden="true" />
          {t('signedIn.platformAdmin')}
        </p>
      )}
      {env.useMocks && <p className="text-xs text-muted-foreground">{t('signedIn.mockNote')}</p>}
      <div className="flex flex-wrap justify-center gap-3">
        {otherOffices.length > 0 && (
          <Button asChild variant="outline">
            <Link to={ROUTES.selectOffice}>
              <ArrowLeftRight className="size-4" aria-hidden="true" />
              {t('signedIn.switchOffice')}
            </Link>
          </Button>
        )}
        <Button variant="outline" onClick={() => void handleSignOut()} loading={signingOut}>
          <LogOut className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          {t('actions.signOut')}
        </Button>
      </div>
    </CenteredMessage>
  )
}

export default SignedInPage
