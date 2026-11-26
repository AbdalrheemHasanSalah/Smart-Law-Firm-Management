import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, CalendarPlus, Calculator, ExternalLink, ListPlus, Scale } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { PATHS, personaOf, useAuth } from '@/auth/auth'
import { api, messageOf } from '@/lib/api'
import { formatDay, formatMoney, ROLE } from '@/lib/labels'
import type { CaseRelationships, Member } from '@/lib/types'
import {
  computeDeadline,
  computeLaborRights,
  deadlineIcs,
  DEADLINE_RULES,
  LABOR_SOURCE,
  OFFICIAL_LINKS,
} from '@/lib/legalTools'
import { SelectField } from '@/ui/forms'
import { Button, cn, Field, Stamp } from '@/ui/kit'
import { SheetHeader } from '@/ui/Shell'
import { useCases } from './Office'

const todayString = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const Section = ({ icon: Icon, title, note, children }: { icon: typeof Scale; title: string; note: string; children: ReactNode }) => (
  <section className="border-t-2 border-ink pt-5 first:border-t-0 first:pt-0">
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-md bg-ink text-paper">
        <Icon className="size-5" />
      </span>
      <div>
        <h2 className="text-2xl text-ink">{title}</h2>
        <p className="mt-0.5 text-sm text-ink-soft">{note}</p>
      </div>
    </div>
    <div className="mt-5">{children}</div>
  </section>
)

const Disclaimer = ({ source }: { source: string }) => (
  <p className="mt-3 text-xs leading-relaxed text-ink-faint">
    المرجع: {source}. النتيجة استرشادية لتسهيل العمل، وتجب مراجعتها مع نص القانون وظروف الملف قبل الاعتماد عليها.
  </p>
)

/* ───────────────────────── appeal deadline ───────────────────────── */

