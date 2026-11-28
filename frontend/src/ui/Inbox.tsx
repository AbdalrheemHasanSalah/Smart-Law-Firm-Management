import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlarmClock, Bell, Briefcase, Building2, FileText, ListChecks, MessagesSquare, StickyNote, Users, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api, messageOf } from '@/lib/api'
import { notificationLink } from '@/lib/notifications'
import { isUnseenRequest, officeRequestPath, usePlatformOffices } from '@/lib/platform'
import { personaOf, useAuth } from '@/auth/auth'
import { usePreferences, useSavePreferences } from '@/lib/reminders'
import type { NotificationItem } from '@/lib/types'
import { cn } from './kit'
import { LANG } from '@/lib/i18n'

/** Polled, since the backend has no push channel: new items appear within half a minute. */
const POLL_MS = 30_000

export const useUnreadMessages = () =>
  useQuery({
    queryKey: ['messages', 'unread'],
    refetchInterval: POLL_MS,
    queryFn: async () => (await api.get<{ unread: number }>('/messages/unread-count')).data.unread,
  })

const ICONS: Record<string, LucideIcon> = {
  message: MessagesSquare,
  task: ListChecks,
  case_note: StickyNote,
  case_document: FileText,
  case_status: Briefcase,
  case_assignment: Briefcase,
  team: Users,
  reminder: AlarmClock,
}

const relative = new Intl.RelativeTimeFormat(LANG, { numeric: 'auto' })
/** "قبل 5 دقائق", "أمس"… */
export const timeAgo = (value: string) => {
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000)
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour')
  return relative.format(Math.round(hours / 24), 'day')
}

/** Staff only: whether reminders (hearings, tasks, appointments, powers of attorney) also come by email. */
const ReminderEmails = () => {
  const preferences = usePreferences()
  const save = useSavePreferences()
  const checked = preferences.data?.email_reminders ?? true
  return (
    <div className="border-t border-ink/10 px-4 py-3">
      <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-ink">
        <span>
          <span className="block font-semibold">تذكيرات بالبريد</span>
          <span className="block text-xs text-ink-faint">الجلسات والمهام والمواعيد والتوكيلات. تبقى التذكيرات هنا دائماً.</span>
        </span>
        <input
          type="checkbox"
          checked={checked}
          disabled={preferences.isPending || save.isPending}
          onChange={(event) => save.mutate({ email_reminders: event.target.checked })}
          className="size-4 shrink-0 accent-stamp"
        />
      </label>
      {save.isError && <p role="alert" className="mt-1 text-xs text-stamp">{messageOf(save.error)}</p>}
    </div>
  )
}

