import { selectAdapter } from '@/services/adapters/select-adapter'
import type { AuthService, OnboardingService } from '../types'
import { httpAuthService, httpOnboardingService } from './auth.http'
import { mockAuthService, mockOnboardingService } from './auth.mock'

export const authService: AuthService = selectAdapter({
  mock: mockAuthService,
  http: httpAuthService,
})

export const onboardingService: OnboardingService = selectAdapter({
  mock: mockOnboardingService,
  http: httpOnboardingService,
})
