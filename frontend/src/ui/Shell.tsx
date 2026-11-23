import {
  Briefcase,
  Building2,
  CreditCard,
  FileSignature,
  FileText,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessagesSquare,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import { PATHS, personaOf, useAuth, type Persona } from '@/auth/auth'
import { DEMO } from '@/lib/api'
import { formatDay, ROLE } from '@/lib/labels'
import { SubscriptionBanner, SubscriptionLocked } from '@/pages/Subscriptions'
import { NotificationBell, useUnreadMessages } from './Inbox'
import { cn, Logo, type StampTone } from './kit'

type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  badge?: 'messages'
  /** Also highlighted on pages under this path (for an entry that otherwise matches exactly). */
  within?: string
}

const office = (extra: NavItem[] = []): NavItem[] => [
  { to: PATHS.office, label: 'الرئيسية', icon: LayoutDashboard, end: true },
  { to: `${PATHS.office}/cases`, label: 'القضايا', icon: Briefcase },
  { to: `${PATHS.office}/clients`, label: 'الموكّلون', icon: Users },
  { to: `${PATHS.office}/tasks`, label: 'المهام', icon: ListChecks },
  { to: `${PATHS.office}/documents`, label: 'المستندات', icon: FileText },
  { to: `${PATHS.office}/contracts`, label: 'العقود', icon: FileSignature },
  { to: `${PATHS.office}/messages`, label: 'الرسائل', icon: MessagesSquare, badge: 'messages' },
  ...extra,
]

const PERSONA: Record<Persona, { nav: NavItem[]; label: string }> = {
  platform: {
    nav: [
      { to: PATHS.platform, label: 'طلبات المكاتب', icon: Building2, end: true, within: `${PATHS.platform}/offices/` },
      { to: `${PATHS.platform}/subscriptions`, label: 'الاشتراكات', icon: Wallet },
    ],
    label: 'إدارة المنصّة',
  },
  owner: {
    nav: office([
      { to: `${PATHS.office}/team`, label: 'الفريق', icon: UsersRound },
      { to: `${PATHS.office}/subscription`, label: 'الاشتراك', icon: CreditCard },
    ]),
    label: 'صاحب المكتب',
  },
  lawyer: { nav: office(), label: 'فريق المكتب' },
  client: {
    nav: [
      { to: PATHS.client, label: 'قضاياي', icon: Briefcase, end: true },
      { to: `${PATHS.client}/messages`, label: 'الرسائل', icon: MessagesSquare, badge: 'messages' },
    ],
    label: 'بوابة الموكّل',
  },
}

const initialsOf = (name = '') =>
  name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join(' ')

/**
 * The working area: a navy side bar with the sections, a top bar with the office and the date,
 * and the page on a light surface. On phones the sections become a scrolling row under the top bar.
 * `plain` pages lay out their own cards; other pages are placed on one white card.
 */
