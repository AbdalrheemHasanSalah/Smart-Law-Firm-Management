import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Briefcase, CalendarClock, ListChecks, Users, type LucideIcon } from 'lucide-react'
import { animate, motion } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { personaOf, useAuth } from '@/auth/auth'
import { api } from '@/lib/api'
import { CASE_STATUS, CASE_TYPE, dueLabel, formatDate, formatDay, PRIORITY } from '@/lib/labels'
import { oneOf, useParam } from '@/lib/useParam'
import type { Client, LegalCase, Task } from '@/lib/types'
import { buttonClass, cn, PaperClip } from '@/ui/kit'
import { Empty, Failed, Loading, Pill } from '@/ui/Shell'
import { LAW_PHOTOS } from '@/ui/Slideshow'

export const useCases = (search = '') =>
  useQuery({
    queryKey: ['cases', search],
    queryFn: async () => (await api.get<{ cases: LegalCase[] }>('/cases', { params: { pageSize: 50, ...(search ? { search } : {}) } })).data.cases,
  })
export const useTasks = () =>
  useQuery({ queryKey: ['tasks'], queryFn: async () => (await api.get<{ tasks: Task[] }>('/tasks', { params: { pageSize: 50 } })).data.tasks })
export const useClients = () =>
  useQuery({ queryKey: ['clients'], queryFn: async () => (await api.get<{ clients: Client[] }>('/clients', { params: { pageSize: 50 } })).data.clients })

/* ───────────────────────── cases table (shared with the register) ───────────────────────── */

export const CasesTable = ({ rows }: { rows: LegalCase[] }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[36rem]">
      <thead>
        <tr className="border-b border-ink/15 text-xs text-ink-soft">
          <th className="pe-6 pb-3 text-start font-semibold">الرقم</th>
          <th className="pe-6 pb-3 text-start font-semibold">القضية</th>
          <th className="pe-6 pb-3 text-start font-semibold">الأولوية</th>
          <th className="pb-3 text-start font-semibold">الحالة</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <motion.tr
            key={row.case_id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 * index, duration: 0.3 }}
            className="border-b border-ink/8 transition-colors last:border-0 hover:bg-paper-shade"
          >
            <td className="py-3.5 pe-6 whitespace-nowrap">
              <bdi className="rounded-md bg-ink/6 px-2 py-1 text-sm font-bold text-ink tabular-nums">{row.case_number}</bdi>
            </td>
            <td className="py-3.5 pe-6">
              <Link to={`/office/cases/${row.case_id}`} className="font-semibold text-ink underline-offset-4 hover:text-stamp hover:underline">
                {row.title}
              </Link>
              <p className="text-xs text-ink-faint">
                {CASE_TYPE[row.case_type] ?? row.case_type} · فُتحت {formatDate(row.opened_at)}
              </p>
            </td>
            <td className="py-3.5 pe-6 text-sm whitespace-nowrap text-ink-soft">{PRIORITY[row.priority]?.text}</td>
            <td className="py-3.5">
              <Pill tone={CASE_STATUS[row.status]?.tone}>{CASE_STATUS[row.status]?.text}</Pill>
            </td>
          </motion.tr>
        ))}
      </tbody>
    </table>
  </div>
)

/* ───────────────────────── dashboard pieces ───────────────────────── */

/** A number that counts up when the card arrives. */
const CountUp = ({ value }: { value: number }) => {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const controls = animate(0, value, {
      duration: 0.9,
      ease: 'easeOut',
      onUpdate: (latest) => {
        if (ref.current) ref.current.textContent = String(Math.round(latest))
      },
    })
    return () => controls.stop()
  }, [value])
  return <span ref={ref}>0</span>
}

const arrive = (delay: number) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const, delay },
})

/** Free law photographs from Unsplash (Unsplash License), one for each card's header. */
const HEADER_PHOTOS = {
  library: 'https://images.unsplash.com/photo-1505664194779-8beaceb93744',
  justice: 'https://images.unsplash.com/photo-1768839722927-df0ef3188f6d',
  signing: 'https://images.unsplash.com/photo-1763729805496-b5dbf7f00c79',
  writing: 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85',
} as const

/** Every dashboard box takes the same props, so each look can swap the box it uses. */
type BoxProps = { title: string; action?: ReactNode; children: ReactNode; delay?: number; clip?: boolean; photo?: keyof typeof HEADER_PHOTOS }

