import { useMutation } from '@tanstack/react-query'
import { Building2, ChevronLeft, ChevronRight, MapPin } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ROUTES } from '@/app/router/routes'
import { fadeUp, staggerContainer } from '@/components/motion/presets'
import { Alert } from '@/components/shared/Alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useLanguage } from '@/hooks/use-language'
import { cn } from '@/lib/utils'
import { authService } from '../api'
import { useAuth } from '../auth-context'
import { AuthHeading } from '../components/AuthHeading'
import { AuthLayout } from '../components/AuthLayout'
import { AccessBadge, RoleBadge } from '../components/StatusBadge'
import { isUsableMembership } from '../session-routing'

/** Lets a member of several offices choose one; the server re-checks the membership. */
const SelectOfficePage = () => {
  const { t } = useTranslation('auth')
  const { t: tc } = useTranslation('common')
  const { direction } = useLanguage()
  const { session, refresh, signOut } = useAuth()
  const navigate = useNavigate()
  useDocumentTitle(t('selectOffice.metaTitle'))
  const Chevron = direction === 'rtl' ? ChevronLeft : ChevronRight

  const select = useMutation({
    mutationFn: async (officeId: string) => {
      await authService.selectOffice(officeId)
      await refresh()
    },
    onSuccess: () => void navigate(ROUTES.dashboard, { replace: true }),
  })

  const memberships = session?.memberships ?? []

  return (
    <AuthLayout footer={t('footer.rights', { year: new Date().getFullYear() })}>
      <motion.div variants={staggerContainer(0.06, 0.15)} initial="hidden" animate="visible">
        <AuthHeading
          eyebrow={t('selectOffice.eyebrow', { name: session?.user.full_name ?? '' })}
          title={t('selectOffice.title')}
          subtitle={t('selectOffice.subtitle')}
        />
        {select.isError && (
          <motion.div variants={fadeUp} className="mt-6">
            <Alert tone="error" title={t('selectOffice.errorTitle')}>
              {tc(`errors.${select.error.code}`)}
            </Alert>
          </motion.div>
        )}
        <motion.ul
          variants={fadeUp}
          className="mt-7 space-y-3"
          aria-label={t('selectOffice.listLabel')}
        >
          {memberships.map((membership) => {
            const usable = isUsableMembership(membership)
            const pending = select.isPending && select.variables === membership.office_id
            return (
              <li key={membership.office_id}>
                <button
                  type="button"
                  disabled={!usable || select.isPending}
                  onClick={() => select.mutate(membership.office_id)}
                  className={cn(
                    'group flex w-full items-center gap-4 rounded-2xl border border-border bg-surface p-4 text-start shadow-soft',
                    'transition-[border-color,box-shadow,transform] duration-300 ease-elegant',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    usable
                      ? 'hover:border-gold hover:shadow-gold motion-safe:hover:-translate-y-0.5'
                      : 'cursor-not-allowed opacity-70',
                  )}
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                    <Building2 className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-heading">
                      {membership.office_name}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {membership.office_city && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" aria-hidden="true" />
                          {membership.office_city}
                        </span>
                      )}
                      <RoleBadge membership={membership} />
                      <AccessBadge membership={membership} />
                    </span>
                  </span>
                  {pending ? (
                    <Spinner />
                  ) : (
                    usable && (
                      <Chevron
                        aria-hidden="true"
                        className="size-5 text-muted-foreground transition-transform duration-300 ease-elegant group-hover:text-accent ltr:group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5"
                      />
                    )
                  )}
                </button>
              </li>
            )
          })}
        </motion.ul>
        <motion.div variants={fadeUp} className="mt-8 text-center">
          <Button variant="ghost" onClick={() => void signOut()}>
            {tc('actions.signOut')}
          </Button>
        </motion.div>
      </motion.div>
    </AuthLayout>
  )
}

export default SelectOfficePage
