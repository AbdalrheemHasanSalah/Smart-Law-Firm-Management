import { CalendarPlus, Check, HandCoins, Pencil, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { messageOf } from '@/lib/api'
import {
  LEAVE_STATUS,
  LEAVE_TYPE,
  leaveDays,
  thisMonth,
  useAdvances,
  useCancelLeave,
  useDecideLeave,
  useDeletePayslip,
  useGiveAdvance,
  useLeaveRequests,
  useMyHr,
  usePayPayslip,
  usePayslips,
  usePreparePayroll,
  useRequestLeave,
  useSaveStaffRecord,
  useStaffRecords,
  useUpdatePayslip,
  type LeaveRequest,
  type LeaveType,
  type Payslip,
  type StaffRecord,
} from '@/lib/hr'
import { CURRENCY, formatDate, formatMoney, optionsOf, ROLE } from '@/lib/labels'
import { accountsIn, useAccounts, type Currency } from '@/lib/officeFinance'
import { oneOf, useParam } from '@/lib/useParam'
import { FormActions, Modal, SelectField, TextArea } from '@/ui/forms'
import { Button, cn, Field } from '@/ui/kit'
import { Empty, Failed, Loading, Pill, SheetHeader } from '@/ui/Shell'
import { Team } from './Workspace'

/* ───────────────────────── shared ───────────────────────── */

const TH = 'pe-4 pb-2 text-start text-xs font-semibold text-ink-soft'
const TD = 'py-3 pe-4 align-top text-sm text-ink'
const LINK = 'text-xs font-semibold underline-offset-4 hover:underline disabled:opacity-50'
const today = () => new Date().toISOString().slice(0, 10)

const Table = ({ head, children, min = 640 }: { head: string[]; children: ReactNode; min?: number }) => (
  <div className="overflow-x-auto">
    <table className="w-full border-collapse" style={{ minWidth: min }}>
      <thead>
        <tr className="border-b-2 border-ink">
          {head.map((cell, index) => <th key={`${cell}-${index}`} scope="col" className={TH}>{cell}</th>)}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
)

const Money = ({ value, currency, className }: { value: number; currency: Currency; className?: string }) => (
  <bdi className={cn('tabular-nums', className)}>{formatMoney(value, currency)}</bdi>
)

const LeaveTable = ({ rows, actions, showName = true }: { rows: LeaveRequest[]; actions?: (leave: LeaveRequest) => ReactNode; showName?: boolean }) => (
  <Table head={[...(showName ? ['العضو'] : []), 'النوع', 'من', 'إلى', 'أيام العمل', 'الحالة', '']}>
    {rows.map((leave) => {
      const status = LEAVE_STATUS[leave.status]
      return (
        <tr key={leave.leave_id} className="border-b border-rule">
          {showName && <td className={cn(TD, 'font-semibold')}>{leave.full_name}</td>}
          <td className={TD}>
            {LEAVE_TYPE[leave.leave_type]}
            {leave.reason && <p className="text-xs text-ink-faint">{leave.reason}</p>}
          </td>
          <td className={cn(TD, 'whitespace-nowrap')}>{formatDate(leave.starts_on)}</td>
          <td className={cn(TD, 'whitespace-nowrap')}>{formatDate(leave.ends_on)}</td>
          <td className={cn(TD, 'tabular-nums')}>{leave.days}</td>
          <td className={TD}>
            <Pill tone={status.tone}>{status.text}</Pill>
            {leave.decision_note && <p className="mt-1 text-xs text-ink-soft">{leave.decision_note}</p>}
          </td>
          <td className={cn(TD, 'text-end whitespace-nowrap')}>{actions?.(leave)}</td>
        </tr>
      )
    })}
  </Table>
)

/* ───────────────────────── staff records ───────────────────────── */

const RecordForm = ({ record, onClose }: { record: StaffRecord | null; onClose: () => void }) => {
  const save = useSaveStaffRecord()
  const [values, setValues] = useState({ job_title: '', hire_date: '', phone: '', national_id: '', monthly_salary: '', salary_currency: 'ILS' as Currency, annual_leave_days: '14' })
  const [listed, setListed] = useState(false)
  useEffect(() => {
    if (!record) return
    save.reset()
    setValues({
      job_title: record.job_title ?? '', hire_date: record.hire_date ?? '', phone: record.phone ?? '', national_id: record.national_id ?? '',
      monthly_salary: record.monthly_salary === null ? '' : String(record.monthly_salary), salary_currency: record.salary_currency,
      annual_leave_days: String(record.annual_leave_days),
    })
    setListed(record.show_on_public_page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.user_id])
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const days = Number(values.annual_leave_days)
  return (
    <Modal open={record !== null} onClose={onClose} title={record ? `سجلّ ${record.full_name}` : ''} wide>
      {record && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate(
              {
                userId: record.user_id,
                input: {
                  job_title: values.job_title.trim() || null, hire_date: values.hire_date || null, phone: values.phone.trim() || null,
                  national_id: values.national_id.trim() || null, monthly_salary: values.monthly_salary === '' ? null : Number(values.monthly_salary),
                  salary_currency: values.salary_currency, annual_leave_days: days, show_on_public_page: listed,
                },
              },
              { onSuccess: onClose },
            )
          }}
          className="grid gap-4 sm:grid-cols-2"
        >
          <Field label="المسمّى الوظيفي" name="job_title" placeholder="محامٍ متدرب، سكرتيرة…" value={values.job_title} onChange={set('job_title')} />
          <Field label="تاريخ التعيين" name="hire_date" type="date" dir="ltr" value={values.hire_date} onChange={set('hire_date')} />
          <Field label="الهاتف" name="staff_phone" dir="ltr" value={values.phone} onChange={set('phone')} />
          <Field label="رقم الهوية" name="staff_national_id" dir="ltr" hint="يراه مدير المكتب وصاحبه فقط." value={values.national_id} onChange={set('national_id')} />
          <Field label="الراتب الشهري" name="monthly_salary" type="number" min="0" step="0.01" dir="ltr" value={values.monthly_salary} onChange={set('monthly_salary')} />
          <SelectField label="عملة الراتب" name="salary_currency" value={values.salary_currency} onChange={set('salary_currency')} options={optionsOf(CURRENCY)} />
          <Field label="الإجازة السنوية (أيام عمل)" name="annual_leave_days" type="number" min="0" max="60" step="1" dir="ltr" value={values.annual_leave_days} onChange={set('annual_leave_days')} hint="14 يوماً في قانون العمل، و21 بعد خمس سنوات." />
          <label className="flex cursor-pointer items-center gap-2 self-end text-sm text-ink">
            <input type="checkbox" checked={listed} onChange={(event) => setListed(event.target.checked)} className="size-4 accent-stamp" />
            يظهر في صفحة المكتب العامة (الاسم والمسمّى فقط)
          </label>
          <div className="sm:col-span-2">
            <FormActions error={save.isError ? messageOf(save.error) : null}>
              <Button variant="line" onClick={onClose}>إلغاء</Button>
              <Button type="submit" variant="ink" disabled={!Number.isInteger(days) || days < 0 || days > 60 || save.isPending}>{save.isPending ? 'يُحفظ…' : 'احفظ'}</Button>
            </FormActions>
          </div>
        </form>
      )}
    </Modal>
  )
}