/** A card with a photo header carrying its title and optional link; the body is the page's card surface. */
const Card = ({ title, action, children, delay = 0, photo }: BoxProps) => (
  <motion.section {...arrive(delay)} className="card-edge overflow-hidden rounded-2xl border border-ink/8 bg-white shadow-[0_10px_30px_-18px_rgb(6_29_51/0.35)]">
    <div className="desk relative flex h-24 items-end justify-between gap-3 overflow-hidden px-5 pb-3.5 sm:px-6">
      {photo && (
        <img
          src={`${HEADER_PHOTOS[photo]}?auto=format&fit=crop&w=960&h=260&q=70`}
          alt=""
          referrerPolicy="no-referrer"
          className="header-photo absolute inset-0 size-full object-cover"
        />
      )}
      <div aria-hidden="true" className="header-wash absolute inset-0" />
      <h2 className="relative text-2xl text-paper">{title}</h2>
      {action && <div className="relative">{action}</div>}
    </div>
    <div className="p-5 sm:p-6">{children}</div>
  </motion.section>
)

/** An open case file: the title on the folder's tab, the content on a sheet of paper inside it. */
const Folder = ({ title, action, children, delay = 0 }: BoxProps) => (
  <motion.section {...arrive(delay)} className="relative pt-9">
    <h2 className="tab-cut absolute top-0 start-5 flex h-10 items-center rounded-t-md bg-manila px-10 text-2xl text-ink">{title}</h2>
    {action && <div className="absolute top-2 end-1">{action}</div>}
    <div className="manila rounded-md rounded-ss-none p-2.5 sm:p-3.5">
      <div className="paper p-4 sm:p-5">{children}</div>
    </div>
  </motion.section>
)

/** A loose sheet of paper on the desk, its title over a double rule; `clip` holds it with a paper clip. */
const Sheet = ({ title, action, children, delay = 0, clip = false }: BoxProps) => (
  <motion.section {...arrive(delay)} className="paper relative px-5 pt-6 pb-6 sm:px-6">
    {clip && <PaperClip className="absolute -top-5 end-10 h-14" />}
    <div className="mb-5 flex items-center justify-between gap-3 border-b-[3px] border-double border-rule pb-2">
      <h2 className="text-2xl text-ink">{title}</h2>
      {action}
    </div>
    {children}
  </motion.section>
)

/** "See all" link: red on paper, light over a photo header (`light`). */
const MoreLink = ({ to, children, light = false }: { to: string; children: ReactNode; light?: boolean }) => (
  <Link to={to} className={cn('group inline-flex items-center gap-1 text-sm font-semibold', light ? 'text-paper/90 hover:text-paper' : 'text-stamp')}>
    {children}
    <ArrowLeft className="size-4 transition-transform duration-200 rtl:group-hover:-translate-x-1 ltr:group-hover:translate-x-1 ltr:-scale-x-100" aria-hidden="true" />
  </Link>
)

/** The dashboard's looks: numbers on law photos, numbers inside the banner, or the desk (folders and paper). */
const LOOKS = ['photos', 'band', 'desk'] as const

const STAT_TONES = {
  red: 'bg-stamp text-paper',
  navy: 'bg-desk text-paper',
  blue: 'bg-stamp-blue text-paper',
  slate: 'bg-manila-deep text-paper',
} as const

type StatProps = { icon: LucideIcon; label: string; value: number; tone: keyof typeof STAT_TONES; to: string; photo: number; delay: number }

const photoUrl = (index: number, width: number) => `${LAW_PHOTOS[index % LAW_PHOTOS.length]!.src}?auto=format&fit=crop&w=${width}&q=70`

