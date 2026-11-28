import { PATHS, type Persona } from '@/auth/auth'
import type { NotificationItem } from './types'

/** Only a path inside this app is followed ("/office/…"), never another site ("//x", "https:…"). */
const isAppPath = (path: string | null | undefined): path is string =>
  typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')

/**
 * Where tapping a notification takes its reader. The server stores the page with each notification
 * (the same page its email links to). Notifications from before that change have none, so they
 * open the page their type belongs to; a reminder without one has no single page and opens nothing.
 */
export const notificationLink = (item: NotificationItem, persona: Persona | null): string | null => {
  if (isAppPath(item.link_path)) return item.link_path
  if (persona === 'client') {
    if (item.notification_type === 'message') return `${PATHS.client}/messages`
    return item.notification_type.startsWith('case_') ? PATHS.client : null
  }
  const owner = persona === 'owner'
  switch (item.notification_type) {
    case 'message':
      return `${PATHS.office}/messages`
    case 'task':
      return `${PATHS.office}/tasks`
    case 'case_note':
    case 'case_document':
    case 'case_status':
    case 'case_assignment':
      return `${PATHS.office}/cases`
    case 'consultation':
      return `${PATHS.office}/consultations`
    case 'team':
      return owner ? `${PATHS.office}/team` : `${PATHS.office}/me`
    case 'subscription':
      return owner ? `${PATHS.office}/subscription` : null
    default:
      return null
  }
}
