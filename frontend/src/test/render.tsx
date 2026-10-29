import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AppProviders } from '@/app/providers/AppProviders'
import { ROUTES } from '@/app/router/routes'
import '@/lib/i18n'

/** Renders `ui` at `path` inside the real providers, with stub routes for the destinations. */
export const renderRoute = (ui: ReactNode, path = '/login', routePath = path) => {
  const router = createMemoryRouter(
    [
      { path: routePath, element: ui },
      { path: ROUTES.dashboard, element: <p>dashboard-route</p> },
      { path: ROUTES.selectOffice, element: <p>select-office-route</p> },
      { path: ROUTES.onboarding, element: <p>onboarding-route</p> },
      { path: ROUTES.login, element: <p>login-route</p> },
      { path: '*', element: <p>other-route</p> },
    ],
    { initialEntries: [path] },
  )
  return render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  )
}
