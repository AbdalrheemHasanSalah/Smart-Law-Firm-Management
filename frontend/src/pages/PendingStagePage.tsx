import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ROUTES } from '@/app/router/routes'
import { CenteredMessage } from '@/components/layout/CenteredMessage'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/hooks/use-document-title'

/** Placeholder for routes scheduled in later phases — clearly labelled, with a way back. */
const PendingStagePage = () => {
  const { t } = useTranslation()
  useDocumentTitle(`${t('pending.title')} — ${t('brand.name')}`)
  return (
    <CenteredMessage
      eyebrow={t('pending.eyebrow')}
      title={t('pending.title')}
      description={t('pending.description')}
    >
      <Button asChild variant="outline">
        <Link to={ROUTES.login}>{t('actions.backToLogin')}</Link>
      </Button>
    </CenteredMessage>
  )
}

export default PendingStagePage