export const Shell = ({ children, plain = false }: { children: ReactNode; plain?: boolean }) => {
  const { session, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const persona = personaOf(session) ?? 'lawyer'
  const { nav, label } = PERSONA[persona]
  const roleName = persona === 'platform' ? 'مدير المنصّة' : persona === 'owner' ? 'صاحب المكتب' : ROLE[session?.role ?? 'lawyer']
  const signOut = () => void logout().then(() => navigate(PATHS.login))
  // Every side-bar entry leads to the main page of its section. Clicking the section you are
  // already in (inside a case, a conversation, a filtered list…) starts that page afresh: the
  // link drops the query string, and the new key below remounts the page with its defaults.
  const [visit, setVisit] = useState(0)
  const isWithin = (prefix?: string) => Boolean(prefix && location.pathname.startsWith(prefix))
  const restart = (to: string) => () => {
    if (location.pathname !== to) return
    setVisit((count) => count + 1)
    window.scrollTo({ top: 0 })
  }
  const hasInbox = persona !== 'platform'
  // A lapsed office: every page but the owner's subscription page is replaced by an explanation.
  const locked = session?.subscription?.state === 'expired' && location.pathname !== `${PATHS.office}/subscription`

  return (
    <div className="min-h-dvh bg-paper-shade lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      {/* side bar */}
      <aside className="desk sticky top-0 hidden h-dvh flex-col px-4 py-5 lg:flex">
        <Link to={nav[0]!.to} onClick={restart(nav[0]!.to)} aria-label="قضيتي" className="px-2">
          <Logo onDesk />
        </Link>
        <p className="mt-6 px-3 text-[0.7rem] font-semibold text-paper/45">{label}</p>
        <nav aria-label="أقسام العمل" className="mt-2 flex-1 space-y-1 overflow-y-auto">
          {nav.map(({ to, label: text, icon: Icon, end, badge, within }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={restart(to)}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors duration-200',
                  isActive || isWithin(within) ? 'text-paper' : 'text-paper/65 hover:bg-paper/8 hover:text-paper',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {(isActive || isWithin(within)) && (
                    <motion.span layoutId="nav-pill" transition={{ type: 'spring', stiffness: 380, damping: 32 }} className="absolute inset-0 rounded-xl bg-stamp shadow-[0_8px_18px_-8px_rgb(217_11_26/0.9)]" />
                  )}
                  <Icon className="relative size-[1.15rem] transition-transform duration-200 group-hover:scale-110" aria-hidden="true" />
                  <span className="relative flex-1">{text}</span>
                  {badge && <UnreadBadge active={isActive} />}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-paper/8 p-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-paper text-sm font-bold text-ink">{initialsOf(session?.user.full_name)}</span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold text-paper">{session?.user.full_name}</p>
            <p className="text-xs text-paper/55">{roleName}</p>
          </div>
          <button type="button" onClick={signOut} aria-label="تسجيل الخروج" title="تسجيل الخروج" className="grid size-9 shrink-0 place-items-center rounded-lg text-paper/70 transition-colors hover:bg-stamp hover:text-paper">
            <LogOut className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        {/* top bar */}
        <header className="sticky top-0 z-30 border-b border-ink/10 bg-paper/90 backdrop-blur-md">
          <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <Link to={nav[0]!.to} onClick={restart(nav[0]!.to)} aria-label="قضيتي" className="lg:hidden">
                <Logo />
              </Link>
              <div className="hidden min-w-0 leading-tight lg:block">
                <p className="truncate font-doc text-xl font-bold text-ink">{session?.active_office?.office_name ?? label}</p>
                <p className="text-xs text-ink-faint">{formatDay(new Date())}</p>
              </div>
              {DEMO && <span className="rounded-full bg-stamp/10 px-2.5 py-1 text-[0.7rem] font-bold text-stamp">وضع تجريبي</span>}
            </div>
            <div className="flex items-center gap-2">
              {hasInbox && <NotificationBell />}
            <button type="button" onClick={signOut} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink lg:hidden">
              <LogOut className="size-4 rtl:-scale-x-100" aria-hidden="true" />
              خروج
            </button>
            </div>
          </div>
          <nav aria-label="أقسام العمل" className="flex gap-1.5 overflow-x-auto px-4 pb-3 [scrollbar-width:none] lg:hidden">
            {nav.map(({ to, label: text, icon: Icon, end, badge, within }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={restart(to)}
                className={({ isActive }) =>
                  cn('flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold', isActive || isWithin(within) ? 'bg-stamp text-paper' : 'bg-ink/5 text-ink-soft')
                }
              >
                <Icon className="size-4" aria-hidden="true" />
                {text}
                {badge && <UnreadBadge active />}
              </NavLink>
            ))}
          </nav>
        </header>

        <SubscriptionBanner />

        {/* Keyed by path (and by side-bar restarts): each page fades up on arrival. No exit
            animation, so a page never lingers after its route is gone. */}
        <motion.main
          key={`${location.pathname}#${visit}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto w-full max-w-7xl p-4 sm:p-8"
        >
          {plain && !locked ? (
            children
          ) : (
            <div className="rounded-2xl border border-ink/8 bg-white p-5 shadow-[0_10px_30px_-18px_rgb(6_29_51/0.35)] sm:p-7">
              {locked ? <SubscriptionLocked /> : children}
            </div>
          )}
        </motion.main>
      </div>
    </div>
  )
}

/** Count of unread direct messages beside the "messages" entry. */
const UnreadBadge = ({ active }: { active: boolean }) => {
  const unread = useUnreadMessages().data ?? 0
  if (!unread) return null
  return (
    <span className={cn('relative grid min-w-5 place-items-center rounded-full px-1 text-[0.65rem] leading-5 font-bold', active ? 'bg-paper text-stamp' : 'bg-stamp text-paper')}>
      {unread > 9 ? '+9' : unread}
    </span>
  )
}

/** Title block at the top of a page. */
export const SheetHeader = ({ title, note, action }: { title: string; note?: string; action?: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 className="text-3xl text-ink">{title}</h1>
      {note && <p className="mt-0.5 text-sm text-ink-soft">{note}</p>}
    </div>
    {action}
  </div>
)

const PILL: Record<StampTone, string> = {
  red: 'bg-stamp/10 text-stamp',
  blue: 'bg-stamp-blue/10 text-stamp-blue',
  green: 'bg-stamp-green/15 text-stamp-green',
  ink: 'bg-ink/8 text-ink-soft',
}

/** A status label: soft tinted pill with a dot. */
export const Pill = ({ tone = 'ink', children }: { tone?: StampTone; children: ReactNode }) => (
  <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap', PILL[tone])}>
    <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
    {children}
  </span>
)

export const Empty = ({ children }: { children: ReactNode }) => (
  <p className="rounded-xl border border-dashed border-ink/20 px-5 py-10 text-center text-ink-soft">{children}</p>
)

export const Loading = () => (
  <div className="space-y-3" aria-busy="true" aria-label="جارٍ التحميل">
    {[0, 1, 2, 3].map((row) => (
      <div key={row} className="h-12 animate-pulse rounded-lg bg-paper-shade" style={{ animationDelay: `${row * 120}ms` }} />
    ))}
  </div>
)

export const Failed = ({ error }: { error: unknown }) => (
  <p role="alert" className="rounded-lg border-s-4 border-stamp bg-stamp/8 px-4 py-3 text-sm text-stamp">
    {error instanceof Error ? error.message : 'تعذّر تحميل البيانات.'}
  </p>
)