/** The bell in the top bar: a count of unread notifications and a panel listing the latest. */
export const NotificationBell = () => {
  const queryClient = useQueryClient()
  const persona = personaOf(useAuth().session)
  // Reminders reach office staff; clients and the platform owner have none to configure.
  const staff = persona === 'owner' || persona === 'lawyer'
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const inbox = useQuery({
    queryKey: ['notifications'],
    refetchInterval: POLL_MS,
    queryFn: async () => (await api.get<{ notifications: NotificationItem[]; unread: number }>('/notifications')).data,
  })
  const markRead = useMutation({
    mutationFn: () => api.post('/notifications/read'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const clearAll = useMutation({
    mutationFn: () => api.delete('/notifications'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const markOne = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${encodeURIComponent(id)}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
  /** Tapping a notification goes to its page (the link does that), closes the panel and marks it read. */
  const openItem = (item: NotificationItem) => {
    setOpen(false)
    if (!item.read_at) markOne.mutate(item.notification_id)
  }
  const hasItems = (inbox.data?.notifications.length ?? 0) > 0
  const unread = inbox.data?.unread ?? 0

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={unread ? `الإشعارات: ${unread} غير مقروءة` : 'الإشعارات'}
        className="relative grid size-10 place-items-center rounded-full border border-ink/12 bg-white text-ink transition-colors hover:border-ink/30"
      >
        <Bell className={cn('size-[1.15rem]', unread > 0 && 'origin-top animate-[sway_1.6s_ease-in-out_2]')} aria-hidden="true" />
        <AnimatePresence>
          {unread > 0 && (
            <motion.span
              key={unread}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 20 }}
              className="absolute -top-1 -left-1 ltr:-right-1 ltr:left-auto grid min-w-5 place-items-center rounded-full bg-stamp px-1 text-[0.65rem] leading-5 font-bold text-paper"
            >
              {unread > 9 ? '+9' : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="الإشعارات"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="absolute top-12 left-0 z-40 w-[min(22rem,calc(100vw-2rem))] origin-top-left ltr:right-0 ltr:left-auto ltr:origin-top-right overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-lifted"
          >
            <div className="flex items-center justify-between gap-3 border-b border-ink/10 px-4 py-3">
              <p className="font-doc text-xl font-bold text-ink">الإشعارات</p>
              <div className="flex items-center gap-3">
                {unread > 0 && (
                  <button type="button" onClick={() => markRead.mutate()} disabled={markRead.isPending} className="text-xs font-semibold text-stamp-blue underline-offset-4 hover:underline disabled:opacity-50">
                    علّم الكل كمقروء
                  </button>
                )}
                {hasItems && (
                  <button type="button" onClick={() => clearAll.mutate()} disabled={clearAll.isPending} className="text-xs font-semibold text-stamp underline-offset-4 hover:underline disabled:opacity-50">
                    مسح الكل
                  </button>
                )}
              </div>
            </div>
            <ul className="max-h-96 overflow-y-auto">
              {inbox.isPending && <li className="px-4 py-6 text-center text-sm text-ink-faint">جارٍ التحميل…</li>}
              {inbox.isError && <li className="px-4 py-6 text-center text-sm text-stamp">تعذّر تحميل الإشعارات.</li>}
              {inbox.data?.notifications.length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-faint">لا إشعارات بعد.</li>}
              {inbox.data?.notifications.map((item) => {
                const Icon = ICONS[item.notification_type] ?? Bell
                const link = notificationLink(item, persona)
                const row = cn('flex gap-3 px-4 py-3', !item.read_at && 'bg-stamp/5')
                const content = (
                  <>
                    <span className={cn('mt-0.5 grid size-9 shrink-0 place-items-center rounded-full', item.read_at ? 'bg-ink/6 text-ink-soft' : 'bg-stamp text-paper')}>
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{item.title}</span>
                      <span className="block text-sm leading-snug text-ink-soft">{item.body}</span>
                      <span className="mt-0.5 block text-xs text-ink-faint">{timeAgo(item.created_at)}</span>
                    </span>
                  </>
                )
                return (
                  <li key={item.notification_id} className="border-b border-ink/6 last:border-0">
                    {link ? (
                      <Link to={link} onClick={() => openItem(item)} className={cn(row, 'transition-colors', item.read_at ? 'hover:bg-ink/4' : 'hover:bg-stamp/10')}>
                        {content}
                      </Link>
                    ) : (
                      <div className={row}>{content}</div>
                    )}
                  </li>
                )
              })}
            </ul>
            {staff && <ReminderEmails />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * The platform owner's bell: new office registration requests that nobody has opened yet.
 * Opening one marks it read; "مسح الكل" marks them all read.
 */
export const PlatformBell = () => {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const offices = usePlatformOffices()
  const fresh = (offices.data ?? []).filter(isUnseenRequest).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const clearAll = useMutation({
    mutationFn: () => api.post('/platform/offices/seen'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform-offices'] }),
  })

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={fresh.length ? `الإشعارات: ${fresh.length} جديدة` : 'الإشعارات'}
        className="relative grid size-10 place-items-center rounded-full border border-ink/12 bg-white text-ink transition-colors hover:border-ink/30"
      >
        <Bell className={cn('size-[1.15rem]', fresh.length > 0 && 'origin-top animate-[sway_1.6s_ease-in-out_2]')} aria-hidden="true" />
        <AnimatePresence>
          {fresh.length > 0 && (
            <motion.span
              key={fresh.length}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 20 }}
              className="absolute -top-1 -left-1 ltr:-right-1 ltr:left-auto grid min-w-5 place-items-center rounded-full bg-stamp px-1 text-[0.65rem] leading-5 font-bold text-paper"
            >
              {fresh.length > 9 ? '+9' : fresh.length}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="الإشعارات"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="absolute top-12 left-0 z-40 w-[min(22rem,calc(100vw-2rem))] origin-top-left ltr:right-0 ltr:left-auto ltr:origin-top-right overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-lifted"
          >
            <div className="flex items-center justify-between gap-3 border-b border-ink/10 px-4 py-3">
              <p className="font-doc text-xl font-bold text-ink">الإشعارات</p>
              {fresh.length > 0 && (
                <button type="button" onClick={() => clearAll.mutate()} disabled={clearAll.isPending} className="text-xs font-semibold text-stamp underline-offset-4 hover:underline disabled:opacity-50">
                  مسح الكل
                </button>
              )}
            </div>
            <ul className="max-h-96 overflow-y-auto">
              {offices.isPending && <li className="px-4 py-6 text-center text-sm text-ink-faint">جارٍ التحميل…</li>}
              {offices.isError && <li className="px-4 py-6 text-center text-sm text-stamp">تعذّر تحميل الإشعارات.</li>}
              {offices.data && fresh.length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-faint">لا طلبات جديدة.</li>}
              {fresh.map((office) => (
                <li key={office.office_id} className="border-b border-ink/6 last:border-0">
                  <Link to={officeRequestPath(office.office_id)} onClick={() => setOpen(false)} className="flex gap-3 bg-stamp/5 px-4 py-3 transition-colors hover:bg-stamp/10">
                    <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-stamp text-paper">
                      <Building2 className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">طلب مكتب جديد</span>
                      <span className="block text-sm leading-snug text-ink-soft">{`«${office.name}» يريد الاشتراك في قضيتي.`}</span>
                      <span className="mt-0.5 block text-xs text-ink-faint">{timeAgo(office.created_at)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
