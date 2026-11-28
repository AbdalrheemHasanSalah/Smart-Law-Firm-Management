import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, CalendarPlus, CalendarRange, Calculator, CarFront, ExternalLink, ListPlus, Scale } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { PATHS, personaOf, useAuth } from '@/auth/auth'
import { api, messageOf } from '@/lib/api'
import { formatDate, formatDay, formatMoney, ROLE } from '@/lib/labels'
import type { CaseRelationships, Member } from '@/lib/types'
import {
  ACCIDENT_SOURCE,
  computeAccident,
  computeDeadline,
  computePeriod,
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

/* ───────────────────────── period between two dates ───────────────────────── */

const PeriodTool = () => {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(todayString())
  const result = computePeriod(from, to)
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="من تاريخ" name="period_from" type="date" dir="ltr" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Field label="إلى تاريخ" name="period_to" type="date" dir="ltr" value={to} onChange={(event) => setTo(event.target.value)} />
      </div>
      <div className="rounded-md border border-ink/20 bg-paper/60 p-5" aria-live="polite">
        {!result ? (
          <p className="text-sm text-ink-soft">اختر التاريخين لحساب المدة بينهما.</p>
        ) : (
          <>
            <p className="text-2xl text-ink">
              {result.years} سنة، {result.months} شهر، {result.days} يوم
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              {result.totalDays} يوماً · {result.weeks} أسبوعاً{result.reversed ? ' · التاريخ الثاني قبل الأول' : ''}
            </p>
          </>
        )}
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          الأيام تُعدّ من اليوم التالي للتاريخ الأول حتى التاريخ الثاني شاملاً. الشهر يُحسب من نفس اليوم في الشهر التالي، أو آخر يوم فيه إن كان أقصر.
        </p>
      </div>
    </div>
  )
}

/* ───────────────────────── road accident compensation ───────────────────────── */

