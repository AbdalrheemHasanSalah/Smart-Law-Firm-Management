import { useMutation } from '@tanstack/react-query'
import { ApiError } from '@/services/api/api-error'
import { authService, onboardingService } from '../api'
import { useAuth } from '../auth-context'
import {
  toRegistrationInput,
  type AccountValues,
  type LawyerValues,
  type OfficeValues,
} from '../schemas/register.schema'
import type { RegisteredOffice } from '../types'

type RegisterVariables = {
  account: AccountValues | null
  office: OfficeValues
  lawyer: LawyerValues
}

/**
 * Creates the account (unless already signed in), then registers the office for it. If the
 * office step fails after the account was created, a retry skips straight to the office, because
 * the session now exists.
 */
export const useRegisterOffice = () => {
  const { refresh } = useAuth()
  return useMutation<RegisteredOffice, ApiError, RegisterVariables>({
    mutationFn: async ({ account, office, lawyer }) => {
      const session = await refresh()
      if (!session) {
        if (!account) throw new ApiError('UNAUTHORIZED')
        await authService.signUp({
          name: account.fullName.trim(),
          email: account.email.trim(),
          password: account.password,
        })
        await refresh()
      }
      const registered = await onboardingService.registerOffice(toRegistrationInput(office, lawyer))
      await refresh()
      return registered
    },
  })
}
