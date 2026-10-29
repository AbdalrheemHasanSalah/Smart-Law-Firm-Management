import { ApiError } from '@/services/api/api-error'
import { httpClient } from '@/services/api/http-client'
import type {
  AuthService,
  AuthSession,
  InvitationPreview,
  OfficeRole,
  OnboardingService,
  RegisteredOffice,
} from '../types'

/**
 * Real backend implementation (backend-development). Authentication endpoints are Better
 * Auth's own (`/auth/*`); the session itself lives in an httpOnly cookie set by the server.
 */
export const httpAuthService: AuthService = {
  async getSession() {
    try {
      const { data } = await httpClient.get<AuthSession>('/me')
      return data
    } catch (error) {
      if (error instanceof ApiError && error.code === 'UNAUTHORIZED') return null
      throw error
    }
  },
  async login({ email, password, remember }) {
    await httpClient.post('/auth/sign-in/email', { email, password, rememberMe: remember })
  },
  async signUp({ name, email, password }) {
    await httpClient.post('/auth/sign-up/email', { name, email, password })
  },
  async logout() {
    await httpClient.post('/logout')
  },
  async selectOffice(officeId) {
    await httpClient.post('/session/office', { office_id: officeId })
  },
  async requestPasswordReset(email, redirectTo) {
    await httpClient.post('/auth/request-password-reset', { email, redirectTo })
  },
  async resetPassword(token, newPassword) {
    await httpClient.post('/auth/reset-password', { token, newPassword })
  },
}

export const httpOnboardingService: OnboardingService = {
  async registerOffice(input) {
    const { data } = await httpClient.post<{ office: RegisteredOffice }>('/offices', input)
    return data.office
  },
  async previewInvitation(token) {
    const { data } = await httpClient.get<{ invitation: InvitationPreview }>(
      `/invitations/${encodeURIComponent(token)}`,
    )
    return data.invitation
  },
  async acceptInvitation(token, input) {
    const { data } = await httpClient.post<{ office_id: string; role: OfficeRole }>(
      `/invitations/${encodeURIComponent(token)}/accept`,
      input,
    )
    return data
  },
}
