import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { Membership } from '../types'

const BADGE = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold'

export const RoleBadge = ({ membership }: { membership: Membership }) => {
  const { t } = useTranslation('auth')
  return (
    <span className={cn(BADGE, 'bg-accent-soft text-accent')}>
      {membership.is_owner ? t('roles.owner') : t(`roles.${membership.role}`)}
    </span>
  )
}

/** Explains why an office cannot be entered; renders nothing for a usable membership. */
export const AccessBadge = ({ membership }: { membership: Membership }) => {
  const { t } = useTranslation('auth')
  if (membership.membership_status === 'suspended') {
    return (
      <span className={cn(BADGE, 'bg-destructive-soft text-destructive')}>
        {t('officeStatus.membershipSuspended')}
      </span>
    )
  }
  if (membership.office_status === 'active') return null
  const tone =
    membership.office_status === 'pending'
      ? 'bg-surface-muted text-warning'
      : 'bg-destructive-soft text-destructive'
  return <span className={cn(BADGE, tone)}>{t(`officeStatus.${membership.office_status}`)}</span>
}
