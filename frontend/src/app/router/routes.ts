/** Every route path in one place — never hard-code paths in components. */
export const ROUTES = {
  home: '/',
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  selectOffice: '/select-office',
  onboarding: '/onboarding',
  invitation: '/invite/:token',
  unauthorized: '/unauthorized',
  dashboard: '/dashboard',
} as const

export const invitationPath = (token: string) => `/invite/${encodeURIComponent(token)}`
