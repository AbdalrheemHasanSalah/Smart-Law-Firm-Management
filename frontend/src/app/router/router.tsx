import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router'
import { PageLoader } from '@/components/layout/PageLoader'
import { RedirectIfAuthenticated, RequireAuth, RequireOffice } from './RequireAuth'
import { ROUTES } from './routes'

const LoginPage = lazy(() => import('@/features/auth/pages/LoginPage'))
const RegisterPage = lazy(() => import('@/features/auth/pages/RegisterPage'))
const ForgotPasswordPage = lazy(() => import('@/features/auth/pages/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('@/features/auth/pages/ResetPasswordPage'))
const SelectOfficePage = lazy(() => import('@/features/auth/pages/SelectOfficePage'))
const OnboardingPage = lazy(() => import('@/features/auth/pages/OnboardingPage'))
const InvitationPage = lazy(() => import('@/features/auth/pages/InvitationPage'))
const SignedInPage = lazy(() => import('@/pages/SignedInPage'))
const PendingStagePage = lazy(() => import('@/pages/PendingStagePage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

const withSuspense = (node: ReactNode) => <Suspense fallback={<PageLoader />}>{node}</Suspense>

export const router = createBrowserRouter([
  // Public website (Home/About/Features/Contact) arrives in Phase 8 — until then, start at sign-in.
  { path: ROUTES.home, element: <Navigate to={ROUTES.login} replace /> },
  {
    path: ROUTES.login,
    element: withSuspense(
      <RedirectIfAuthenticated>
        <LoginPage />
      </RedirectIfAuthenticated>,
    ),
  },
  // Open to visitors and to signed-in accounts without an office (e.g. after a rejection).
  { path: ROUTES.register, element: withSuspense(<RegisterPage />) },
  {
    path: ROUTES.forgotPassword,
    element: withSuspense(
      <RedirectIfAuthenticated>
        <ForgotPasswordPage />
      </RedirectIfAuthenticated>,
    ),
  },
  { path: ROUTES.resetPassword, element: withSuspense(<ResetPasswordPage />) },
  { path: ROUTES.invitation, element: withSuspense(<InvitationPage />) },
  {
    path: ROUTES.selectOffice,
    element: withSuspense(
      <RequireAuth>
        <SelectOfficePage />
      </RequireAuth>,
    ),
  },
  {
    path: ROUTES.onboarding,
    element: withSuspense(
      <RequireAuth>
        <OnboardingPage />
      </RequireAuth>,
    ),
  },
  { path: ROUTES.unauthorized, element: withSuspense(<PendingStagePage />) },
  {
    path: ROUTES.dashboard,
    element: withSuspense(
      <RequireOffice>
        <SignedInPage />
      </RequireOffice>,
    ),
  },
  { path: '*', element: withSuspense(<NotFoundPage />) },
])