const RecordsTab = () => {
  const staff = useStaffRecords()
  const [editing, setEditing] = useState<StaffRecord | null>(null)
  return (
    <>
      {staff.isPending ? <Loading /> : staff.isError ? <Failed error={staff.error} /> : staff.data.length === 0 ? <Empty>لا أعضاء في الفريق بعد.</Empty> : (
        <Table head={['العضو', 'المسمّى', 'التعيين', 'الراتب', 'سُلف مستحقة', 'الإجازة السنوية', '']} min={760}>
          {staff.data.map((record) => (
            <tr key={record.user_id} className={cn('border-b border-rule', record.membership_status !== 'active' && 'opacity-55')}>
              <td className={TD}>
                <p className="font-semibold">{record.full_name}</p>
                <p className="text-xs text-ink-faint">{ROLE[record.role]}</p>
              </td>
              <td className={TD}>{record.job_title ?? '—'}</td>
              <td className={cn(TD, 'whitespace-nowrap text-ink-soft')}>{record.hire_date ? formatDate(record.hire_date) : '—'}</td>
              <td className={TD}>{record.monthly_salary === null ? <span className="text-ink-faint">لم يُحدَّد</span> : <Money value={record.monthly_salary} currency={record.salary_currency} />}</td>
              <td className={TD}>{record.advances_owed > 0 ? <Money value={record.advances_owed} currency={record.salary_currency} className="text-stamp" /> : '—'}</td>
              <td className={TD}>
                <span className="tabular-nums">{record.annual_remaining}</span>
                <span className="text-xs text-ink-faint"> من {record.annual_leave_days}</span>
                {record.annual_pending > 0 && <p className="text-xs text-stamp-blue">{record.annual_pending} بانتظار القرار</p>}
              </td>
              <td className={cn(TD, 'text-end')}>
                <button type="button" onClick={() => setEditing(record)} className={cn(LINK, 'inline-flex items-center gap-1 text-stamp-blue')}>
                  <Pencil className="size-3.5" aria-hidden="true" />
                  {record.has_record ? 'تعديل' : 'أنشئ السجل'}
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <RecordForm record={editing} onClose={() => setEditing(null)} />
    </>
  )
}

/* ───────────────────────── payroll and advances ───────────────────────── */

const GiveAdvance = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const staff = useStaffRecords()
  const accounts = useAccounts(open)
  const give = useGiveAdvance()
  const [values, setValues] = useState({ user: '', amount: '', account: '', givenOn: today(), note: '' })
  useEffect(() => {
    if (open) {
      give.reset()
      setValues({ user: '', amount: '', account: '', givenOn: today(), note: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const person = staff.data?.find((record) => record.user_id === values.user)
  const choices = person ? accountsIn(accounts.data, person.salary_currency) : []
  return (
    <Modal open={open} onClose={onClose} title="سلفة على الراتب">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          give.mutate({ user_id: values.user, amount: Number(values.amount), account_id: values.account, given_on: values.givenOn, ...(values.note.trim() ? { note: values.note.trim() } : {}) }, { onSuccess: onClose })
        }}
        className="space-y-4"
      >
        <SelectField label="لمن؟" name="advance_user" required value={values.user} onChange={(event) => setValues((current) => ({ ...current, user: event.target.value, account: '' }))} options={[['', 'اختر عضواً'], ...(staff.data ?? []).filter((record) => record.has_record && record.membership_status === 'active').map((record) => [record.user_id, record.full_name] as const)]} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={person ? `المبلغ (${CURRENCY[person.salary_currency]})` : 'المبلغ'} name="advance_amount" type="number" min="0.01" step="0.01" dir="ltr" required value={values.amount} onChange={set('amount')} />
          <Field label="التاريخ" name="given_on" type="date" dir="ltr" required value={values.givenOn} onChange={set('givenOn')} />
        </div>
        <SelectField label="من الحساب" name="advance_account" required value={values.account} onChange={set('account')} options={[['', person ? (choices.length ? 'اختر حساباً' : 'لا حساب بعملة الراتب') : 'اختر العضو أولاً'], ...choices.map((account) => [account.account_id, account.name] as const)]} />
        <Field label="ملاحظة (اختياري)" name="advance_note" value={values.note} onChange={set('note')} />
        <p className="text-xs text-ink-faint">تُسجَّل السلفة مصروف رواتب عند دفعها، وتُقتطع من الرواتب التالية بالقدر الذي تحدّده كل شهر. يظهر في القائمة من له سجلّ في الفريق فقط.</p>
        <FormActions error={give.isError ? messageOf(give.error) : null}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="ink" disabled={!values.user || !values.account || !(Number(values.amount) > 0) || give.isPending}>{give.isPending ? 'تُصرف…' : 'اصرف السلفة'}</Button>
        </FormActions>
      </form>
    </Modal>
  )
}

const EditPayslip = ({ payslip, onClose }: { payslip: Payslip | null; onClose: () => void }) => {
  const update = useUpdatePayslip()
  const [values, setValues] = useState({ advance: '0', other: '0', note: '' })
  useEffect(() => {
    if (!payslip) return
    update.reset()
    setValues({ advance: String(payslip.advance_deduction), other: String(payslip.other_deductions), note: payslip.deduction_note ?? '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payslip?.payslip_id])
  if (!payslip) return <Modal open={false} onClose={onClose} title="">{null}</Modal>
  const advance = Number(values.advance) || 0
  const other = Number(values.other) || 0
  const net = payslip.salary - advance - other
  const tooMuch = advance > payslip.advances_owed
  return (
    <Modal open onClose={onClose} title={`راتب ${payslip.full_name} — ${payslip.period}`}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          update.mutate({ payslipId: payslip.payslip_id, patch: { advance_deduction: advance, other_deductions: other, deduction_note: values.note.trim() || null } }, { onSuccess: onClose })
        }}
        className="space-y-4"
      >
        <p className="text-sm text-ink-soft">الراتب <Money value={payslip.salary} currency={payslip.currency} className="font-semibold text-ink" /> · السُلف المستحقة <Money value={payslip.advances_owed} currency={payslip.currency} /></p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="اقتطاع من السُلف" name="advance_deduction" type="number" min="0" step="0.01" dir="ltr" value={values.advance} onChange={(event) => setValues((current) => ({ ...current, advance: event.target.value }))} error={tooMuch ? 'أكثر من المستحق' : undefined} />
          <Field label="خصومات أخرى" name="other_deductions" type="number" min="0" step="0.01" dir="ltr" value={values.other} onChange={(event) => setValues((current) => ({ ...current, other: event.target.value }))} />
        </div>
        <Field label="سبب الخصم (اختياري)" name="deduction_note" placeholder="غياب، تأخير…" value={values.note} onChange={(event) => setValues((current) => ({ ...current, note: event.target.value }))} />
        <p className={cn('text-sm font-semibold', net < 0 ? 'text-stamp' : 'text-ink')}>الصافي: <Money value={net} currency={payslip.currency} /></p>
        <FormActions error={update.isError ? messageOf(update.error) : null}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="ink" disabled={tooMuch || net < 0 || update.isPending}>{update.isPending ? 'يُحفظ…' : 'احفظ'}</Button>
        </FormActions>
      </form>
    </Modal>
  )
}

const PayPayslip = ({ payslip, onClose }: { payslip: Payslip | null; onClose: () => void }) => {
  const accounts = useAccounts(payslip !== null)
  const pay = usePayPayslip()
  const [values, setValues] = useState({ account: '', paidOn: today() })
  const choices = payslip ? accountsIn(accounts.data, payslip.currency) : []
  useEffect(() => {
    if (!payslip) return
    pay.reset()
    setValues({ account: '', paidOn: today() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payslip?.payslip_id])
  useEffect(() => {
    if (choices.length === 1 && !values.account) setValues((current) => ({ ...current, account: choices[0]!.account_id }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices.length])
  return (
    <Modal open={payslip !== null} onClose={onClose} title="صرف الراتب">
      {payslip && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            pay.mutate({ payslipId: payslip.payslip_id, paid_on: values.paidOn, ...(payslip.net > 0 ? { account_id: values.account } : {}) }, { onSuccess: onClose })
          }}
          className="space-y-4"
        >
          <p className="text-sm text-ink-soft">{payslip.full_name} · {payslip.period} · الصافي <Money value={payslip.net} currency={payslip.currency} className="font-semibold text-ink" /></p>
          {payslip.net > 0 && (
            <SelectField label="من الحساب" name="payslip_account" required value={values.account} onChange={(event) => setValues((current) => ({ ...current, account: event.target.value }))} options={[['', choices.length ? 'اختر حساباً' : 'لا حساب بعملة الراتب'], ...choices.map((account) => [account.account_id, account.name] as const)]} />
          )}
          <Field label="تاريخ الصرف" name="paid_on" type="date" dir="ltr" required value={values.paidOn} onChange={(event) => setValues((current) => ({ ...current, paidOn: event.target.value }))} />
          <p className="text-xs text-ink-faint">يُسجَّل الصافي مصروف رواتب من الحساب المختار، ولا يمكن تعديل الراتب بعد صرفه.</p>
          <FormActions error={pay.isError ? messageOf(pay.error) : null}>
            <Button variant="line" onClick={onClose}>إلغاء</Button>
            <Button type="submit" variant="ink" disabled={(payslip.net > 0 && !values.account) || pay.isPending}>{pay.isPending ? 'يُصرف…' : 'اصرف'}</Button>
          </FormActions>
        </form>
      )}
    </Modal>
  )
}

const PayrollTab = () => {
  const [month, setMonth] = useState(thisMonth)
  const payslips = usePayslips(month)
  const advances = useAdvances()
  const prepare = usePreparePayroll()
  const remove = useDeletePayslip()
  const [editing, setEditing] = useState<Payslip | null>(null)
  const [paying, setPaying] = useState<Payslip | null>(null)
  const [advancing, setAdvancing] = useState(false)
  const drafts = (payslips.data ?? []).filter((slip) => slip.status === 'draft').length
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="الشهر" name="payroll_month" type="month" dir="ltr" className="w-44" value={month} onChange={(event) => setMonth(event.target.value || thisMonth())} />
          <Button variant="ink" size="sm" disabled={prepare.isPending} onClick={() => prepare.mutate(month)}>
            <CalendarPlus className="size-4" aria-hidden="true" />
            {prepare.isPending ? 'يُحضَّر…' : 'حضّر رواتب الشهر'}
          </Button>
        </div>
        <Button variant="line" size="sm" onClick={() => setAdvancing(true)}>
          <HandCoins className="size-4" aria-hidden="true" />
          سلفة على الراتب
        </Button>
      </div>
      {prepare.isSuccess && <p role="status" className="mb-3 text-sm text-ink-soft">{prepare.data.created === 0 ? 'لا رواتب جديدة: لكل عضو له راتب كشفٌ لهذا الشهر.' : `حُضّرت ${prepare.data.created} كشوف رواتب جديدة.`}</p>}
      {prepare.isError && <p role="alert" className="mb-3 text-sm text-stamp">{messageOf(prepare.error)}</p>}
      {payslips.isPending ? <Loading /> : payslips.isError ? <Failed error={payslips.error} /> : payslips.data.length === 0 ? (
        <Empty>لا كشوف رواتب لهذا الشهر. اضغط «حضّر رواتب الشهر» لمن له راتب في سجلّه.</Empty>
      ) : (
        <Table head={['العضو', 'الراتب', 'سُلف', 'خصومات', 'الصافي', 'الحالة', '']} min={720}>
          {payslips.data.map((slip) => (
            <tr key={slip.payslip_id} className="border-b border-rule">
              <td className={cn(TD, 'font-semibold')}>{slip.full_name}</td>
              <td className={TD}><Money value={slip.salary} currency={slip.currency} /></td>
              <td className={TD}>{slip.advance_deduction > 0 ? <Money value={slip.advance_deduction} currency={slip.currency} /> : '—'}</td>
              <td className={TD}>
                {slip.other_deductions > 0 ? <Money value={slip.other_deductions} currency={slip.currency} /> : '—'}
                {slip.deduction_note && <p className="text-xs text-ink-faint">{slip.deduction_note}</p>}
              </td>
              <td className={cn(TD, 'font-semibold')}><Money value={slip.net} currency={slip.currency} /></td>
              <td className={TD}>
                {slip.status === 'paid' ? <Pill tone="green">صُرف</Pill> : <Pill tone="blue">مسودة</Pill>}
                {slip.paid_on && <p className="mt-1 text-xs text-ink-soft">{formatDate(slip.paid_on)}{slip.account_name ? ` · ${slip.account_name}` : ''}</p>}
              </td>
              <td className={cn(TD, 'text-end whitespace-nowrap')}>
                {slip.status === 'draft' && (
                  <div className="flex flex-col items-end gap-1">
                    <button type="button" onClick={() => setPaying(slip)} className={cn(LINK, 'text-stamp-green')}>اصرف</button>
                    <button type="button" onClick={() => setEditing(slip)} className={cn(LINK, 'text-stamp-blue')}>الخصومات</button>
                    <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(slip.payslip_id)} className={cn(LINK, 'text-stamp')}>احذف المسودة</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {drafts > 0 && <p className="mt-2 text-xs text-ink-faint">{drafts === 1 ? 'كشف واحد ما زال مسودة.' : `${drafts} كشوف ما زالت مسودات.`}</p>}
      {remove.isError && <p role="alert" className="mt-2 text-sm text-stamp">{messageOf(remove.error)}</p>}

      <h2 className="mt-8 mb-3 text-xl text-ink">السُلف</h2>
      {advances.isPending ? <Loading /> : advances.isError ? <Failed error={advances.error} /> : advances.data.length === 0 ? <Empty>لا سُلف بعد.</Empty> : (
        <Table head={['العضو', 'التاريخ', 'المبلغ', 'من', 'ملاحظة']}>
          {advances.data.map((advance) => (
            <tr key={advance.advance_id} className="border-b border-rule">
              <td className={TD}>{advance.full_name}</td>
              <td className={cn(TD, 'whitespace-nowrap text-ink-soft')}>{formatDate(advance.given_on)}</td>
              <td className={TD}><Money value={advance.amount} currency={advance.currency} /></td>
              <td className={TD}>{advance.account_name ?? '—'}</td>
              <td className={TD}>{advance.note ?? '—'}</td>
            </tr>
          ))}
        </Table>
      )}
      <EditPayslip payslip={editing} onClose={() => setEditing(null)} />
      <PayPayslip payslip={paying} onClose={() => setPaying(null)} />
      <GiveAdvance open={advancing} onClose={() => setAdvancing(false)} />
    </>
  )
}

/* ───────────────────────── leave approvals ───────────────────────── */

const DecideLeave = ({ leave, decision, onClose }: { leave: LeaveRequest | null; decision: 'approved' | 'rejected'; onClose: () => void }) => {
  const decide = useDecideLeave()
  const [note, setNote] = useState('')
  useEffect(() => {
    if (leave) {
      decide.reset()
      setNote('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leave?.leave_id, decision])
  return (
    <Modal open={leave !== null} onClose={onClose} title={decision === 'approved' ? 'الموافقة على الإجازة' : 'رفض الإجازة'}>
      {leave && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            decide.mutate({ leaveId: leave.leave_id, status: decision, ...(note.trim() ? { decision_note: note.trim() } : {}) }, { onSuccess: onClose })
          }}
          className="space-y-4"
        >
          <p className="text-sm text-ink">{leave.full_name} · إجازة {LEAVE_TYPE[leave.leave_type]} · <bdi>{formatDate(leave.starts_on)} – {formatDate(leave.ends_on)}</bdi> ({leave.days} أيام عمل)</p>
          <TextArea label="ملاحظة لصاحب الطلب (اختياري)" name="decision_note" value={note} onChange={(event) => setNote(event.target.value)} />
          <FormActions error={decide.isError ? messageOf(decide.error) : null}>
            <Button variant="line" onClick={onClose}>إلغاء</Button>
            <Button type="submit" variant={decision === 'approved' ? 'ink' : 'stamp'} disabled={decide.isPending}>{decide.isPending ? 'يُحفظ…' : decision === 'approved' ? 'وافق' : 'ارفض'}</Button>
          </FormActions>
        </form>
      )}
    </Modal>
  )
}

const LeaveTab = () => {
  const [status, setStatus] = useState<'pending' | ''>('pending')
  const requests = useLeaveRequests(status || undefined)
  const cancel = useCancelLeave()
  const [deciding, setDeciding] = useState<{ leave: LeaveRequest; decision: 'approved' | 'rejected' } | null>(null)
  return (
    <>
      <SelectField label="الطلبات" name="leave_filter" className="mb-4 w-48" value={status} onChange={(event) => setStatus(event.target.value as 'pending' | '')} options={[['pending', 'بانتظار القرار'], ['', 'كل الطلبات']]} />
      {requests.isPending ? <Loading /> : requests.isError ? <Failed error={requests.error} /> : requests.data.length === 0 ? <Empty>{status === 'pending' ? 'لا طلبات إجازة بانتظار قرارك.' : 'لا طلبات إجازة.'}</Empty> : (
        <LeaveTable
          rows={requests.data}
          actions={(leave) => (
            <div className="flex flex-col items-end gap-1">
              {leave.status === 'pending' && (
                <>
                  <button type="button" onClick={() => setDeciding({ leave, decision: 'approved' })} className={cn(LINK, 'inline-flex items-center gap-1 text-stamp-green')}><Check className="size-3.5" aria-hidden="true" />وافق</button>
                  <button type="button" onClick={() => setDeciding({ leave, decision: 'rejected' })} className={cn(LINK, 'inline-flex items-center gap-1 text-stamp')}><X className="size-3.5" aria-hidden="true" />ارفض</button>
                </>
              )}
              {leave.status === 'approved' && leave.starts_on > today() && (
                <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate(leave.leave_id)} className={cn(LINK, 'text-ink-soft')}>ألغِ الإجازة</button>
              )}
            </div>
          )}
        />
      )}
      {cancel.isError && <p role="alert" className="mt-2 text-sm text-stamp">{messageOf(cancel.error)}</p>}
      <DecideLeave leave={deciding?.leave ?? null} decision={deciding?.decision ?? 'approved'} onClose={() => setDeciding(null)} />
    </>
  )
}

/* ───────────────────────── the team page ───────────────────────── */

const TEAM_TABS = [
  ['members', 'الأعضاء والدعوات'],
  ['records', 'سجلّات الفريق'],
  ['payroll', 'الرواتب والسُلف'],
  ['leave', 'الإجازات'],
] as const

/** The office administrator's team: members and invitations, staff records, payroll and leave. */
export const TeamPage = () => {
  const [tabParam, setTabParam] = useParam('tab')
  const tab = oneOf(tabParam, TEAM_TABS.map(([key]) => key), 'members')
  const pending = useLeaveRequests('pending')
  return (
    <>
      <div role="tablist" aria-label="أقسام الفريق" className="mb-6 flex flex-wrap gap-1 border-b border-rule">
        {TEAM_TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTabParam(key === 'members' ? null : key)}
            className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors', tab === key ? 'border-stamp text-ink' : 'border-transparent text-ink-soft hover:text-ink')}
          >
            {label}
            {key === 'leave' && (pending.data?.length ?? 0) > 0 && <span className="ms-1.5 rounded-full bg-stamp px-1.5 text-[0.65rem] text-paper">{pending.data!.length}</span>}
          </button>
        ))}
      </div>
      {tab === 'members' && <Team />}
      {tab === 'records' && <><SheetHeader title="سجلّات الفريق" note="بيانات كل عضو، وراتبه، وما عليه من سُلف، ورصيد إجازته السنوية لهذا العام." /><RecordsTab /></>}
      {tab === 'payroll' && <><SheetHeader title="الرواتب والسُلف" note="كشوف رواتب كل شهر: تُحضَّر مسودات، تُعدَّل خصوماتها، ثم تُصرف من حساب المكتب." /><PayrollTab /></>}
      {tab === 'leave' && <><SheetHeader title="الإجازات" note="طلبات إجازة الفريق. الإجازات الموافق عليها تظهر في التقويم." /><LeaveTab /></>}
    </>
  )
}

/* ───────────────────────── a person's own page ───────────────────────── */

const RequestLeave = ({ open, onClose, remaining }: { open: boolean; onClose: () => void; remaining: number }) => {
  const request = useRequestLeave()
  const [values, setValues] = useState({ type: 'annual' as LeaveType, startsOn: '', endsOn: '', reason: '' })
  useEffect(() => {
    if (open) {
      request.reset()
      setValues({ type: 'annual', startsOn: '', endsOn: '', reason: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const days = leaveDays(values.startsOn, values.endsOn)
  const over = values.type === 'annual' && days > remaining
  return (
    <Modal open={open} onClose={onClose} title="طلب إجازة">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          request.mutate({ leave_type: values.type, starts_on: values.startsOn, ends_on: values.endsOn, ...(values.reason.trim() ? { reason: values.reason.trim() } : {}) }, { onSuccess: onClose })
        }}
        className="space-y-4"
      >
        <SelectField label="نوع الإجازة" name="leave_type" value={values.type} onChange={(event) => setValues((current) => ({ ...current, type: event.target.value as LeaveType }))} options={Object.entries(LEAVE_TYPE)} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="من" name="starts_on" type="date" dir="ltr" required value={values.startsOn} onChange={(event) => setValues((current) => ({ ...current, startsOn: event.target.value }))} />
          <Field label="إلى" name="ends_on" type="date" dir="ltr" required min={values.startsOn || undefined} value={values.endsOn} onChange={(event) => setValues((current) => ({ ...current, endsOn: event.target.value }))} />
        </div>
        <p className={cn('text-sm', over ? 'font-semibold text-stamp' : 'text-ink-soft')}>
          {days} أيام عمل (دون أيام الجمعة){values.type === 'annual' && ` · المتبقي من إجازتك السنوية ${remaining}`}
        </p>
        <TextArea label="السبب (اختياري)" name="leave_reason" value={values.reason} onChange={(event) => setValues((current) => ({ ...current, reason: event.target.value }))} />
        <FormActions error={request.isError ? messageOf(request.error) : null}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="ink" disabled={days === 0 || over || request.isPending}>{request.isPending ? 'يُرسل…' : 'أرسل الطلب'}</Button>
        </FormActions>
      </form>
    </Modal>
  )
}

/** Everyone's own HR page: their record, leave balance and requests, payslips and advances. */
export const MyHr = () => {
  const mine = useMyHr()
  const cancel = useCancelLeave()
  const [requesting, setRequesting] = useState(false)
  if (mine.isPending) return <Loading />
  if (mine.isError) return <Failed error={mine.error} />
  const { profile, payslips, leave, advances } = mine.data
  return (
    <>
      <SheetHeader
        title="صفحتي"
        note="سجلّك في المكتب، ورصيد إجازتك، وطلباتك، ورواتبك المصروفة."
        action={<Button variant="ink" size="sm" onClick={() => setRequesting(true)}><CalendarPlus className="size-4" aria-hidden="true" />طلب إجازة</Button>}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border border-ink/15 bg-paper/60 p-4">
          <p className="text-xs text-ink-faint">المتبقي من الإجازة السنوية</p>
          <p className="text-3xl tabular-nums text-ink">{profile.annual_remaining}</p>
          <p className="text-xs text-ink-soft">من {profile.annual_leave_days} لهذا العام{profile.annual_pending > 0 ? ` · ${profile.annual_pending} بانتظار القرار` : ''}</p>
        </div>
        <div className="rounded-md border border-ink/15 bg-paper/60 p-4">
          <p className="text-xs text-ink-faint">المسمّى</p>
          <p className="text-lg text-ink">{profile.job_title ?? ROLE[profile.role]}</p>
          {profile.hire_date && <p className="text-xs text-ink-soft">منذ {formatDate(profile.hire_date)}</p>}
        </div>
        <div className="rounded-md border border-ink/15 bg-paper/60 p-4">
          <p className="text-xs text-ink-faint">الراتب الشهري</p>
          <p className="text-lg text-ink">{profile.monthly_salary === null ? '—' : <Money value={profile.monthly_salary} currency={profile.salary_currency} />}</p>
        </div>
        <div className="rounded-md border border-ink/15 bg-paper/60 p-4">
          <p className="text-xs text-ink-faint">سُلف مستحقة عليك</p>
          <p className={cn('text-lg', profile.advances_owed > 0 ? 'text-stamp' : 'text-ink')}><Money value={profile.advances_owed} currency={profile.salary_currency} /></p>
        </div>
      </div>

      <h2 className="mb-3 text-xl text-ink">طلبات الإجازة</h2>
      {leave.length === 0 ? <Empty>لم تطلب أي إجازة بعد.</Empty> : (
        <LeaveTable
          rows={leave}
          showName={false}
          actions={(entry) => entry.status === 'pending' && (
            <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate(entry.leave_id)} className={cn(LINK, 'text-stamp')}>اسحب الطلب</button>
          )}
        />
      )}
      {cancel.isError && <p role="alert" className="mt-2 text-sm text-stamp">{messageOf(cancel.error)}</p>}

      <h2 className="mt-8 mb-3 text-xl text-ink">رواتبي</h2>
      {payslips.length === 0 ? <Empty>لا رواتب مصروفة بعد.</Empty> : (
        <Table head={['الشهر', 'الراتب', 'سُلف', 'خصومات', 'الصافي', 'صُرف في']}>
          {payslips.map((slip) => (
            <tr key={slip.payslip_id} className="border-b border-rule">
              <td className={cn(TD, 'font-semibold')} dir="ltr">{slip.period}</td>
              <td className={TD}><Money value={slip.salary} currency={slip.currency} /></td>
              <td className={TD}>{slip.advance_deduction > 0 ? <Money value={slip.advance_deduction} currency={slip.currency} /> : '—'}</td>
              <td className={TD}>{slip.other_deductions > 0 ? <Money value={slip.other_deductions} currency={slip.currency} /> : '—'}{slip.deduction_note && <p className="text-xs text-ink-faint">{slip.deduction_note}</p>}</td>
              <td className={cn(TD, 'font-semibold')}><Money value={slip.net} currency={slip.currency} /></td>
              <td className={cn(TD, 'whitespace-nowrap text-ink-soft')}>{slip.paid_on ? formatDate(slip.paid_on) : '—'}</td>
            </tr>
          ))}
        </Table>
      )}

      {advances.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-xl text-ink">سُلفي</h2>
          <Table head={['التاريخ', 'المبلغ', 'ملاحظة']} min={360}>
            {advances.map((advance) => (
              <tr key={advance.advance_id} className="border-b border-rule">
                <td className={cn(TD, 'whitespace-nowrap')}>{formatDate(advance.given_on)}</td>
                <td className={TD}><Money value={advance.amount} currency={advance.currency} /></td>
                <td className={TD}>{advance.note ?? '—'}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
      <RequestLeave open={requesting} onClose={() => setRequesting(false)} remaining={profile.annual_remaining} />
    </>
  )
}
