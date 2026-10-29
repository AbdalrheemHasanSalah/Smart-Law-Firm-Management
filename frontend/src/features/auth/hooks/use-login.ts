import { useMutation } from '@tanstack/react-query'
import { authService } from '../api'
import { useAuth } from '../auth-context'
import { isUsableMembership } from '../session-routing'
import type { AuthSession, LoginCredentials } from '../types'

type UseLoginOptions = { onSuccess?: (session: AuthSession | null) => void }

/**
 * Signs in and, with exactly one usable office, selects it right away (the server still verifies
 * the membership). The shared session is published once, at the end, so route guards never see
 * the in-between state. `onSuccess` is a hook-level callback, so it still runs if a guard has
 * already moved away from the sign-in page.
 */
export const useLogin = ({ onSuccess }: UseLoginOptions = {}) => {
  const { refresh } = useAuth()
  return useMutation({
    mutationFn: async (credentials: LoginCredentials) => {
      await authService.login(credentials)
      const session = await authService.getSession()
      const usable = session?.memberships.filter(isUsableMembership) ?? []
      if (session && !session.active_office && usable.length === 1 && usable[0]) {
        await authService.selectOffice(usable[0].office_id)
      }
      return refresh()
    },
    onSuccess,
  })
}
