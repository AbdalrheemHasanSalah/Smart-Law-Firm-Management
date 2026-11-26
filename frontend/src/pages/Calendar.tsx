import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Gavel, ListChecks, Plus, Receipt, Users, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { PATHS, personaOf, useAuth } from '@/auth/auth'
import { api, messageOf } from '@/lib/api'
import { formatDay, formatMoney, formatTime, PRIORITY, ROLE } from '@/lib/labels'
import { useParam } from '@/lib/useParam'
import type { Client, Member } from '@/lib/types'
import { FormActions, Modal, SelectField, TextArea } from '@/ui/forms'
import { Button, cn, Field } from '@/ui/kit'
import { Failed, Loading, SheetHeader } from '@/ui/Shell'
import { useCases } from './Office'
import { LOCALE } from '@/lib/i18n'

type Kind = 'hearing' | 'appointment' | 'task' | 'invoice'

type CalendarEvent = {
  kind: Kind
  id: string
  at: string
  ends_at?: string
  status: string
  title: string
  case_id: string | null
  case_number: string | null
  details: Record<string, string | number | null>
}

/** Each kind keeps one colour everywhere on the page: the chip, the dot and the legend. */
const KIND: Record<Kind, { label: string; icon: LucideIcon; chip: string; dot: string }> = {
  hearing: { label: 'جلسات المحاكم', icon: Gavel, chip: 'bg-stamp/10 text-stamp', dot: 'bg-stamp' },
  appointment: { label: 'مواعيد الموكّلين', icon: Users, chip: 'bg-stamp-blue/10 text-stamp-blue', dot: 'bg-stamp-blue' },
  task: { label: 'مواعيد المهام', icon: ListChecks, chip: 'bg-ink/8 text-ink', dot: 'bg-ink' },
  invoice: { label: 'استحقاق المطالبات', icon: Receipt, chip: 'bg-stamp-green/15 text-stamp-green', dot: 'bg-stamp-green' },
}
const KINDS = Object.keys(KIND) as Kind[]

const HEARING_STATUS: Record<string, string> = { scheduled: 'مجدولة', completed: 'انعقدت', postponed: 'أُجّلت', cancelled: 'أُلغيت' }
const APPOINTMENT_STATUS: Record<string, string> = { scheduled: 'مجدول', confirmed: 'مؤكَّد', completed: 'تمّ', cancelled: 'أُلغي', no_show: 'لم يحضر' }
const HEARING_TYPES = ['مرافعة', 'تقديم بيّنات', 'سماع شهود', 'خبرة', 'حكم', 'أولى', 'تسوية']

// The week in Palestine starts on Saturday.
const WEEKDAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة']
const monthFormat = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' })