const DeadlineTool = () => {
  const { session } = useAuth()
  const owner = personaOf(session) === 'owner'
  const queryClient = useQueryClient()
  const cases = useCases()
  const [judgmentDay, setJudgmentDay] = useState('')
  const [ruleKey, setRuleKey] = useState(DEADLINE_RULES[0]!.key)
  const [extend, setExtend] = useState(true)
  const [caseId, setCaseId] = useState('')
  const rule = DEADLINE_RULES.find((entry) => entry.key === ruleKey) ?? DEADLINE_RULES[0]!
  const result = judgmentDay ? computeDeadline(judgmentDay, rule, extend) : null
  const caseRow = (cases.data ?? []).find((row) => row.case_id === caseId)

  // Tasks go to a lawyer or assistant; for a case, to someone on that case (the backend checks it).
  const members = useQuery({
    queryKey: ['members'],
    enabled: owner && !caseId,
    queryFn: async () => (await api.get<{ users: Member[] }>('/users', { params: { pageSize: 50 } })).data.users,
  })
  const caseTeam = useQuery({
    queryKey: ['relationships', caseId],
    enabled: owner && Boolean(caseId),
    queryFn: async () => (await api.get<{ relationships: CaseRelationships }>(`/cases/${caseId}/relationships`)).data.relationships,
  })
  const candidates: { user_id: string; label: string; lead: boolean }[] = caseId
    ? (caseTeam.data?.assigned_staff ?? [])
        .filter((staff) => staff.user_id && (staff.role === 'lawyer' || staff.role === 'assistant'))
        .map((staff) => ({ user_id: staff.user_id!, label: `${staff.full_name} — ${ROLE[staff.role!]}`, lead: Boolean(staff.is_lead) }))
    : (members.data ?? [])
        .filter((member) => (member.role === 'lawyer' || member.role === 'assistant') && member.status === 'active')
        .map((member) => ({ user_id: member.user_id, label: `${member.full_name} — ${ROLE[member.role]}`, lead: false }))
  const [chosenAssignee, setAssignee] = useState('')
  const assignee = candidates.some((entry) => entry.user_id === chosenAssignee)
    ? chosenAssignee
    : (candidates.find((entry) => entry.lead) ?? candidates[0])?.user_id ?? ''
  const title = `آخر موعد: ${rule.label}${caseRow ? ` — ${caseRow.case_number}` : ''}`
  const description = `تاريخ الحكم ${judgmentDay}. المدة ${rule.days} يوماً حسب ${rule.source}. محسوبة بأداة المهل في قضيتي، وتجب مراجعتها.`

  const createTask = useMutation({
    mutationFn: () =>
      api.post('/tasks', {
        title,
        priority: 'urgent',
        assigned_to_user_id: assignee,
        description,
        // The end of the last working hours of the last day.
        due_at: new Date(`${result!.lastDay}T14:00:00`).toISOString(),
        ...(caseId ? { case_id: caseId } : {}),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const downloadIcs = () => {
    const blob = new Blob([deadlineIcs(title, result!.lastDay, description)], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = Object.assign(document.createElement('a'), { href: url, download: `deadline-${result!.lastDay}.ics` })
    link.click()
    URL.revokeObjectURL(url)
  }

  const tone = !result ? 'ink' : result.daysLeft < 0 ? 'red' : result.daysLeft <= 7 ? 'red' : 'blue'

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="نوع الطعن"
          name="rule"
          value={ruleKey}
          onChange={(event) => setRuleKey(event.target.value)}
          options={DEADLINE_RULES.map((entry) => [entry.key, `${entry.label} — ${entry.days} يوماً`] as const)}
          className="sm:col-span-2"
        />
        <Field label="تاريخ صدور الحكم أو تبليغه" name="judgment" type="date" dir="ltr" value={judgmentDay} max={todayString()} onChange={(event) => setJudgmentDay(event.target.value)} />
        <SelectField
          label="القضية (اختياري)"
          name="case"
          value={caseId}
          onChange={(event) => {
            setCaseId(event.target.value)
            createTask.reset()
          }}
          options={[['', 'بدون قضية'], ...(cases.data ?? []).map((row) => [row.case_id, `${row.case_number} — ${row.title}`] as const)]}
        />
        {owner && (
          <SelectField
            label={caseId ? 'المسؤول عن المهلة (من فريق القضية)' : 'المسؤول عن المهلة'}
            name="assignee"
            value={assignee}
            onChange={(event) => {
              setAssignee(event.target.value)
              createTask.reset()
            }}
            options={candidates.length ? candidates.map((entry) => [entry.user_id, entry.label] as const) : [['', caseId ? 'لا محامٍ أو مساعد مسند لهذه القضية' : 'لا أعضاء في الفريق']]}
            className="sm:col-span-2"
          />
        )}
        <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
          <input type="checkbox" checked={extend} onChange={(event) => setExtend(event.target.checked)} className="size-4 accent-[var(--color-stamp)]" />
          إذا صادف آخر يوم عطلة الجمعة يمتد الموعد إلى اليوم التالي
        </label>
      </div>

      <div className="rounded-md border border-ink/20 bg-paper/60 p-5">
        {!result ? (
          <p className="text-sm text-ink-soft">اختر نوع الطعن وأدخل تاريخ الحكم لحساب آخر يوم لتقديمه.</p>
        ) : (
          <>
            <p className="text-xs font-semibold text-ink-soft">آخر يوم لتقديم الطعن</p>
            <p className="mt-1 text-3xl text-ink">{formatDay(`${result.lastDay}T12:00:00`)}</p>
            <div className="mt-3">
              <Stamp key={`${result.lastDay}-${result.daysLeft}`} slam="mount" tone={tone} className="text-lg">
                {result.daysLeft < 0 ? 'انقضت المهلة' : result.daysLeft === 0 ? 'اليوم آخر يوم' : `باقي ${result.daysLeft} يوماً`}
              </Stamp>
            </div>
            {result.movedFromHoliday && <p className="mt-3 text-xs text-stamp-blue">صادف آخر يوم الجمعة، فامتد الموعد إلى السبت.</p>}
            {result.daysLeft >= 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {owner && (
                  <Button variant="stamp" size="sm" disabled={!assignee || createTask.isPending || createTask.isSuccess} onClick={() => createTask.mutate()}>
                    <ListPlus className="size-4" aria-hidden="true" />
                    {createTask.isSuccess ? 'أُضيفت المهمة' : createTask.isPending ? 'تُضاف…' : 'أضفه مهمة عاجلة'}
                  </Button>
                )}
                <Button variant="line" size="sm" onClick={downloadIcs}>
                  <CalendarPlus className="size-4" aria-hidden="true" />
                  أضفه إلى التقويم
                </Button>
              </div>
            )}
            {createTask.isSuccess && (
              <p className="mt-2 text-xs text-stamp-green">
                أُضيفت إلى <Link to={`${PATHS.office}/tasks`} className="underline underline-offset-4">المهام</Link> بموعد إنجاز في آخر يوم للطعن.
              </p>
            )}
            {createTask.isError && <p className="mt-2 text-xs text-stamp">{messageOf(createTask.error)}</p>}
          </>
        )}
        <Disclaimer source={rule.source} />
      </div>
    </div>
  )
}

/* ───────────────────────── labour rights ───────────────────────── */

const CURRENCIES = [['ILS', 'شيكل'], ['JOD', 'دينار أردني'], ['USD', 'دولار أمريكي']] as const

const LaborTool = () => {
  const [values, setValues] = useState({ wage: '', start: '', end: todayString(), leave: '', currency: 'ILS' })
  const [noticeGiven, setNoticeGiven] = useState(true)
  const [arbitrary, setArbitrary] = useState(false)
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const result =
    values.wage && values.start && values.end
      ? computeLaborRights({
          monthlyWage: Number(values.wage),
          startDay: values.start,
          endDay: values.end,
          unusedLeaveDays: Number(values.leave) || 0,
          noticeGiven,
          arbitraryDismissal: arbitrary,
        })
      : null
  const money = (amount: number) => formatMoney(amount, values.currency)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="آخر أجر شهري" name="wage" type="number" min="0" step="any" dir="ltr" value={values.wage} onChange={set('wage')} />
        <SelectField label="العملة" name="currency" value={values.currency} onChange={set('currency')} options={CURRENCIES} />
        <Field label="تاريخ بدء العمل" name="start" type="date" dir="ltr" value={values.start} onChange={set('start')} />
        <Field label="تاريخ انتهاء العمل" name="end" type="date" dir="ltr" value={values.end} onChange={set('end')} />
        <Field label="أيام إجازة سنوية غير مستعملة" name="leave" type="number" min="0" dir="ltr" value={values.leave} onChange={set('leave')} />
        <div className="grid content-end gap-2 text-sm text-ink">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!noticeGiven} onChange={(event) => setNoticeGiven(!event.target.checked)} className="size-4" />
            انتهى العمل دون إشعار مسبق
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={arbitrary} onChange={(event) => setArbitrary(event.target.checked)} className="size-4" />
            فصل تعسفي
          </label>
        </div>
      </div>

      <div className="rounded-md border border-ink/20 bg-paper/60 p-5">
        {!result ? (
          <p className="text-sm text-ink-soft">أدخل الأجر وتاريخي البدء والانتهاء لحساب المستحقات.</p>
        ) : (
          <>
            <p className="text-xs font-semibold text-ink-soft">مدة الخدمة</p>
            <p className="mt-1 text-lg text-ink">
              {result.service.years} سنة، {result.service.months} شهر، {result.service.days} يوم
              <span className="ms-2 text-xs text-ink-faint">(الإجازة السنوية المستحقة {result.annualLeaveDays} يوماً)</span>
            </p>
            {result.lines.length === 0 ? (
              <p className="mt-4 text-sm text-ink-soft">لا مستحقات بحسب المدخلات: مكافأة نهاية الخدمة تُستحق بعد إتمام سنة.</p>
            ) : (
              <ul className="mt-4 divide-y divide-rule">
                {result.lines.map((line) => (
                  <li key={line.key} className="py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold text-ink">{line.label}</span>
                      <span className="text-sm text-ink tabular-nums" dir="ltr">{money(line.amount)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-faint">{line.note}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex items-baseline justify-between border-t-2 border-ink pt-3">
              <span className="font-semibold text-ink">المجموع التقديري</span>
              <span className="text-2xl text-stamp tabular-nums" dir="ltr">{money(result.total)}</span>
            </div>
          </>
        )}
        <Disclaimer source={LABOR_SOURCE} />
      </div>
    </div>
  )
}

/* ───────────────────────── official links ───────────────────────── */

const OfficialLinks = () => (
  <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {OFFICIAL_LINKS.map((link) => (
      <li key={link.href}>
        <a
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn('group flex h-full flex-col rounded-md border border-ink/20 bg-paper/60 p-4 transition-colors', 'hover:border-ink hover:bg-marker/25')}
        >
          <span className="flex items-center justify-between gap-2 font-semibold text-ink">
            {link.title}
            <ExternalLink className="size-4 shrink-0 text-ink-faint group-hover:text-ink" aria-hidden="true" />
          </span>
          <span className="mt-1 text-xs text-ink-soft">{link.body}</span>
        </a>
      </li>
    ))}
  </ul>
)

/* ───────────────────────── page ───────────────────────── */

export const Tools = () => (
  <>
    <SheetHeader title="الأدوات القانونية" note="أدوات مبنية على القوانين الفلسطينية لتوفير الوقت في العمل اليومي." />
    <div className="space-y-10">
      <Section icon={CalendarClock} title="حاسبة مهل الطعن" note="احسب آخر يوم للاستئناف أو النقض، وحوّله إلى مهمة أو تذكير.">
        <DeadlineTool />
      </Section>
      <Section icon={Calculator} title="حاسبة الحقوق العمالية" note="مكافأة نهاية الخدمة وبدل الإشعار والفصل التعسفي والإجازات.">
        <LaborTool />
      </Section>
      <Section icon={Scale} title="روابط رسمية سريعة" note="الجهات التي يحتاجها المحامي يومياً، في مكان واحد.">
        <OfficialLinks />
      </Section>
    </div>
  </>
)