/** One number on a law photograph: the count and its label in light writing over a navy wash. */
const PhotoStat = ({ icon: Icon, label, value, to, photo, delay }: StatProps) => (
  <motion.div {...arrive(delay)}>
    <Link to={to} className="card-edge group desk relative flex h-40 overflow-hidden rounded-2xl p-5 text-paper shadow-[0_14px_30px_-16px_rgb(6_29_51/0.7)]">
      <img src={photoUrl(photo, 640)} alt="" referrerPolicy="no-referrer" className="photo-card-img absolute inset-0 size-full object-cover opacity-70 transition-transform duration-700 group-hover:scale-105" />
      <div aria-hidden="true" className="photo-wash absolute inset-0" />
      <div className="relative mt-auto flex w-full items-end justify-between gap-3">
        <span>
          <span className="block font-doc text-5xl leading-none font-bold tabular-nums">
            <CountUp value={value} />
          </span>
          <span className="mt-1.5 block text-sm text-paper/85">{label}</span>
        </span>
        {/* always red: a navy or slate square would vanish into the photo's navy wash */}
        <span className="photo-chip grid size-10 shrink-0 place-items-center rounded-xl bg-stamp text-paper">
          <Icon className="size-5" aria-hidden="true" />
        </span>
      </div>
    </Link>
  </motion.div>
)

/** The four numbers as one row of frosted panes along the bottom of the welcome banner. */
const BannerStats = ({ stats }: { stats: StatProps[] }) => (
  <div className="relative mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-paper/15 bg-paper/15 lg:grid-cols-4">
    {stats.map(({ icon: Icon, label, value, to }) => (
      <Link key={label} to={to} className="flex items-center gap-3 bg-desk/60 p-4 backdrop-blur-sm transition-colors hover:bg-desk/40">
        <Icon className="size-5 shrink-0 text-paper/70" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block font-doc text-4xl leading-none font-bold text-paper tabular-nums">
            <CountUp value={value} />
          </span>
          <span className="mt-1 block truncate text-xs text-paper/75">{label}</span>
        </span>
      </Link>
    ))}
  </div>
)

/** One number as a case-file folder: the label on its coloured tab, the count written on the folder. */
const Stat = ({ icon: Icon, label, value, tone, to, delay }: StatProps) => (
  <motion.div {...arrive(delay)}>
    <Link to={to} className="group relative block pt-7 transition-transform duration-300 hover:-translate-y-1">
      <span className={cn('tab-cut absolute top-0 start-4 flex h-8 max-w-[calc(100%-2rem)] items-center gap-2 rounded-t-md px-7 text-xs font-semibold whitespace-nowrap', STAT_TONES[tone])}>
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
      <span className="manila relative flex min-h-28 items-end overflow-hidden rounded-md rounded-ss-none p-5 transition-shadow duration-300 group-hover:shadow-lifted">
        <span className="font-doc text-6xl leading-none font-bold text-ink tabular-nums">
          <CountUp value={value} />
        </span>
        <Icon className="absolute -bottom-3 end-3 size-20 text-ink/[0.07]" aria-hidden="true" />
      </span>
    </Link>
  </motion.div>
)

/** A legal pad: the glued top edge, the red margin line, and its items written on the ruled lines. */
const Pad = ({ title, action, children, delay = 0 }: BoxProps) => (
  <motion.section {...arrive(delay)} className="paper overflow-hidden rounded-md">
    <div aria-hidden="true" className="h-3 bg-stamp-deep" />
    <div className="relative pe-5 ps-11 pt-5 pb-3 sm:pe-6">
      <span aria-hidden="true" className="absolute inset-y-0 start-8 w-0.5 bg-margin" />
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-2xl text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  </motion.section>
)

const BAR_COLOUR: Record<string, string> = {
  open: 'bg-stamp-blue',
  in_progress: 'bg-stamp',
  on_hold: 'bg-manila-deep',
  closed: 'bg-desk',
  cancelled: 'bg-ink-faint',
}

