import { useQuery } from '@tanstack/react-query'
import { PATHS } from '@/auth/auth'
import { api } from './api'
import type { PlatformOffice } from './types'

/** Every office on the platform. Polled, so new registration requests show up on their own. */
export const usePlatformOffices = (enabled = true) =>
  useQuery({
    queryKey: ['platform-offices'],
    enabled,
    refetchInterval: 30_000,
    queryFn: async () => (await api.get<{ offices: PlatformOffice[] }>('/platform/offices')).data.offices,
  })

/** A registration request no platform administrator has opened yet. */
export const isUnseenRequest = (office: PlatformOffice) => office.status === 'pending' && !office.platform_seen_at

export const officeRequestPath = (officeId: string) => `${PATHS.platform}/offices/${encodeURIComponent(officeId)}`
