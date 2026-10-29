import { useTranslation } from 'react-i18next'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { AuthLayout } from '../components/AuthLayout'
import { LoginForm } from '../components/LoginForm'

const LoginPage = () => {
  const { t } = useTranslation('auth')
  useDocumentTitle(t('login.metaTitle'))
  return (
    <AuthLayout footer={t('footer.rights', { year: new Date().getFullYear() })}>
      <LoginForm />
    </AuthLayout>
  )
}

export default LoginPage
