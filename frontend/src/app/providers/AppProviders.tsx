import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { AppToaster } from '@/components/ui/toaster'
import { AuthProvider } from '@/features/auth/AuthProvider'
import i18n from '@/lib/i18n'
import type { ApiError } from '@/services/api/api-error'
import { ThemeProvider } from './ThemeProvider'

const shouldRetry = (failureCount: number, error: unknown) => {
  const code = (error as Partial<ApiError> | null)?.code
  if (
    code === 'UNAUTHORIZED' ||
    code === 'FORBIDDEN' ||
    code === 'NOT_FOUND' ||
    code === 'VALIDATION'
  )
    return false
  return failureCount < 2
}

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })

export const AppProviders = ({ children }: { children: ReactNode }) => {
  const [queryClient] = useState(createQueryClient)
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          {/* reducedMotion="user" makes every motion component respect prefers-reduced-motion */}
          <MotionConfig reducedMotion="user">
            <AuthProvider>
              {children}
              <AppToaster />
            </AuthProvider>
          </MotionConfig>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nextProvider>
  )
}