const pad = (value: number) => String(value).padStart(2, '0')
/** A local calendar day as YYYY-MM-DD. */
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const parseDay = (key: string) => {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
/** Six weeks from the Saturday on or before the first of the month. */
const monthGrid = (month: Date) => {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = addDays(first, -((first.getDay() + 1) % 7))
  return Array.from({ length: 42 }, (_, index) => addDays(start, index))
}
/** An invoice falls due on a date; the rest happen at a time of day. */
const hasTime = (event: CalendarEvent) => event.kind !== 'invoice'

const useCalendar = (from: string, to: string) =>
  useQuery({
    queryKey: ['calendar', from, to],
    queryFn: async () => (await api.get<{ events: CalendarEvent[] }>('/calendar', { params: { from, to } })).data.events,
  })

/* ───────────────────────── scheduling ───────────────────────── */

const NewHearing = ({ open, day, onClose }: { open: boolean; day: string; onClose: () => void }) => {
  const queryClient = useQueryClient()
  const cases = useCases()
  const empty = { caseId: '', date: day, time: '09:00', type: HEARING_TYPES[0], room: '', notes: '' }
  const [values, setValues] = useState(empty)
  useEffect(() => {
    if (open) setValues({ ...empty, date: day })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, day])
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const create = useMutation({
    mutationFn: () =>
      api.post('/calendar/hearings', {
        case_id: values.caseId,
        hearing_at: new Date(`${values.date}T${values.time}`).toISOString(),
        hearing_type: values.type,
        ...(values.room.trim() ? { court_room: values.room.trim() } : {}),
        ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
      onClose()
    },
  })
  const openCases = (cases.data ?? []).filter((row) => row.status !== 'closed' && row.status !== 'cancelled')
  return (
    <Modal open={open} onClose={onClose} title="جلسة جديدة">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <SelectField label="القضية" name="case" required className="sm:col-span-2" value={values.caseId} onChange={set('caseId')} options={[['', 'اختر قضية'], ...openCases.map((row) => [row.case_id, `${row.case_number} — ${row.title}`] as const)]} />
        <Field label="اليوم" name="date" type="date" dir="ltr" required value={values.date} onChange={set('date')} />
        <Field label="الساعة" name="time" type="time" dir="ltr" required value={values.time} onChange={set('time')} />
        <SelectField label="نوع الجلسة" name="type" value={values.type} onChange={set('type')} options={HEARING_TYPES.map((type) => [type, type] as const)} />
        <Field label="القاعة (اختياري)" name="room" value={values.room} onChange={set('room')} />
        <TextArea label="ملاحظات (اختياري)" name="notes" rows={2} value={values.notes} onChange={set('notes')} className="sm:col-span-2" />
        <div className="sm:col-span-2">
          <FormActions error={create.isError ? messageOf(create.error) : null}>
            <Button variant="line" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" variant="ink" disabled={!values.caseId || !values.date || !values.time || create.isPending}>
              {create.isPending ? 'تُحفظ…' : 'احفظ الجلسة'}
            </Button>
          </FormActions>
        </div>
      </form>
    </Modal>
  )
}

const NewAppointment = ({ open, day, onClose }: { open: boolean; day: string; onClose: () => void }) => {
  const queryClient = useQueryClient()
  const cases = useCases()
  const clients = useQuery({ queryKey: ['clients'], enabled: open, queryFn: async () => (await api.get<{ clients: Client[] }>('/clients', { params: { pageSize: 50 } })).data.clients })
  const members = useQuery({ queryKey: ['members'], enabled: open, queryFn: async () => (await api.get<{ users: Member[] }>('/users', { params: { pageSize: 50 } })).data.users })
  const empty = { clientId: '', userId: '', caseId: '', date: day, start: '10:00', end: '11:00', purpose: '', location: '' }
  const [values, setValues] = useState(empty)
  useEffect(() => {
    if (open) setValues({ ...empty, date: day })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, day])
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const staff = (members.data ?? []).filter((member) => member.role !== 'client' && member.status === 'active')
  const create = useMutation({
    mutationFn: () =>
      api.post('/calendar/appointments', {
        client_id: values.clientId,
        user_id: values.userId,
        starts_at: new Date(`${values.date}T${values.start}`).toISOString(),
        ends_at: new Date(`${values.date}T${values.end}`).toISOString(),
        purpose: values.purpose.trim(),
        ...(values.caseId ? { case_id: values.caseId } : {}),
        ...(values.location.trim() ? { location: values.location.trim() } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
      onClose()
    },
  })
  const badTime = values.end <= values.start
  return (
    <Modal open={open} onClose={onClose} title="موعد مع موكّل">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field label="الغرض" name="purpose" required placeholder="استشارة، توقيع وكالة، مراجعة ملف…" value={values.purpose} onChange={set('purpose')} className="sm:col-span-2" />
        <SelectField label="الموكّل" name="client" required value={values.clientId} onChange={set('clientId')} options={[['', 'اختر موكّلاً'], ...(clients.data ?? []).map((client) => [client.client_id, client.full_name_or_org] as const)]} />
        <SelectField label="من المكتب" name="staff" required value={values.userId} onChange={set('userId')} options={[['', 'اختر عضواً'], ...staff.map((member) => [member.user_id, `${member.full_name} — ${ROLE[member.role]}`] as const)]} />
        <Field label="اليوم" name="date" type="date" dir="ltr" required value={values.date} onChange={set('date')} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="من" name="start" type="time" dir="ltr" required value={values.start} onChange={set('start')} />
          <Field label="إلى" name="end" type="time" dir="ltr" required value={values.end} onChange={set('end')} error={badTime ? 'بعد البداية' : undefined} />
        </div>
        <SelectField label="القضية (اختياري)" name="case" value={values.caseId} onChange={set('caseId')} options={[['', 'بدون قضية'], ...(cases.data ?? []).map((row) => [row.case_id, `${row.case_number} — ${row.title}`] as const)]} />
        <Field label="المكان (اختياري)" name="location" placeholder="المكتب، المحكمة، عن بُعد…" value={values.location} onChange={set('location')} />
        <div className="sm:col-span-2">
          <FormActions error={create.isError ? messageOf(create.error) : null}>
            <Button variant="line" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" variant="ink" disabled={!values.clientId || !values.userId || !values.purpose.trim() || badTime || create.isPending}>
              {create.isPending ? 'يُحفظ…' : 'احفظ الموعد'}
            </Button>
          </FormActions>
        </div>
      </form>
    </Modal>
  )
}

/* ───────────────────────── the day's agenda ───────────────────────── */

const StatusSelect = ({ event }: { event: CalendarEvent }) => {
  const queryClient = useQueryClient()
  const labels = event.kind === 'hearing' ? HEARING_STATUS : APPOINTMENT_STATUS
  const update = useMutation({
    mutationFn: (status: string) => api.patch(`/calendar/${event.kind === 'hearing' ? 'hearings' : 'appointments'}/${event.id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar'] }),
  })
  return (
    <span className="inline-flex flex-col items-end">
      <select
        aria-label="الحالة"
        value={event.status}
        disabled={update.isPending}
        onChange={(change) => update.mutate(change.target.value)}
        className="rounded-md border border-ink/20 bg-transparent px-2 py-1 text-xs text-ink"
      >
        {Object.entries(labels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {update.isError && <span className="mt-1 text-xs text-stamp">{messageOf(update.error)}</span>}
    </span>
  )
}

const EventDetails = ({ event }: { event: CalendarEvent }) => {
  const d = event.details
  const parts: (string | null)[] =
    event.kind === 'hearing'
      ? [d.case_title as string, d.court_name ? `محكمة ${d.court_name}` : null, d.court_room ? `قاعة ${d.court_room}` : null, d.notes as string]
      : event.kind === 'appointment'
        ? [`مع ${d.client_name}`, `${d.staff_name} من المكتب`, d.location as string]
        : event.kind === 'task'
          ? [d.private ? null : `المسؤول: ${d.assignee_name}`, PRIORITY[String(d.priority)] ? `أولوية ${PRIORITY[String(d.priority)]?.text}` : null]
          : [String(d.client_name), formatMoney(Number(d.amount), String(d.currency))]
  return <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{parts.filter(Boolean).join(' · ')}</p>
}

const Agenda = ({ day, events, owner }: { day: string; events: CalendarEvent[]; owner: boolean }) => (
  <section aria-label="جدول اليوم" className="rounded-2xl border border-ink/12 bg-paper p-4">
    <h2 className="text-lg text-ink">{formatDay(parseDay(day))}</h2>
    {events.length === 0 ? (
      <p className="mt-3 text-sm text-ink-faint">لا شيء في هذا اليوم.</p>
    ) : (
      <ol className="mt-3 space-y-3">
        {events.map((event) => {
          const kind = KIND[event.kind]
          const Icon = kind.icon
          const closed = ['cancelled', 'completed', 'no_show'].includes(event.status)
          return (
            <li key={`${event.kind}-${event.id}`} className={cn('flex gap-3', closed && 'opacity-60')}>
              <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-full', kind.chip)}>
                <Icon className="size-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink-soft tabular-nums">
                      {hasTime(event) ? (
                        <bdi>
                          {formatTime(event.at)}
                          {event.ends_at ? ` – ${formatTime(event.ends_at)}` : ''}
                        </bdi>
                      ) : (
                        'خلال اليوم'
                      )}
                    </p>
                    <p className={cn('font-semibold text-ink', closed && 'line-through')}>{event.title}</p>
                  </div>
                  {owner && (event.kind === 'hearing' || event.kind === 'appointment') && <StatusSelect event={event} />}
                  {event.kind === 'task' && Boolean(event.details.private) && <span className="shrink-0 rounded-full bg-ink/8 px-2 py-0.5 text-[11px] font-semibold text-ink-soft">خاصة</span>}
                </div>
                <EventDetails event={event} />
                {event.case_id && (
                  <Link to={`${PATHS.office}/cases/${event.case_id}`} className="mt-1 inline-block text-xs font-semibold text-stamp-blue underline-offset-4 hover:underline">
                    ملف القضية <bdi dir="ltr">{event.case_number}</bdi>
                  </Link>
                )}
                {event.kind === 'task' && !event.case_id && (
                  <Link to={`${PATHS.office}/tasks`} className="mt-1 inline-block text-xs font-semibold text-stamp-blue underline-offset-4 hover:underline">
                    المهام
                  </Link>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    )}
  </section>
)

/* ───────────────────────── the page ───────────────────────── */

/** The office calendar: hearings, client appointments, task deadlines and claims falling due. */
export const Calendar = () => {
  // The owner sees the whole office and schedules; a lawyer or assistant sees their own work.
  const owner = personaOf(useAuth().session) === 'owner'
  const kinds = owner ? KINDS : KINDS.filter((kind) => kind !== 'invoice')
  const today = dayKey(new Date())
  const [dayParam, setDayParam] = useParam('day')
  const selected = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : today
  const [month, setMonth] = useState(() => {
    const date = parseDay(selected)
    return new Date(date.getFullYear(), date.getMonth(), 1)
  })
  const [hidden, setHidden] = useState<Kind[]>([])
  const [adding, setAdding] = useState<'hearing' | 'appointment' | null>(null)

  const grid = useMemo(() => monthGrid(month), [month])
  const calendar = useCalendar(dayKey(grid[0] ?? month), dayKey(grid[grid.length - 1] ?? month))
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of calendar.data ?? []) {
      if (hidden.includes(event.kind)) continue
      const key = dayKey(new Date(event.at))
      map.set(key, [...(map.get(key) ?? []), event])
    }
    return map
  }, [calendar.data, hidden])

  const select = (key: string) => setDayParam(key === today ? null : key)
  const shiftMonth = (by: number) => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + by, 1))
  const goToday = () => {
    setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
    setDayParam(null)
  }
  const monthEvents = (calendar.data ?? []).filter((event) => {
    const date = new Date(event.at)
    return date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear()
  })
  const counts = Object.fromEntries(kinds.map((kind) => [kind, monthEvents.filter((event) => event.kind === kind).length])) as Record<Kind, number>

  return (
    <>
      <SheetHeader
        title="التقويم"
        note={owner ? 'جلسات المحاكم ومواعيد الموكّلين ومواعيد المهام واستحقاق المطالبات في مكان واحد.' : 'جلسات قضاياك ومواعيدك مع الموكّلين ومواعيد مهامك. يحدّد مدير المكتب الجلسات والمواعيد.'}
        action={
          owner && <div className="flex flex-wrap gap-2">
            <Button variant="stamp" size="sm" onClick={() => setAdding('hearing')}>
              <Plus className="size-4" aria-hidden="true" />
              جلسة جديدة
            </Button>
            <Button variant="line" size="sm" onClick={() => setAdding('appointment')}>
              <Plus className="size-4" aria-hidden="true" />
              موعد مع موكّل
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => shiftMonth(-1)} aria-label="الشهر السابق">
            <ChevronRight className="size-4 ltr:-scale-x-100" aria-hidden="true" />
          </Button>
          <h2 className="min-w-36 text-center text-xl text-ink">{monthFormat.format(month)}</h2>
          <Button variant="ghost" size="sm" onClick={() => shiftMonth(1)} aria-label="الشهر التالي">
            <ChevronLeft className="size-4 ltr:-scale-x-100" aria-hidden="true" />
          </Button>
          <Button variant="line" size="sm" onClick={goToday}>
            اليوم
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="ما يظهر في التقويم">
          {kinds.map((kind) => {
            const shown = !hidden.includes(kind)
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={shown}
                onClick={() => setHidden((current) => (shown ? [...current, kind] : current.filter((entry) => entry !== kind)))}
                className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors', shown ? 'border-ink/15 text-ink' : 'border-dashed border-ink/20 text-ink-faint')}
              >
                <span className={cn('size-2 rounded-full', shown ? KIND[kind].dot : 'bg-ink/20')} aria-hidden="true" />
                {KIND[kind].label}
                <span className="tabular-nums text-ink-faint">{counts[kind]}</span>
              </button>
            )
          })}
        </div>
      </div>

      {calendar.isError ? (
        <Failed error={calendar.error} />
      ) : (
        <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="relative overflow-hidden rounded-2xl border border-ink/12">
            {calendar.isPending && (
              <div className="absolute inset-0 z-10 grid place-items-center bg-paper/60">
                <Loading />
              </div>
            )}
            <div className="grid grid-cols-7 border-b border-ink/12 bg-paper-shade">
              {WEEKDAYS.map((weekday) => (
                <div key={weekday} className="py-2 text-center text-xs font-semibold text-ink-soft">
                  <span className="hidden sm:inline">{weekday}</span>
                  <span className="sm:hidden">{weekday.replace('ال', '').slice(0, 2)}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {grid.map((date) => {
                const key = dayKey(date)
                const events = byDay.get(key) ?? []
                const inMonth = date.getMonth() === month.getMonth()
                const isToday = key === today
                const isSelected = key === selected
                const friday = date.getDay() === 5
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => select(key)}
                    aria-pressed={isSelected}
                    aria-label={`${formatDay(date)}${events.length ? `، ${events.length} بنود` : ''}`}
                    className={cn(
                      'flex min-h-16 flex-col items-stretch gap-1 border-e border-b border-ink/8 p-1.5 text-start transition-colors sm:min-h-28 sm:p-2 [&:nth-child(7n)]:border-e-0',
                      !inMonth && 'bg-ink/[0.025] text-ink-faint',
                      friday && inMonth && 'bg-ink/[0.02]',
                      isSelected ? 'bg-marker/40 ring-2 ring-ink ring-inset' : 'hover:bg-marker/20',
                    )}
                  >
                    <span className={cn('grid size-6 place-items-center self-start rounded-full text-xs font-semibold tabular-nums', isToday ? 'bg-stamp text-paper' : inMonth ? 'text-ink' : 'text-ink-faint')}>{date.getDate()}</span>
                    {/* Phones get dots; wider screens get the first items by name. */}
                    <span className="flex flex-wrap gap-1 sm:hidden">
                      {events.slice(0, 4).map((event) => (
                        <span key={`${event.kind}-${event.id}`} className={cn('size-1.5 rounded-full', KIND[event.kind].dot)} />
                      ))}
                    </span>
                    <span className="hidden flex-col gap-1 sm:flex">
                      {events.slice(0, 3).map((event) => (
                        <span
                          key={`${event.kind}-${event.id}`}
                          title={hasTime(event) ? `${formatTime(event.at)} — ${event.title}` : event.title}
                          className={cn('truncate rounded px-1.5 py-0.5 text-[11px] leading-tight font-semibold', KIND[event.kind].chip, ['cancelled', 'no_show'].includes(event.status) && 'line-through opacity-60')}
                        >
                          {event.title}
                        </span>
                      ))}
                      {events.length > 3 && <span className="text-[11px] text-ink-soft">+{events.length - 3} أخرى</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <Agenda day={selected} events={byDay.get(selected) ?? []} owner={owner} />
        </div>
      )}

      {owner && <NewHearing open={adding === 'hearing'} day={selected} onClose={() => setAdding(null)} />}
      {owner && <NewAppointment open={adding === 'appointment'} day={selected} onClose={() => setAdding(null)} />}
    </>
  )
}
