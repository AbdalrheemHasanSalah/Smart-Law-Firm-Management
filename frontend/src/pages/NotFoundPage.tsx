import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ROUTES } from '@/app/router/routes'
import { CenteredMessage } from '@/components/layout/CenteredMessage'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/hooks/use-document-title'

const NotFoundPage = () => {
  const { t } = useTranslation()
  useDocumentTitle(`${t('notFound.title')} — ${t('brand.name')}`)
  return (
    <CenteredMessage
      eyebrow="404"
      title={t('notFound.title')}
      description={t('notFound.description')}
    >
      <Button asChild variant="outline">
        <Link to={ROUTES.login}>{t('actions.backToLogin')}</Link>
      </Button>
    </CenteredMessage>
  )
}

export default NotFoundPage
