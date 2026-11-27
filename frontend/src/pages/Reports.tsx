import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { PATHS, personaOf, useAuth } from '@/auth/auth'
import { api } from '@/lib/api'
import { HEARING_STATUS } from '@/lib/hearings'
import { LOCALE } from '@/lib/i18n'
import { CASE_STATUS, CASE_TYPE, CURRENCY, formatDate, formatMoney, formatTime, PRIORITY, TASK_STATUS } from '@/lib/labels'
import { EXPENSE_CATEGORY } from '@/lib/officeFinance'
import { AGING, PERIOD_LABELS, PERIODS, toCsv, useReport, type OfficeReport, type PeriodKey } from '@/lib/reports'
import type { Member } from '@/lib/types'
import { SelectField } from '@/ui/forms'
import { cn, Field } from '@/ui/kit'
import { Empty, Failed, Loading, SheetHeader } from '@/ui/Shell'

/* ───────────────────────── building blocks ───────────────────────── */

const TH = 'pe-4 pb-2 text-start text-xs font-semibold text-ink-soft'
const TD = 'py-2.5 pe-4 align-top text-sm text-ink'

/** Saves a CSV file in the browser (a native client would share it instead). */
const download = (name: string, csv: string) => {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const CsvButton = ({ onClick }: { onClick: () => void }) => (
  <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs font-semibold text-stamp-blue underline-offset-4 hover:underline">
    <Download className="size-3.5" aria-hidden="true" />
    CSV
  </button>
)

const Card = ({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={cn('rounded-md border border-ink/15 bg-paper/60 p-4', className)}>
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-lg text-ink">{title}</h2>
      {action}
    </div>
    {children}
  </section>
)

const Stat = ({ label, value, tone = 'ink', hint }: { label: string; value: number; tone?: 'ink' | 'red' | 'green'; hint?: string }) => (
  <div className="rounded-md border border-ink/15 bg-paper/60 p-4">
    <p className="text-xs text-ink-faint">{label}</p>
    <p className={cn('text-3xl tabular-nums', tone === 'red' && value > 0 ? 'text-stamp' : tone === 'green' ? 'text-stamp-green' : 'text-ink')}>{value}</p>
    {hint && <p className="text-xs text-ink-soft">{hint}</p>}
  </div>
)

/** Horizontal bars, one per entry, scaled to the largest. */
const Bars = ({ rows, tone = 'bg-stamp-blue', format = (value: number) => String(value) }: { rows: { label: string; value: number }[]; tone?: string; format?: (value: number) => string }) => {
  const peak = Math.max(1, ...rows.map((row) => row.value))
  if (rows.length === 0) return <p className="text-sm text-ink-faint">لا بيانات.</p>
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.label} className="text-sm">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-ink-soft" title={row.label}>{row.label}</span>
            <span className="tabular-nums text-ink"><bdi>{format(row.value)}</bdi></span>
          </span>
          <span className="mt-1 block h-2 rounded-full bg-ink/8">
            <span className={cn('block h-full rounded-full', tone)} style={{ width: `${(row.value / peak) * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  )
}

const Table = ({ head, children }: { head: string[]; children: ReactNode }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[480px] border-collapse">
      <thead>
        <tr className="border-b-2 border-ink">
          {head.map((cell) => <th key={cell} scope="col" className={TH}>{cell}</th>)}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
)

const countRows = (counts: Record<string, number>, labels: Record<string, { text: string } | string>) =>
  Object.entries(counts)
    .map(([key, value]) => ({ label: (typeof labels[key] === 'string' ? labels[key] : (labels[key] as { text: string } | undefined)?.text) ?? key, value }))
    .sort((a, b) => b.value - a.value)

const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, value) => sum + value, 0)
const monthName = new Intl.DateTimeFormat(LOCALE, { month: 'short', year: 'numeric' })

/* ───────────────────────── sections ───────────────────────── */

const WorkSections = ({ report, stamp }: { report: OfficeReport; stamp: string }) => {
  const { cases, hearings, tasks } = report
  const openCases = total(cases.by_status) - (cases.by_status.closed ?? 0) - (cases.by_status.cancelled ?? 0)
  const caseStatus = countRows(cases.by_status, CASE_STATUS)
  const caseType = cases.by_type.map((row) => ({ label: CASE_TYPE[row.case_type] ?? row.case_type, value: row.count }))
  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="قضايا قيد العمل" value={openCases} />
        <Stat label="فُتحت في الفترة" value={cases.opened} />
        <Stat label="أُغلقت في الفترة" value={cases.closed} tone="green" />
        <Stat label="جلسات في الفترة" value={total(hearings.by_status)} />
        <Stat label="جلسات بلا نتيجة" value={hearings.missed.length} tone="red" hint="مضى موعدها" />
        <Stat label="مهام متأخرة" value={tasks.overdue.length} tone="red" hint="حتى اليوم" />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card title="القضايا حسب الحالة" action={<CsvButton onClick={() => download(`cases-by-status-${stamp}.csv`, toCsv(caseStatus, [['الحالة', (row) => row.label], ['العدد', (row) => row.value]]))} />}>
          <Bars rows={caseStatus} />
        </Card>
        <Card title="القضايا حسب النوع" action={<CsvButton onClick={() => download(`cases-by-type-${stamp}.csv`, toCsv(caseType, [['النوع', (row) => row.label], ['العدد', (row) => row.value]]))} />}>
          <Bars rows={caseType} tone="bg-ink" />
        </Card>
        <Card title="الجلسات في الفترة حسب الحالة">
          <Bars rows={countRows(hearings.by_status, HEARING_STATUS)} tone="bg-stamp" />
        </Card>
        <Card title="المهام المستحقة في الفترة حسب الحالة">
          <Bars rows={countRows(tasks.by_status, TASK_STATUS)} tone="bg-stamp-green" />
        </Card>
      </div>

      {cases.per_lawyer && (
        <Card
          title="القضايا لكل عضو في الفريق"
          className="mb-5"
          action={<CsvButton onClick={() => download(`cases-per-member-${stamp}.csv`, toCsv(cases.per_lawyer!, [['العضو', (row) => row.full_name], ['قيد العمل', (row) => row.open], ['مغلقة', (row) => row.closed]]))} />}
        >
          {cases.per_lawyer.length === 0 ? <Empty>لا قضايا مسندة بعد.</Empty> : (
            <Table head={['العضو', 'قيد العمل', 'مغلقة']}>
              {cases.per_lawyer.map((row) => (
                <tr key={row.user_id} className="border-b border-rule">
                  <td className={TD}>{row.full_name}</td>
                  <td className={cn(TD, 'tabular-nums')}>{row.open}</td>
                  <td className={cn(TD, 'tabular-nums text-ink-soft')}>{row.closed}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      <div className="mb-5 grid gap-4 xl:grid-cols-2">
        <Card
          title="جلسات مضى موعدها بلا نتيجة"
          action={hearings.missed.length > 0 && <CsvButton onClick={() => download(`missed-hearings-${stamp}.csv`, toCsv(hearings.missed, [['القضية', (row) => row.case_number], ['العنوان', (row) => row.title], ['نوع الجلسة', (row) => row.hearing_type], ['الموعد', (row) => row.hearing_at.slice(0, 16).replace('T', ' ')]]))} />}
        >
          {hearings.missed.length === 0 ? <p className="text-sm text-ink-faint">كل الجلسات الماضية سُجّلت نتائجها.</p> : (
            <Table head={['القضية', 'الجلسة', 'الموعد']}>
              {hearings.missed.map((row) => (
                <tr key={row.hearing_id} className="border-b border-rule">
                  <td className={TD}><Link to={`${PATHS.office}/cases/${row.case_id}?tab=hearings`} className="font-semibold text-stamp-blue underline-offset-4 hover:underline"><bdi dir="ltr">{row.case_number}</bdi></Link></td>
                  <td className={TD}>{row.hearing_type}</td>
                  <td className={cn(TD, 'whitespace-nowrap text-ink-soft')}><bdi>{formatDate(row.hearing_at)} {formatTime(row.hearing_at)}</bdi></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card
          title="المهام المتأخرة"
          action={tasks.overdue.length > 0 && <CsvButton onClick={() => download(`overdue-tasks-${stamp}.csv`, toCsv(tasks.overdue, [['المهمة', (row) => row.title], ['المسؤول', (row) => row.assignee_name], ['القضية', (row) => row.case_number], ['الأولوية', (row) => PRIORITY[row.priority]?.text ?? row.priority], ['موعد الإنجاز', (row) => row.due_at.slice(0, 10)]]))} />}
        >
          {tasks.overdue.length === 0 ? <p className="text-sm text-ink-faint">لا مهام متأخرة.</p> : (
            <Table head={['المهمة', 'المسؤول', 'كان مستحقاً']}>
              {tasks.overdue.map((row) => (
                <tr key={row.task_id} className="border-b border-rule">
                  <td className={TD}>
                    {row.title}
                    {row.case_number && <p className="text-xs text-ink-faint"><bdi dir="ltr">{row.case_number}</bdi></p>}
                  </td>
                  <td className={TD}>{row.assignee_name}</td>
                  <td className={cn(TD, 'whitespace-nowrap text-stamp')}>{formatDate(row.due_at)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  )
}

const FinanceSections = ({ finance, stamp }: { finance: NonNullable<OfficeReport['finance']>; stamp: string }) => {
  const currencies = [...new Set([...finance.billed_vs_collected, ...finance.aging, ...finance.profit_by_month].map((row) => row.currency))]
  return (
    <>
      <h2 className="mt-8 mb-4 border-b-2 border-ink pb-2 text-2xl text-ink">المال</h2>
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card title="المطالب به والمحصَّل في الفترة">
          {finance.billed_vs_collected.length === 0 ? <p className="text-sm text-ink-faint">لا مطالبات ولا دفعات في هذه الفترة.</p> : (
            <div className="space-y-4">
              {finance.billed_vs_collected.map((row) => (
                <div key={row.currency}>
                  <p className="mb-1 text-xs font-semibold text-ink-soft">{CURRENCY[row.currency]}</p>
                  <Bars rows={[{ label: 'المطالب به', value: row.billed }, { label: 'المحصَّل', value: row.collected }]} tone="bg-stamp-green" format={(value) => formatMoney(value, row.currency)} />
                  {row.billed > 0 && <p className="mt-1 text-xs text-ink-faint">نسبة التحصيل {Math.round((row.collected / row.billed) * 100)}%</p>}
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="المصاريف حسب البند" action={finance.expenses_by_category.length > 0 && <CsvButton onClick={() => download(`expenses-by-category-${stamp}.csv`, toCsv(finance.expenses_by_category, [['البند', (row) => EXPENSE_CATEGORY[row.category]], ['العملة', (row) => row.currency], ['المبلغ', (row) => row.spent]]))} />}>
          {currencies.length === 0 || finance.expenses_by_category.length === 0 ? <p className="text-sm text-ink-faint">لا مصاريف في هذه الفترة.</p> : (
            <div className="space-y-4">
              {currencies.filter((currency) => finance.expenses_by_category.some((row) => row.currency === currency)).map((currency) => (
                <div key={currency}>
                  <p className="mb-1 text-xs font-semibold text-ink-soft">{CURRENCY[currency]}</p>
                  <Bars rows={finance.expenses_by_category.filter((row) => row.currency === currency).map((row) => ({ label: EXPENSE_CATEGORY[row.category], value: row.spent }))} tone="bg-stamp/70" format={(value) => formatMoney(value, currency)} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card
        title="أرصدة الموكّلين المستحقة حسب العمر (حتى اليوم)"
        className="mb-5"
        action={finance.aging.length > 0 && <CsvButton onClick={() => download(`receivables-aging-${stamp}.csv`, toCsv(finance.aging, [['العملة', (row) => row.currency], ...AGING.map(([key, label]) => [label, (row: (typeof finance.aging)[number]) => row[key]] as const), ['المجموع', (row) => row.total]]))} />}
      >
        {finance.aging.length === 0 ? <p className="text-sm text-ink-faint">لا أرصدة مستحقة على الموكّلين.</p> : (
          <Table head={['العملة', ...AGING.map(([, label]) => label), 'المجموع']}>
            {finance.aging.map((row) => (
              <tr key={row.currency} className="border-b border-rule">
                <td className={cn(TD, 'font-semibold')}>{CURRENCY[row.currency]}</td>
                {AGING.map(([key]) => (
                  <td key={key} className={cn(TD, 'tabular-nums', key === 'd90_plus' && row[key] > 0 && 'font-semibold text-stamp')}><bdi>{formatMoney(row[key], row.currency)}</bdi></td>
                ))}
                <td className={cn(TD, 'tabular-nums font-semibold')}><bdi>{formatMoney(row.total, row.currency)}</bdi></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="mb-5 grid gap-4 xl:grid-cols-2">
        <Card title="أكبر الأرصدة المستحقة" action={finance.debtors.length > 0 && <CsvButton onClick={() => download(`top-balances-${stamp}.csv`, toCsv(finance.debtors, [['الموكّل', (row) => row.client_name], ['العملة', (row) => row.currency], ['المستحق', (row) => row.outstanding], ['عدد المطالبات', (row) => row.invoices], ['أقدم تأخير (أيام)', (row) => row.oldest_days_late]]))} />}>
          {finance.debtors.length === 0 ? <p className="text-sm text-ink-faint">لا أرصدة مستحقة.</p> : (
            <Table head={['الموكّل', 'المستحق', 'أقدم تأخير']}>
              {finance.debtors.map((row) => (
                <tr key={`${row.client_id}-${row.currency}`} className="border-b border-rule">
                  <td className={TD}><Link to={`${PATHS.office}/clients/${row.client_id}/statement`} className="text-stamp-blue underline-offset-4 hover:underline">{row.client_name}</Link></td>
                  <td className={cn(TD, 'tabular-nums font-semibold')}><bdi>{formatMoney(row.outstanding, row.currency)}</bdi></td>
                  <td className={cn(TD, 'tabular-nums', row.oldest_days_late > 60 && 'text-stamp')}>{row.oldest_days_late === 0 ? 'غير متأخر' : `${row.oldest_days_late} يوماً`}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="الربح شهراً بشهر" action={finance.profit_by_month.length > 0 && <CsvButton onClick={() => download(`profit-by-month-${stamp}.csv`, toCsv(finance.profit_by_month, [['الشهر', (row) => row.month], ['العملة', (row) => row.currency], ['المحصَّل', (row) => row.collected], ['المصاريف', (row) => row.spent], ['الصافي', (row) => row.net]]))} />}>
          {finance.profit_by_month.length === 0 ? <p className="text-sm text-ink-faint">لا دفعات ولا مصاريف في هذه الفترة.</p> : (
            <Table head={['الشهر', 'المحصَّل', 'المصاريف', 'الصافي']}>
              {finance.profit_by_month.map((row) => (
                <tr key={`${row.month}-${row.currency}`} className="border-b border-rule">
                  <td className={cn(TD, 'whitespace-nowrap')}>{monthName.format(new Date(`${row.month}-01T00:00:00`))}</td>
                  <td className={cn(TD, 'tabular-nums')}><bdi>{formatMoney(row.collected, row.currency)}</bdi></td>
                  <td className={cn(TD, 'tabular-nums')}><bdi>{formatMoney(row.spent, row.currency)}</bdi></td>
                  <td className={cn(TD, 'tabular-nums font-semibold', row.net < 0 ? 'text-stamp' : 'text-stamp-green')}><bdi>{formatMoney(row.net, row.currency)}</bdi></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  )
}

/* ───────────────────────── the page ───────────────────────── */

/** Office reports over a period: the whole office for the administrator (or one member), one's own work otherwise. */
export const Reports = () => {
  const owner = personaOf(useAuth().session) === 'owner'
  const [period, setPeriod] = useState<PeriodKey | 'custom'>('year')
  const [custom, setCustom] = useState(PERIODS.year)
  const range = period === 'custom' ? custom : PERIODS[period]()
  const [member, setMember] = useState('')
  const staff = useQuery({
    queryKey: ['members'],
    enabled: owner,
    queryFn: async () => (await api.get<{ users: Member[] }>('/users', { params: { pageSize: 50 } })).data.users,
    select: (members) => members.filter((entry) => entry.role !== 'client'),
  })
  const badRange = range.to < range.from
  const report = useReport({ ...range, userId: owner ? member || null : null })
  const stamp = `${range.from}_${range.to}`

  return (
    <>
      <SheetHeader
        title="التقارير"
        note={owner ? 'نشاط المكتب وماله في الفترة التي تختارها. الأرصدة المستحقة والمهام المتأخرة محسوبة حتى اليوم.' : 'قضاياك وجلساتها ومهامك في الفترة التي تختارها.'}
      />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <SelectField label="الفترة" name="report_period" className="w-44" value={period} onChange={(event) => setPeriod(event.target.value as PeriodKey | 'custom')} options={PERIOD_LABELS} />
        {period === 'custom' && (
          <>
            <Field label="من" name="report_from" type="date" dir="ltr" className="w-40" value={custom.from} onChange={(event) => setCustom((current) => ({ ...current, from: event.target.value }))} />
            <Field label="إلى" name="report_to" type="date" dir="ltr" className="w-40" value={custom.to} onChange={(event) => setCustom((current) => ({ ...current, to: event.target.value }))} error={badRange ? 'قبل البداية' : undefined} />
          </>
        )}
        {owner && (
          <SelectField label="عرض" name="report_member" className="w-56" value={member} onChange={(event) => setMember(event.target.value)} options={[['', 'المكتب كله'], ...(staff.data ?? []).map((entry) => [entry.user_id, entry.full_name] as const)]} />
        )}
        <p className="pb-2 text-xs text-ink-faint"><bdi>{formatDate(range.from)} – {formatDate(range.to)}</bdi></p>
      </div>
      {badRange ? null : report.isPending ? <Loading /> : report.isError ? <Failed error={report.error} /> : (
        <>
          <WorkSections report={report.data} stamp={stamp} />
          {report.data.finance && <FinanceSections finance={report.data.finance} stamp={stamp} />}
          {owner && member && <p className="text-xs text-ink-faint">في عرض عضو واحد تظهر قضاياه ومهامه فقط، دون مال المكتب ودون مهامه الخاصة.</p>}
        </>
      )}
    </>
  )
}
