import type { OfficeRole } from '@/features/auth/types'

export type NavigationKey =
  | 'overview'
  | 'cases'
  | 'clients'
  | 'hearings'
  | 'documents'
  | 'tasks'
  | 'contracts'
  | 'billing'
  | 'team'
  | 'invitations'
  | 'myCases'
  | 'messages'

/**
 * Which sections each office role sees. This mirrors the backend's route permissions so the UI
 * does not offer what the server would refuse; it is presentation only, not access control.
 */
export const NAVIGATION_BY_ROLE: Record<OfficeRole, readonly NavigationKey[]> = {
  admin: [
    'overview',
    'cases',
    'clients',
    'hearings',
    'documents',
    'tasks',
    'contracts',
    'billing',
    'team',
    'invitations',
  ],
  lawyer: ['overview', 'cases', 'clients', 'hearings', 'documents', 'tasks', 'contracts'],
  assistant: ['overview', 'cases', 'clients', 'hearings', 'documents', 'tasks'],
  client: ['overview', 'myCases', 'documents', 'messages'],
}

export const navigationFor = (role: OfficeRole | null) => (role ? NAVIGATION_BY_ROLE[role] : [])
