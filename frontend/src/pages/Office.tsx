import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Briefcase, CalendarClock, ListChecks, Users, type LucideIcon } from 'lucide-react'
import { animate, motion } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { personaOf, useAuth } from '@/auth/auth'
import { api } from '@/lib/api'
import { CASE_STATUS, CASE_TYPE, dueLabel, formatDate, formatDay, PRIORITY } from '@/lib/labels'
import type { Client, LegalCase, Task } from '@/lib/types'
import { buttonClass, cn } from '@/ui/kit'
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

const Card = ({ title, action, children, className, delay = 0 }: { title?: string; action?: ReactNode; children: ReactNode; className?: string; delay?: number }) => (
  <motion.section
    initial={{ opacity: 0, y: 24 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay }}
    className={cn('rounded-2xl border border-ink/8 bg-white p-5 shadow-[0_10px_30px_-18px_rgb(6_29_51/0.35)] sm:p-6', className)}
  >
    {title && (
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-2xl text-ink">{title}</h2>
        {action}
      </div>
    )}
    {children}
  </motion.section>
)

const MoreLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="group inline-flex items-center gap-1 text-sm font-semibold text-stamp">
    {children}
    <ArrowLeft className="size-4 transition-transform duration-200 rtl:group-hover:-translate-x-1 ltr:group-hover:translate-x-1 ltr:-scale-x-100" aria-hidden="true" />
  </Link>
)

const STAT_TONES = {
  red: 'bg-stamp text-paper',
  navy: 'bg-desk text-paper',
  blue: 'bg-stamp-blue text-paper',
  slate: 'bg-manila-deep text-paper',
} as const

const Stat = ({ icon: Icon, label, value, tone, to, delay }: { icon: LucideIcon; label: string; value: number; tone: keyof typeof STAT_TONES; to: string; delay: number }) => (
  <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay }}>
    <Link
      to={to}
      className="group flex items-center gap-4 rounded-2xl border border-ink/8 bg-white p-5 shadow-[0_10px_30px_-18px_rgb(6_29_51/0.35)] transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_18px_34px_-16px_rgb(6_29_51/0.45)]"
    >
      <span className={cn('grid size-14 shrink-0 place-items-center rounded-2xl transition-transform duration-300 group-hover:scale-110', STAT_TONES[tone])}>
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <span>
        <span className="block font-doc text-5xl leading-none font-bold text-ink tabular-nums">
          <CountUp value={value} />
        </span>
        <span className="mt-1 block text-sm text-ink-soft">{label}</span>
      </span>
    </Link>
  </motion.div>
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

/** Share of tasks completed, drawn as a ring. */
const ProgressRing = ({ done, total }: { done: number; total: number }) => {
  const share = total ? done / total : 0
  const length = 2 * Math.PI * 42
  return (
    <div className="relative mx-auto size-36">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r="42" fill="none" strokeWidth="10" className="stroke-ink/8" />
        <motion.circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          strokeWidth="10"
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

  return (
    <div className="space-y-6">
      {/* welcome banner */}
      <motion.section
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="desk relative overflow-hidden rounded-3xl px-6 py-8 sm:px-9 sm:py-10"
      >
        <img src={`${LAW_PHOTOS[3].src}?auto=format&fit=crop&w=1400&q=70`} alt="" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover opacity-35" />
        <div aria-hidden="true" className="absolute inset-0 bg-linear-to-l from-desk via-desk/75 to-desk/20" />
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
      </motion.section>

      {/* numbers */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Briefcase} tone="red" label={owner ? 'قضايا مفتوحة في المكتب' : 'قضاياك المفتوحة'} value={openCases.length} to="/office/cases" delay={0.05} />
        <Stat icon={ListChecks} tone="navy" label="مهام بانتظار الإنجاز" value={openTasks.length} to="/office/tasks" delay={0.1} />
        <Stat icon={CalendarClock} tone="blue" label="مهام متأخرة" value={lateTasks.length} to="/office/tasks" delay={0.15} />
        <Stat icon={Users} tone="slate" label={owner ? 'موكّلو المكتب' : 'الموكّلون'} value={clients.data?.length ?? 0} to="/office/clients" delay={0.2} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card title="آخر القضايا" delay={0.25} action={<MoreLink to="/office/cases">كل القضايا</MoreLink>}>
            {cases.isPending ? <Loading /> : cases.isError ? <Failed error={cases.error} /> : allCases.length === 0 ? <Empty>لا قضايا بعد.</Empty> : <CasesTable rows={allCases.slice(0, 5)} />}
          </Card>
          <Card title="القضايا حسب الحالة" delay={0.3}>
            {cases.isPending ? <Loading /> : cases.isError ? <Failed error={cases.error} /> : <StatusBars cases={allCases} />}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="إنجاز المهام" delay={0.3}>
            <ProgressRing done={doneTasks.length} total={doneTasks.length + openTasks.length} />
            <div className="mt-5 grid grid-cols-2 gap-3 text-center">
              <div className="rounded-xl bg-paper-shade p-3">
                <p className="font-doc text-3xl leading-none font-bold text-ink tabular-nums">{doneTasks.length}</p>
                <p className="mt-1 text-xs text-ink-soft">منجزة</p>
              </div>
              <div className="rounded-xl bg-paper-shade p-3">
                <p className="font-doc text-3xl leading-none font-bold text-ink tabular-nums">{openTasks.length}</p>
                <p className="mt-1 text-xs text-ink-soft">مفتوحة</p>
              </div>
            </div>
          </Card>
          <Card title={owner ? 'أقرب مهام المكتب' : 'أقرب مهامك'} delay={0.35} action={<MoreLink to="/office/tasks">كل المهام</MoreLink>}>
            {tasks.isPending ? (
              <Loading />
            ) : tasks.isError ? (
              <Failed error={tasks.error} />
            ) : nextTasks.length === 0 ? (
              <Empty>لا مهام مفتوحة.</Empty>
            ) : (
              <ul className="divide-y divide-ink/8">
                {nextTasks.map((task) => (
                  <TaskRow key={task.task_id} task={task} />
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