/** Cases by status: one bar per status, growing to its share when the card arrives. */
const StatusBars = ({ cases }: { cases: LegalCase[] }) => {
  const total = cases.length
  return (
    <ul className="space-y-4">
      {Object.entries(CASE_STATUS).map(([status, { text }], index) => {
        const count = cases.filter((row) => row.status === status).length
        const share = total ? Math.round((count / total) * 100) : 0
        return (
          <li key={status}>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="font-semibold text-ink">{text}</span>
              <span className="text-ink-soft tabular-nums">
                {count} <span className="text-ink-faint">({share}%)</span>
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-ink/8">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${share}%` }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.3 + index * 0.08 }}
                className={cn('h-full rounded-full', BAR_COLOUR[status])}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Share of tasks completed, drawn as a ring; with `seal`, inside the thin double edge of a round seal. */
const ProgressRing = ({ done, total, seal = false }: { done: number; total: number; seal?: boolean }) => {
  const share = total ? done / total : 0
  const length = 2 * Math.PI * 40
  return (
    <div className="relative mx-auto size-40">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        {seal && <circle cx="50" cy="50" r="48.5" fill="none" strokeWidth="1" className="stroke-stamp/35" />}
        {seal && <circle cx="50" cy="50" r="31" fill="none" strokeWidth="1" strokeDasharray="1.5 2.5" className="stroke-stamp/45" />}
        <circle cx="50" cy="50" r="40" fill="none" strokeWidth="9" className="stroke-ink/8" />
        <motion.circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          className="stroke-stamp"
          strokeDasharray={length}
          initial={{ strokeDashoffset: length }}
          animate={{ strokeDashoffset: length * (1 - share) }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.4 }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="font-doc text-4xl leading-none font-bold text-ink tabular-nums">
            <CountUp value={Math.round(share * 100)} />%
          </p>
          <p className="mt-1 text-xs text-ink-soft">مُنجز</p>
        </div>
      </div>
    </div>
  )
}

/** One open task: tick it to complete it. */
const TaskRow = ({ task }: { task: Task }) => {
  const queryClient = useQueryClient()
  const toggle = useMutation({
    mutationFn: () => api.patch(`/tasks/${task.task_id}`, { status: 'completed' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
  const late = task.due_at !== null && new Date(task.due_at) < new Date()
  const hot = task.priority === 'urgent' || task.priority === 'high'
  return (
    <motion.li layout exit={{ opacity: 0, x: -30 }} className="flex items-start gap-3 py-3">
      <input type="checkbox" checked={false} disabled={toggle.isPending} onChange={() => toggle.mutate()} aria-label={`أنجز: ${task.title}`} className="mt-1 size-4 shrink-0 cursor-pointer accent-stamp" />
      <div className="min-w-0 flex-1">
        <p className="leading-snug font-semibold text-ink">{task.title}</p>
        <p className="mt-0.5 text-xs text-ink-faint">{task.assigned_to_name}</p>
      </div>
      <Pill tone={late || hot ? 'red' : 'ink'}>{dueLabel(task.due_at)}</Pill>
    </motion.li>
  )
}

/* ───────────────────────── dashboard ───────────────────────── */

const greeting = () => {
  const hour = new Date().getHours()
  return hour < 12 ? 'صباح الخير' : hour < 18 ? 'مساء الخير' : 'مساء الخير'
}

export const Today = () => {
  const { session } = useAuth()
  const owner = personaOf(session) === 'owner'
  const cases = useCases()
  const tasks = useTasks()
  const clients = useClients()

  const allCases = cases.data ?? []
  const allTasks = tasks.data ?? []
  const openCases = allCases.filter((row) => row.status !== 'closed' && row.status !== 'cancelled')
  const openTasks = allTasks.filter((task) => task.status === 'pending' || task.status === 'in_progress')
  const doneTasks = allTasks.filter((task) => task.status === 'completed')
  const lateTasks = openTasks.filter((task) => task.due_at && new Date(task.due_at) < new Date())
  const nextTasks = [...openTasks].sort((a, b) => (a.due_at ?? '9').localeCompare(b.due_at ?? '9')).slice(0, 5)
  const firstName = session?.user.full_name.split(' ')[0]

  // Three looks to compare (?look=photos|band|desk) until one is chosen.
  const [lookParam] = useParam('look')
  const look = oneOf(lookParam, LOOKS, 'photos')
  const desk = look === 'desk'
  const CasesBox = desk ? Folder : Card
  const SheetBox = desk ? Sheet : Card
  const TasksBox = desk ? Pad : Card
  const stats: StatProps[] = [
    { icon: Briefcase, tone: 'red', label: owner ? 'قضايا مفتوحة في المكتب' : 'قضاياك المفتوحة', value: openCases.length, to: '/office/cases', photo: 1, delay: 0.05 },
    { icon: ListChecks, tone: 'navy', label: 'مهام بانتظار الإنجاز', value: openTasks.length, to: '/office/tasks', photo: 2, delay: 0.1 },
    { icon: CalendarClock, tone: lateTasks.length ? 'red' : 'blue', label: 'مهام متأخرة', value: lateTasks.length, to: '/office/tasks', photo: 0, delay: 0.15 },
    { icon: Users, tone: 'slate', label: owner ? 'موكّلو المكتب' : 'الموكّلون', value: clients.data?.length ?? 0, to: '/office/clients', photo: 4, delay: 0.2 },
  ]

  return (
    <div className="space-y-6">
      {/* welcome banner */}
      <motion.section
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className={cn('card-edge desk relative overflow-hidden rounded-3xl px-6 sm:px-9', look === 'band' ? 'pt-8 pb-6 sm:pt-10 sm:pb-7' : 'py-8 sm:py-10')}
      >
        <img src={photoUrl(3, 1400)} alt="" referrerPolicy="no-referrer" className={cn('lit-photo absolute inset-0 size-full object-cover', look === 'band' ? 'opacity-55' : 'opacity-35')} />
        <div aria-hidden="true" className="banner-wash absolute inset-0" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-sm text-paper/70">{formatDay(new Date())}</p>
            <h1 className="mt-1 text-4xl text-paper sm:text-[2.75rem]">
              {greeting()}، {firstName}
            </h1>
            <p className="mt-2 max-w-md leading-relaxed text-paper/80">
              {openTasks.length === 0
                ? 'لا مهام مفتوحة الآن.'
                : `لديك ${openTasks.length} مهام مفتوحة${lateTasks.length ? `، منها ${lateTasks.length} متأخرة` : ''}، و${openCases.length} قضايا قيد العمل.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/office/cases" className={buttonClass('stamp')}>
              <Briefcase className="size-4" aria-hidden="true" />
              القضايا
            </Link>
            <Link to="/office/tasks" className={buttonClass('paperline')}>
              <ListChecks className="size-4" aria-hidden="true" />
              المهام
            </Link>
          </div>
        </div>
        {look === 'band' && <BannerStats stats={stats} />}
      </motion.section>

      {/* numbers */}
      {look !== 'band' && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (desk ? <Stat key={stat.label} {...stat} /> : <PhotoStat key={stat.label} {...stat} />))}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <CasesBox title="آخر القضايا" delay={0.25} photo="library" action={<MoreLink to="/office/cases" light={!desk}>كل القضايا</MoreLink>}>
            {cases.isPending ? <Loading /> : cases.isError ? <Failed error={cases.error} /> : allCases.length === 0 ? <Empty>لا قضايا بعد.</Empty> : <CasesTable rows={allCases.slice(0, 5)} />}
          </CasesBox>
          <SheetBox title="القضايا حسب الحالة" delay={0.3} photo="justice" clip>
            {cases.isPending ? <Loading /> : cases.isError ? <Failed error={cases.error} /> : <StatusBars cases={allCases} />}
          </SheetBox>
        </div>

        <div className="space-y-6">
          <SheetBox title="إنجاز المهام" delay={0.3} photo="signing">
            <ProgressRing done={doneTasks.length} total={doneTasks.length + openTasks.length} seal={desk} />
            <div className="mt-6 grid grid-cols-2 gap-3 text-center">
              {[
                [doneTasks.length, 'منجزة'],
                [openTasks.length, 'مفتوحة'],
              ].map(([count, text]) => (
                <div key={text} className={cn('p-3', desk ? 'rounded-md border border-rule' : 'rounded-xl bg-paper-shade')}>
                  <p className="font-doc text-3xl leading-none font-bold text-ink tabular-nums">{count}</p>
                  <p className="mt-1 text-xs text-ink-soft">{text}</p>
                </div>
              ))}
            </div>
          </SheetBox>
          <TasksBox title={owner ? 'أقرب مهام المكتب' : 'أقرب مهامك'} delay={0.35} photo="writing" action={<MoreLink to="/office/tasks" light={!desk}>كل المهام</MoreLink>}>
            {tasks.isPending ? (
              <Loading />
            ) : tasks.isError ? (
              <Failed error={tasks.error} />
            ) : nextTasks.length === 0 ? (
              <Empty>لا مهام مفتوحة.</Empty>
            ) : (
              <ul className={desk ? 'divide-y divide-rule border-t border-rule' : 'divide-y divide-ink/8'}>
                {nextTasks.map((task) => (
                  <TaskRow key={task.task_id} task={task} />
                ))}
              </ul>
            )}
          </TasksBox>
        </div>
      </div>
    </div>
  )
}
