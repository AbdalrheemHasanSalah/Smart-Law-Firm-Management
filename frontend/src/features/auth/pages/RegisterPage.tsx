import { motion } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router'
import { ROUTES } from '@/app/router/routes'
import { PageLoader } from '@/components/layout/PageLoader'
import { fadeUp, staggerContainer } from '@/components/motion/presets'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useAuth } from '../auth-context'
import { AuthHeading } from '../components/AuthHeading'
import { AuthLayout } from '../components/AuthLayout'
import { RegisterSuccess } from '../components/register/RegisterSuccess'
import { RegisterWizard } from '../components/register/RegisterWizard'
import type { RegisteredOffice } from '../types'

/**
 * Public registration of a new law office by its owner. Staff and clients never register here:
 * they join an existing office through an invitation link from its administrator.
 */
const RegisterPage = () => {
  const { t } = useTranslation('auth')
  const { status, session } = useAuth()
  const [registered, setRegistered] = useState<RegisteredOffice | null>(null)
  useDocumentTitle(t('register.metaTitle'))

  if (status === 'loading') return <PageLoader />
  // Someone already working inside an office has nothing to register here.
  if (session?.active_office && !registered) return <Navigate to={ROUTES.dashboard} replace />

  return (
    <AuthLayout wide footer={t('footer.rights', { year: new Date().getFullYear() })}>
      {registered ? (
        <RegisterSuccess office={registered} />
      ) : (
        <motion.div variants={staggerContainer(0.06, 0.15)} initial="hidden" animate="visible">
          <AuthHeading
            eyebrow={t('register.eyebrow')}
            title={t('register.title')}
            subtitle={t('register.subtitle')}
          />
          <motion.p
            variants={fadeUp}
            className="mt-4 rounded-xl border border-border bg-surface-muted/60 px-4 py-3 text-sm leading-relaxed text-foreground/80"
          >
            {t('register.staffNotice')}
          </motion.p>
          <motion.div variants={fadeUp} className="mt-8">
            <RegisterWizard onRegistered={setRegistered} />
          </motion.div>
          {!session && (
            <motion.div
              variants={fadeUp}
              className="mt-8 flex items-center gap-4 text-sm text-muted-foreground"
            >
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
              <span>
                {t('register.haveAccount')}{' '}
                <Link
                  to={ROUTES.login}
                  className="font-semibold text-accent underline-offset-4 hover:underline"
                >
                  {t('register.signIn')}
                </Link>
              </span>
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
            </motion.div>
          )}
        </motion.div>
      )}
    </AuthLayout>
  )
}

export default RegisterPage