const AccidentTool = () => {
  const [kind, setKind] = useState<'injury' | 'death'>('injury')
  const [values, setValues] = useState({
    accident: '', report: '', disability: '', nights: '', share: '', income: '', average: '', bulletin: '', until: '', years: '', discount: '', currency: 'ILS',
  })
  const [surgery, setSurgery] = useState(false)
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const result = computeAccident({
    kind,
    accidentDay: values.accident,
    finalReportDay: values.report || undefined,
    disabilityPercent: Number(values.disability) || 0,
    hospitalNights: Number(values.nights) || 0,
    surgeryWithStay: surgery,
    dependantsSharePercent: Number(values.share) || 0,
    monthlyIncome: Number(values.income) || 0,
    sectorAverageWage: Number(values.average) || 0,
    temporaryUntilDay: values.until || undefined,
    futureYears: Number(values.years) || 0,
    immediateDiscountPercent: Number(values.discount) || 0,
  })
  const wage = (amount: number) => formatMoney(amount, values.currency)
  const jod = (amount: number) => formatMoney(amount, 'JOD')
  const injury = kind === 'injury'

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <div className="flex gap-2" role="radiogroup" aria-label="نوع المطالبة">
          {([['injury', 'إصابة'], ['death', 'وفاة']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={kind === key}
              onClick={() => setKind(key)}
              className={cn('rounded-full border px-4 py-1.5 text-sm font-semibold', kind === key ? 'border-ink bg-ink text-paper' : 'border-ink/20 text-ink-soft hover:border-ink')}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تاريخ الحادث" name="acc_day" type="date" dir="ltr" required value={values.accident} onChange={set('accident')} />
          <Field label="تاريخ التقرير الطبي النهائي (اختياري)" name="acc_report" type="date" dir="ltr" value={values.report} onChange={set('report')} />
        </div>
        {injury ? (
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-ink">الضرر المعنوي (بالدينار)</legend>
            <Field label="نسبة العجز الدائم %" name="acc_disability" type="number" min="0" max="100" step="any" dir="ltr" value={values.disability} onChange={set('disability')} />
            <Field label="ليالي المكوث في المشفى" name="acc_nights" type="number" min="0" dir="ltr" value={values.nights} onChange={set('nights')} />
            <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
              <input type="checkbox" checked={surgery} onChange={(event) => setSurgery(event.target.checked)} className="size-4" />
              أُجريت له عملية جراحية استلزمت المكوث في المشفى
            </label>
          </fieldset>
        ) : (
          <Field label="حصة الورثة المعالين من التركة % (حجة حصر الإرث)" name="acc_share" type="number" min="0" max="100" step="any" dir="ltr" value={values.share} onChange={set('share')} />
        )}
        {injury && (
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-ink">الضرر المادي (بعملة الأجر)</legend>
            <Field label="دخل المصاب الشهري قبل الحادث" name="acc_income" type="number" min="0" step="any" dir="ltr" value={values.income} onChange={set('income')} />
            <SelectField label="العملة" name="acc_currency" value={values.currency} onChange={set('currency')} options={CURRENCIES} />
            <Field label="معدل أجور حقله الاقتصادي (الإحصاء)" name="acc_average" type="number" min="0" step="any" dir="ltr" value={values.average} onChange={set('average')} />
            <Field label="النشرة المعتمدة (اختياري)" name="acc_bulletin" placeholder="مثلاً: مسح القوى العاملة، الربع الثاني 2026" value={values.bulletin} onChange={set('bulletin')} />
            <Field label="آخر يوم في العجز المؤقت" name="acc_until" type="date" dir="ltr" value={values.until} onChange={set('until')} />
            <span aria-hidden="true" className="hidden sm:block" />
            <Field label="سنوات الخسارة المستقبلية (اجتهاد)" name="acc_years" type="number" min="0" max="60" step="any" dir="ltr" value={values.years} onChange={set('years')} />
            <Field label="خصم الدفع الفوري % (اجتهاد)" name="acc_discount" type="number" min="0" max="100" step="any" dir="ltr" value={values.discount} onChange={set('discount')} />
          </fieldset>
        )}
      </div>

      <div className="rounded-md border border-ink/20 bg-paper/60 p-5" aria-live="polite">
        {!result ? (
          <p className="text-sm text-ink-soft">أدخل تاريخ الحادث وبيانات الإصابة لحساب التعويض.</p>
        ) : (
          <>
            {injury && result.cappedMonthlyWage !== null && (
              <p className="mb-3 text-xs text-ink-soft">
                الأجر المعتمد شهرياً: <span className="font-semibold text-ink" dir="ltr">{wage(result.cappedMonthlyWage)}</span>
                {result.wageWasCapped && ' — خُفّض إلى مثلي معدل الأجور (المادة 155)'}
                {values.bulletin.trim() && ` · ${values.bulletin.trim()}`}
              </p>
            )}
            <ul className="divide-y divide-rule">
              {result.lines.map((line) => (
                <li key={line.key} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-ink">{line.label}</span>
                    <span className="text-sm text-ink tabular-nums whitespace-nowrap" dir="ltr">
                      {line.upTo ? '≤ ' : ''}
                      {line.currency === 'JOD' ? jod(line.amount) : wage(line.amount)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-faint">{line.note}</p>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1 border-t-2 border-ink pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="font-semibold text-ink">{injury ? 'الضرر المعنوي' : 'المستحق للورثة'}</dt>
                <dd className="text-2xl text-stamp tabular-nums" dir="ltr">{jod(result.moralTotal)}</dd>
              </div>
              {result.materialTotal > 0 && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="font-semibold text-ink">الضرر المادي</dt>
                  <dd className="text-2xl text-stamp tabular-nums" dir="ltr">{wage(result.materialTotal)}</dd>
                </div>
              )}
            </dl>
            <ul className="mt-4 space-y-1 text-xs text-ink-soft">
              <li>
                آخر موعد لرفع الدعوى: <span className="font-semibold text-ink">{formatDate(`${result.limitationDay}T12:00:00`)}</span>
                {result.limitationFromReport ? ' (من تاريخ التقرير الطبي النهائي)' : ' (ثلاث سنوات من الحادث)'} — المادة 159
              </li>
              {result.urgentMonthly !== null && result.urgentMaxTotal !== null && (
                <li>
                  الدفعة المستعجلة الشهرية بحد أقصى <span dir="ltr">{wage(result.urgentMonthly)}</span>، ولا تتجاوز 12 دفعة (<span dir="ltr">{wage(result.urgentMaxTotal)}</span>) — المادتان 160 و165
                </li>
              )}
            </ul>
          </>
        )}
        <Disclaimer source={ACCIDENT_SOURCE} />
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
      <Section icon={CarFront} title="حاسبة تعويض حوادث الطرق" note="الضرر المعنوي والعجز المؤقت والدائم والوفاة والتقادم، وفق قانون التأمين.">
        <AccidentTool />
      </Section>
      <Section icon={CalendarRange} title="حاسبة المدد" note="المدة بين تاريخين بالسنوات والأشهر والأيام.">
        <PeriodTool />
      </Section>
      <Section icon={Scale} title="روابط رسمية سريعة" note="الجهات التي يحتاجها المحامي يومياً، في مكان واحد.">
        <OfficialLinks />
      </Section>
    </div>
  </>
)
