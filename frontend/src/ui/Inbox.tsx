import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Briefcase, FileText, ListChecks, MessagesSquare, StickyNote, Users, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { NotificationItem } from '@/lib/types'
import { cn } from './kit'

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
}

const relative = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' })
/** "قبل 5 دقائق", "أمس"… */
export const timeAgo = (value: string) => {
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000)
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour')
  return relative.format(Math.round(hours / 24), 'day')
}

/** The bell in the top bar: a count of unread notifications and a panel listing the latest. */
export const NotificationBell = () => {
  const queryClient = useQueryClient()
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
              className="absolute -top-1 -left-1 grid min-w-5 place-items-center rounded-full bg-stamp px-1 text-[0.65rem] leading-5 font-bold text-paper"
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
            className="absolute top-12 left-0 z-40 w-[min(22rem,calc(100vw-2rem))] origin-top-left overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-lifted"
          >
            <div className="flex items-center justify-between gap-3 border-b border-ink/10 px-4 py-3">
              <p className="font-doc text-xl font-bold text-ink">الإشعارات</p>
              {unread > 0 && (
                <button type="button" onClick={() => markRead.mutate()} disabled={markRead.isPending} className="text-xs font-semibold text-stamp underline-offset-4 hover:underline disabled:opacity-50">
                  علّم الكل كمقروء
                </button>
              )}
            </div>
            <ul className="max-h-96 overflow-y-auto">
              {inbox.isPending && <li className="px-4 py-6 text-center text-sm text-ink-faint">جارٍ التحميل…</li>}
              {inbox.isError && <li className="px-4 py-6 text-center text-sm text-stamp">تعذّر تحميل الإشعارات.</li>}
              {inbox.data?.notifications.length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-faint">لا إشعارات بعد.</li>}
              {inbox.data?.notifications.map((item) => {
                const Icon = ICONS[item.notification_type] ?? Bell
                return (
                  <li key={item.notification_id} className={cn('flex gap-3 border-b border-ink/6 px-4 py-3 last:border-0', !item.read_at && 'bg-stamp/5')}>
                    <span className={cn('mt-0.5 grid size-9 shrink-0 place-items-center rounded-full', item.read_at ? 'bg-ink/6 text-ink-soft' : 'bg-stamp text-paper')}>
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{item.title}</p>
                      <p className="text-sm leading-snug text-ink-soft">{item.body}</p>
                      <p className="mt-0.5 text-xs text-ink-faint">{timeAgo(item.created_at)}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
