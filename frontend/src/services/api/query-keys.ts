/**
 * Central TanStack Query key factory. Every feature adds its keys here so cache
 * invalidation stays predictable across the app.
 */
export const queryKeys = {
  auth: {
    all: ['auth'] as const,
    session: () => [...queryKeys.auth.all, 'session'] as const,
  },
  invitations: {
    all: ['invitations'] as const,
    preview: (token: string) => [...queryKeys.invitations.all, 'preview', token] as const,
  },
} as const
