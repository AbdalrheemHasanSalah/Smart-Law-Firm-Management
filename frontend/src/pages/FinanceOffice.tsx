import { useQuery } from '@tanstack/react-query'
import { ArrowLeftRight, FileCheck2, Plus, Wallet } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEMO, api, messageOf } from '@/lib/api'
import { CURRENCY, formatDate, formatMoney, optionsOf } from '@/lib/labels'
import { LOCALE } from '@/lib/i18n'
import {
  ACCOUNT_TYPE,
  accountsIn,
  EXPENSE_CATEGORY,
  expenseReceiptUrl,
  LEDGER_KIND,
  MAX_RECEIPT_BYTES,
  RECEIPT_TYPES,
  thisYear,
  useAccounts,
  useCancelExpense,
  useCaseProfitability,
  useCreateAccount,
  useCustodies,
  useExpenses,
  useIssueCustody,
  useLedger,
  useProfitability,
  useRecordExpense,
  useSettleCustody,
  useTransfer,
  useUpdateAccount,
  type AccountType,
  type Currency,
  type Custody,
  type Expense,
  type ExpenseCategory,
  type FinanceAccount,
} from '@/lib/officeFinance'
import type { Member } from '@/lib/types'
import { FormActions, Modal, SelectField, TextArea } from '@/ui/forms'
import { Button, cn, Field } from '@/ui/kit'
import { Empty, Failed, Loading, Pill } from '@/ui/Shell'
import { useCases } from './Office'

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
          {head.map((cell, index) => (
            <th key={`${cell}-${index}`} scope="col" className={TH}>{cell}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
)

const Section = ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) => (
  <section className="mb-8">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl text-ink">{title}</h2>
      {action}
    </div>
    {children}
  </section>
)

const Signed = ({ value, currency }: { value: number; currency: Currency }) => (
  <span className={cn('tabular-nums', value < 0 ? 'text-stamp' : value > 0 ? 'text-stamp-green' : 'text-ink')}>
    <bdi>{formatMoney(value, currency)}</bdi>
  </span>
)

const useStaff = (enabled: boolean) =>
  useQuery({
    queryKey: ['members'],
    enabled,
    queryFn: async () => (await api.get<{ users: Member[] }>('/users', { params: { pageSize: 50 } })).data.users,
    select: (members) => members.filter((member) => member.role !== 'client' && member.status === 'active'),
  })

const checkReceipt = (file: File | null) =>
  file && (!(RECEIPT_TYPES as readonly string[]).includes(file.type) || file.size > MAX_RECEIPT_BYTES)
    ? 'الإيصال يجب أن يكون PDF أو PNG أو JPG، حتى 5 ميغابايت.'
    : null

/* ───────────────────────── expenses ───────────────────────── */

/**
 * Records an expense. The administrator pays from an account or a custody; a custody holder
 * (`holderMode`) only from their own open custodies.
 */
export const ExpenseForm = ({ open, onClose, holderMode = false, custodyId }: { open: boolean; onClose: () => void; holderMode?: boolean; custodyId?: string }) => {
  const accounts = useAccounts(open && !holderMode)
  const custodies = useCustodies({ status: 'open' })
  const cases = useCases()
  const record = useRecordExpense()
  const empty = { category: 'transport' as ExpenseCategory, amount: '', spentOn: today(), payee: '', description: '', caseId: '', source: custodyId ? `custody:${custodyId}` : '' }
  const [values, setValues] = useState(empty)
  const [receipt, setReceipt] = useState<File | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    record.reset()
    setValues({ ...empty, source: custodyId ? `custody:${custodyId}` : '' })
    setReceipt(null)
    setLocalError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, custodyId])
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => setValues((current) => ({ ...current, [key]: value }))
  const sources = [
    ...(holderMode ? [] : (accounts.data ?? []).filter((account) => account.is_active).map((account) => [`account:${account.account_id}`, `${account.name} (${CURRENCY[account.currency]})`] as const)),
    ...(custodies.data ?? []).filter((custody) => custody.status === 'open').map((custody) => [`custody:${custody.custody_id}`, `عُهدة ${custody.holder_name} — متبقٍّ ${formatMoney(custody.remaining, custody.currency)}`] as const),
  ]
  const [kind, id] = values.source.split(':')
  const custody = kind === 'custody' ? custodies.data?.find((entry) => entry.custody_id === id) : undefined
  const over = custody !== undefined && Number(values.amount) > custody.remaining
  const ready = values.source && Number(values.amount) > 0 && values.spentOn && !over

  return (
    <Modal open={open} onClose={onClose} title="مصروف جديد" wide>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const problem = checkReceipt(receipt)
          if (problem) return setLocalError(problem)
          setLocalError(null)
          record.mutate(
            {
              input: {
                category: values.category,
                amount: Number(values.amount),
                spent_on: values.spentOn,
                ...(values.payee.trim() ? { payee: values.payee.trim() } : {}),
                ...(values.description.trim() ? { description: values.description.trim() } : {}),
                ...(values.caseId ? { case_id: values.caseId } : {}),
                ...(kind === 'account' ? { account_id: id } : { custody_id: id }),
              },
              receipt: receipt ? { file: receipt, type: receipt.type } : null,
            },
            {
              onSuccess: ({ receiptError }) => {
                if (receiptError) setLocalError(`سُجّل المصروف، لكن تعذّر رفع الإيصال: ${messageOf(receiptError)} أرفقه لاحقاً.`)
                else onClose()
              },
            },
          )
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <SelectField label="من أين دُفع؟" name="source" required className="sm:col-span-2" value={values.source} onChange={(event) => set('source', event.target.value)} options={[['', sources.length ? 'اختر الحساب أو العُهدة' : 'لا حسابات أو عُهد مفتوحة'], ...sources]} />
        <SelectField label="البند" name="category" value={values.category} onChange={(event) => set('category', event.target.value as ExpenseCategory)} options={Object.entries(EXPENSE_CATEGORY)} />
        <Field label="المبلغ" name="amount" type="number" min="0.01" step="0.01" dir="ltr" required value={values.amount} onChange={(event) => set('amount', event.target.value)} error={over ? 'أكثر من المتبقي في العُهدة' : undefined} />
        <Field label="التاريخ" name="spent_on" type="date" dir="ltr" required max={today()} value={values.spentOn} onChange={(event) => set('spentOn', event.target.value)} />
        <Field label="الجهة المدفوع لها (اختياري)" name="payee" placeholder="المؤجر، المكتبة، سيارة أجرة…" value={values.payee} onChange={(event) => set('payee', event.target.value)} />
        <SelectField label="القضية (اختياري)" name="case" className="sm:col-span-2" value={values.caseId} onChange={(event) => set('caseId', event.target.value)} options={[['', 'مصروف عام للمكتب'], ...(cases.data ?? []).map((row) => [row.case_id, `${row.case_number} — ${row.title}`] as const)]} />
        <TextArea label="التفاصيل (اختياري)" name="expense_description" className="sm:col-span-2" value={values.description} onChange={(event) => set('description', event.target.value)} />
        <div className="sm:col-span-2">
          <label htmlFor="expense-receipt" className="block text-xs font-semibold text-ink-soft">الإيصال (PDF أو صورة، حتى 5 ميغابايت، اختياري)</label>
          <input id="expense-receipt" type="file" accept={RECEIPT_TYPES.join(',')} onChange={(event) => setReceipt(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm text-ink file:me-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-2 file:text-sm file:font-semibold file:text-paper" />
        </div>
        <div className="sm:col-span-2">
          <FormActions error={localError ?? (record.isError ? messageOf(record.error) : null)}>
            <Button variant="line" onClick={onClose}>إلغاء</Button>
            <Button type="submit" variant="ink" disabled={!ready || record.isPending}>{record.isPending ? 'يُسجَّل…' : 'سجّل المصروف'}</Button>
          </FormActions>
        </div>
      </form>
    </Modal>
  )
}

const ExpensesTable = ({ rows, canCancel }: { rows: Expense[]; canCancel: (expense: Expense) => boolean }) => {
  const cancel = useCancelExpense()
  return (
    <>
      <Table head={['التاريخ', 'البند', 'الجهة', 'من', 'القضية', 'المبلغ', '']}>
        {rows.map((expense) => (
          <tr key={expense.expense_id} className={cn('border-b border-rule', expense.status === 'cancelled' && 'opacity-55')}>
            <td className={cn(TD, 'whitespace-nowrap text-ink-soft')}>{formatDate(expense.spent_on)}</td>
            <td className={TD}>
              {EXPENSE_CATEGORY[expense.category]}
              {expense.description && <p className="text-xs text-ink-faint">{expense.description}</p>}
            </td>
            <td className={TD}>{expense.payee ?? '—'}</td>
            <td className={TD}>{expense.account_name ?? (expense.custody_holder_name ? `عُهدة ${expense.custody_holder_name}` : '—')}</td>
            <td className={TD}><bdi dir="ltr">{expense.case_number ?? '—'}</bdi></td>
            <td className={cn(TD, 'whitespace-nowrap tabular-nums font-semibold', expense.status === 'cancelled' && 'line-through')}><bdi>{formatMoney(expense.amount, expense.currency)}</bdi></td>
            <td className={cn(TD, 'text-end whitespace-nowrap')}>
              <div className="flex flex-col items-end gap-1">
                {expense.status === 'cancelled' && <Pill tone="ink">ملغى</Pill>}
                {expense.has_receipt && (DEMO
                  ? <span className="text-xs text-ink-faint">إيصال (تجريبي)</span>
                  : <a href={expenseReceiptUrl(expense.expense_id)} target="_blank" rel="noreferrer" className={cn(LINK, 'inline-flex items-center gap-1 text-stamp-blue')}><FileCheck2 className="size-4" aria-hidden="true" />الإيصال</a>)}
                {expense.status === 'active' && canCancel(expense) && (
                  <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate(expense.expense_id)} className={cn(LINK, 'text-stamp')}>إلغاء المصروف</button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </Table>
      {cancel.isError && <p role="alert" className="mt-2 text-sm text-stamp">{messageOf(cancel.error)}</p>}
    </>
  )
}

export const ExpensesTab = () => {
  const [range, setRange] = useState(thisYear)
  const [category, setCategory] = useState('')
  const [adding, setAdding] = useState(false)
  const expenses = useExpenses({ ...range, category: category || undefined })
  const totals = useMemo(() => {
    const sums: Partial<Record<Currency, number>> = {}
    for (const expense of expenses.data ?? []) if (expense.status === 'active') sums[expense.currency] = (sums[expense.currency] ?? 0) + expense.amount
    return Object.entries(sums) as [Currency, number][]
  }, [expenses.data])
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="من" name="expenses_from" type="date" dir="ltr" className="w-40" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} />
          <Field label="إلى" name="expenses_to" type="date" dir="ltr" className="w-40" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} />
          <SelectField label="البند" name="expenses_category" className="w-52" value={category} onChange={(event) => setCategory(event.target.value)} options={[['', 'كل البنود'], ...Object.entries(EXPENSE_CATEGORY)]} />
        </div>
        <Button variant="ink" size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden="true" />
          مصروف جديد
        </Button>
      </div>
      {totals.length > 0 && (
        <p className="mb-3 text-sm text-ink-soft">
          مجموع المصاريف في هذه الفترة: {totals.map(([currency, sum]) => <bdi key={currency} className="ms-2 font-semibold text-ink">{formatMoney(sum, currency)}</bdi>)}
        </p>
      )}
      {expenses.isPending ? <Loading /> : expenses.isError ? <Failed error={expenses.error} /> : expenses.data.length === 0 ? <Empty>لا مصاريف في هذه الفترة.</Empty> : <ExpensesTable rows={expenses.data} canCancel={() => true} />}
      <ExpenseForm open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

/* ───────────────────────── custodies ───────────────────────── */

const CustodyStatus = ({ custody }: { custody: Custody }) =>
  custody.status === 'open' ? <Pill tone="blue">مفتوحة</Pill> : <Pill tone="green">مسوّاة</Pill>

const IssueCustody = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const accounts = useAccounts(open)
  const staff = useStaff(open)
  const issue = useIssueCustody()
  const [values, setValues] = useState({ holder: '', account: '', amount: '', issuedOn: today(), purpose: '' })
  useEffect(() => {
    if (open) {
      issue.reset()
      setValues({ holder: '', account: '', amount: '', issuedOn: today(), purpose: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  return (
    <Modal open={open} onClose={onClose} title="صرف عُهدة">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          issue.mutate(
            { holder_user_id: values.holder, account_id: values.account, amount: Number(values.amount), issued_on: values.issuedOn, ...(values.purpose.trim() ? { purpose: values.purpose.trim() } : {}) },
            { onSuccess: onClose },
          )
        }}
        className="space-y-4"
      >
        <SelectField label="لمن؟" name="holder" required value={values.holder} onChange={set('holder')} options={[['', 'اختر عضواً'], ...(staff.data ?? []).map((member) => [member.user_id, member.full_name] as const)]} />
        <SelectField label="من الحساب" name="custody_account" required value={values.account} onChange={set('account')} options={[['', 'اختر حساباً'], ...(accounts.data ?? []).filter((account) => account.is_active).map((account) => [account.account_id, `${account.name} — ${formatMoney(account.balance, account.currency)}`] as const)]} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="المبلغ" name="custody_amount" type="number" min="0.01" step="0.01" dir="ltr" required value={values.amount} onChange={set('amount')} />
          <Field label="التاريخ" name="issued_on" type="date" dir="ltr" required value={values.issuedOn} onChange={set('issuedOn')} />
        </div>
        <TextArea label="الغرض (اختياري)" name="purpose" placeholder="رسوم ومواصلات قضايا الأسبوع…" value={values.purpose} onChange={set('purpose')} />
        <FormActions error={issue.isError ? messageOf(issue.error) : null}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="ink" disabled={!values.holder || !values.account || !(Number(values.amount) > 0) || issue.isPending}>{issue.isPending ? 'يُصرف…' : 'اصرف العُهدة'}</Button>
        </FormActions>
      </form>
    </Modal>
  )
}

const SettleCustody = ({ custody, onClose }: { custody: Custody | null; onClose: () => void }) => {
  const accounts = useAccounts(custody !== null)
  const settle = useSettleCustody()
  const [values, setValues] = useState({ settledOn: today(), account: '' })
  useEffect(() => {
    if (!custody) return
    settle.reset()
    setValues({ settledOn: today(), account: custody.account_id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custody?.custody_id])
  const choices = custody ? accountsIn(accounts.data, custody.currency) : []
  return (
    <Modal open={custody !== null} onClose={onClose} title="تسوية العُهدة">
      {custody && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            settle.mutate({ custodyId: custody.custody_id, settled_on: values.settledOn, ...(custody.remaining > 0 ? { return_account_id: values.account } : {}) }, { onSuccess: onClose })
          }}
          className="space-y-4"
        >
          <dl className="grid grid-cols-3 gap-2 rounded-md border border-ink/15 p-3 text-sm">
            <div><dt className="text-xs text-ink-faint">صُرف</dt><dd className="tabular-nums"><bdi>{formatMoney(custody.amount, custody.currency)}</bdi></dd></div>
            <div><dt className="text-xs text-ink-faint">أُنفق</dt><dd className="tabular-nums"><bdi>{formatMoney(custody.spent, custody.currency)}</bdi></dd></div>
            <div><dt className="text-xs text-ink-faint">يُردّ</dt><dd className="font-semibold tabular-nums"><bdi>{formatMoney(custody.remaining, custody.currency)}</bdi></dd></div>
          </dl>
          <Field label="تاريخ التسوية" name="settled_on" type="date" dir="ltr" required min={custody.issued_on} value={values.settledOn} onChange={(event) => setValues((current) => ({ ...current, settledOn: event.target.value }))} />
          {custody.remaining > 0 && (
            <SelectField label="يعود الباقي إلى" name="return_account" required value={values.account} onChange={(event) => setValues((current) => ({ ...current, account: event.target.value }))} options={[['', 'اختر حساباً'], ...choices.map((account) => [account.account_id, account.name] as const)]} />
          )}
          <p className="text-xs text-ink-faint">بعد التسوية لا يمكن تسجيل مصاريف جديدة على هذه العُهدة ولا إلغاء مصاريفها.</p>
          <FormActions error={settle.isError ? messageOf(settle.error) : null}>
            <Button variant="line" onClick={onClose}>إلغاء</Button>
            <Button type="submit" variant="ink" disabled={(custody.remaining > 0 && !values.account) || settle.isPending}>{settle.isPending ? 'تُسوّى…' : 'سوِّ العُهدة'}</Button>
          </FormActions>
        </form>
      )}
    </Modal>
  )
}

const CustodiesTable = ({ rows, onSettle, onSpend, onOpen }: { rows: Custody[]; onSettle?: (custody: Custody) => void; onSpend?: (custody: Custody) => void; onOpen?: (custody: Custody) => void }) => (
  <Table head={['صاحب العُهدة', 'صُرفت', 'المبلغ', 'أُنفق', 'المتبقي', 'الحالة', '']}>
    {rows.map((custody) => (
      <tr key={custody.custody_id} className="border-b border-rule">
        <td className={TD}>
          <p className="font-semibold">{custody.holder_name}</p>
          {custody.purpose && <p className="text-xs text-ink-faint">{custody.purpose}</p>}
        </td>
        <td className={cn(TD, 'whitespace-nowrap text-ink-soft')}>{formatDate(custody.issued_on)}</td>
        <td className={cn(TD, 'tabular-nums')}><bdi>{formatMoney(custody.amount, custody.currency)}</bdi></td>
        <td className={cn(TD, 'tabular-nums')}><bdi>{formatMoney(custody.spent, custody.currency)}</bdi></td>
        <td className={cn(TD, 'tabular-nums font-semibold')}><bdi>{formatMoney(custody.status === 'open' ? custody.remaining : 0, custody.currency)}</bdi></td>
        <td className={TD}>
          <CustodyStatus custody={custody} />
          {custody.settled_on && <p className="mt-1 text-xs text-ink-soft">{formatDate(custody.settled_on)}</p>}
        </td>
        <td className={cn(TD, 'text-end whitespace-nowrap')}>
          <div className="flex flex-col items-end gap-1">
            {onOpen && <button type="button" onClick={() => onOpen(custody)} className={cn(LINK, 'text-stamp-blue')}>المصاريف</button>}
            {custody.status === 'open' && onSpend && <button type="button" onClick={() => onSpend(custody)} className={cn(LINK, 'text-stamp-blue')}>سجّل مصروفاً</button>}
            {custody.status === 'open' && onSettle && <button type="button" onClick={() => onSettle(custody)} className={cn(LINK, 'text-stamp')}>سوِّها</button>}
          </div>
        </td>
      </tr>
    ))}
  </Table>
)

/** One custody's expenses, under its table. */
const CustodyExpenses = ({ custody }: { custody: Custody }) => {
  const expenses = useExpenses({ custodyId: custody.custody_id })
  return (
    <Section title={`مصاريف عُهدة ${custody.holder_name}`}>
      {expenses.isPending ? <Loading /> : expenses.isError ? <Failed error={expenses.error} /> : expenses.data.length === 0 ? <Empty>لم يُسجَّل أي مصروف على هذه العُهدة بعد.</Empty> : (
        <ExpensesTable rows={expenses.data} canCancel={() => custody.status === 'open'} />
      )}
    </Section>
  )
}

export const CustodiesTab = () => {
  const [status, setStatus] = useState('open')
  const custodies = useCustodies(status ? { status } : {})
  const [issuing, setIssuing] = useState(false)
  const [settling, setSettling] = useState<Custody | null>(null)
  const [viewing, setViewing] = useState<Custody | null>(null)
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SelectField label="الحالة" name="custody_status" className="w-44" value={status} onChange={(event) => setStatus(event.target.value)} options={[['open', 'المفتوحة'], ['settled', 'المسوّاة'], ['', 'الكل']]} />
        <Button variant="ink" size="sm" onClick={() => setIssuing(true)}>
          <Wallet className="size-4" aria-hidden="true" />
          صرف عُهدة
        </Button>
      </div>
      {custodies.isPending ? <Loading /> : custodies.isError ? <Failed error={custodies.error} /> : custodies.data.length === 0 ? <Empty>لا عُهد هنا.</Empty> : (
        <CustodiesTable rows={custodies.data} onSettle={setSettling} onOpen={setViewing} />
      )}
      {viewing && <div className="mt-8"><CustodyExpenses custody={viewing} /></div>}
      <IssueCustody open={issuing} onClose={() => setIssuing(false)} />
      <SettleCustody custody={settling} onClose={() => setSettling(null)} />
    </>
  )
}

/** A staff member's own custodies, what they spent from them, and recording the next expense. */
export const MyCustody = () => {
  const custodies = useCustodies()
  const [spending, setSpending] = useState<Custody | null>(null)
  const [viewing, setViewing] = useState<Custody | null>(null)
  const open = (custodies.data ?? []).filter((custody) => custody.status === 'open')
  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl text-ink">عُهدتي</h1>
        <p className="mt-1 text-sm text-ink-soft">النقد الذي سلّمك إياه المكتب، وما أنفقته منه بإيصالاته. يسوّي مدير المكتب العُهدة حين تنتهي.</p>
      </div>
      {open.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {open.map((custody) => (
            <div key={custody.custody_id} className="rounded-md border border-ink/15 bg-paper/60 p-4">
              <p className="text-xs text-ink-faint">المتبقي في العُهدة</p>
              <p className="text-3xl tabular-nums text-ink"><bdi>{formatMoney(custody.remaining, custody.currency)}</bdi></p>
              <p className="mt-1 text-xs text-ink-soft">من <bdi>{formatMoney(custody.amount, custody.currency)}</bdi> · {formatDate(custody.issued_on)}</p>
              <Button variant="ink" size="sm" className="mt-3" onClick={() => setSpending(custody)}>
                <Plus className="size-4" aria-hidden="true" />
                سجّل مصروفاً
              </Button>
            </div>
          ))}
        </div>
      )}
      {custodies.isPending ? <Loading /> : custodies.isError ? <Failed error={custodies.error} /> : custodies.data.length === 0 ? <Empty>لا عُهد باسمك.</Empty> : (
        <CustodiesTable rows={custodies.data} onSpend={setSpending} onOpen={setViewing} />
      )}
      {viewing && <div className="mt-8"><CustodyExpenses custody={viewing} /></div>}
      <ExpenseForm open={spending !== null} onClose={() => setSpending(null)} holderMode custodyId={spending?.custody_id} />
    </>
  )
}

/* ───────────────────────── accounts ───────────────────────── */

const NewAccount = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const create = useCreateAccount()
  const empty = { name: '', type: 'cash' as AccountType, currency: 'ILS' as Currency, opening: '0', openedOn: today() }
  const [values, setValues] = useState(empty)
  useEffect(() => {
    if (open) {
      create.reset()
      setValues(empty)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  return (
    <Modal open={open} onClose={onClose} title="حساب جديد">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate({ name: values.name.trim(), account_type: values.type, currency: values.currency, opening_balance: Number(values.opening) || 0, opened_on: values.openedOn }, { onSuccess: onClose })
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field label="اسم الحساب" name="account_name" required placeholder="صندوق المكتب، بنك فلسطين…" className="sm:col-span-2" value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} />
        <SelectField label="النوع" name="account_type" value={values.type} onChange={(event) => setValues((current) => ({ ...current, type: event.target.value as AccountType }))} options={Object.entries(ACCOUNT_TYPE)} />
        <SelectField label="العملة" name="account_currency" value={values.currency} onChange={(event) => setValues((current) => ({ ...current, currency: event.target.value as Currency }))} options={optionsOf(CURRENCY)} />
        <Field label="الرصيد الافتتاحي" name="opening_balance" type="number" step="0.01" dir="ltr" value={values.opening} onChange={(event) => setValues((current) => ({ ...current, opening: event.target.value }))} />
        <Field label="بتاريخ" name="opened_on" type="date" dir="ltr" value={values.openedOn} onChange={(event) => setValues((current) => ({ ...current, openedOn: event.target.value }))} />
        <p className="text-xs text-ink-faint sm:col-span-2">لا تتغيّر عملة الحساب ولا رصيده الافتتاحي بعد إنشائه.</p>
        <div className="sm:col-span-2">
          <FormActions error={create.isError ? messageOf(create.error) : null}>
            <Button variant="line" onClick={onClose}>إلغاء</Button>
            <Button type="submit" variant="ink" disabled={!values.name.trim() || create.isPending}>{create.isPending ? 'يُنشأ…' : 'أنشئ الحساب'}</Button>
          </FormActions>
        </div>
      </form>
    </Modal>
  )
}

const TransferForm = ({ open, onClose, accounts }: { open: boolean; onClose: () => void; accounts: FinanceAccount[] }) => {
  const transfer = useTransfer()
  const [values, setValues] = useState({ from: '', to: '', amount: '', on: today(), note: '' })
  useEffect(() => {
    if (open) {
      transfer.reset()
      setValues({ from: '', to: '', amount: '', on: today(), note: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const source = accounts.find((account) => account.account_id === values.from)
  const targets = source ? accountsIn(accounts, source.currency).filter((account) => account.account_id !== source.account_id) : []
  return (
    <Modal open={open} onClose={onClose} title="تحويل بين حسابين">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          transfer.mutate({ from_account_id: values.from, to_account_id: values.to, amount: Number(values.amount), transferred_on: values.on, ...(values.note.trim() ? { note: values.note.trim() } : {}) }, { onSuccess: onClose })
        }}
        className="space-y-4"
      >
        <SelectField label="من" name="transfer_from" required value={values.from} onChange={(event) => setValues((current) => ({ ...current, from: event.target.value, to: '' }))} options={[['', 'اختر حساباً'], ...accounts.filter((account) => account.is_active).map((account) => [account.account_id, `${account.name} — ${formatMoney(account.balance, account.currency)}`] as const)]} />
        <SelectField label="إلى" name="transfer_to" required value={values.to} onChange={set('to')} options={[['', source ? (targets.length ? 'اختر حساباً' : 'لا حساب آخر بالعملة نفسها') : 'اختر المصدر أولاً'], ...targets.map((account) => [account.account_id, account.name] as const)]} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="المبلغ" name="transfer_amount" type="number" min="0.01" step="0.01" dir="ltr" required value={values.amount} onChange={set('amount')} />
          <Field label="التاريخ" name="transferred_on" type="date" dir="ltr" required value={values.on} onChange={set('on')} />
        </div>
        <Field label="ملاحظة (اختياري)" name="transfer_note" placeholder="إيداع نقد في البنك…" value={values.note} onChange={set('note')} />
        <FormActions error={transfer.isError ? messageOf(transfer.error) : null}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="ink" disabled={!values.from || !values.to || !(Number(values.amount) > 0) || transfer.isPending}>{transfer.isPending ? 'يُحوَّل…' : 'حوِّل'}</Button>
        </FormActions>
      </form>
    </Modal>
  )
}

const LedgerView = ({ account }: { account: FinanceAccount }) => {
  const [range, setRange] = useState(() => {
    const end = new Date()
    const start = new Date(end.getFullYear(), end.getMonth() - 2, 1)
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }
  })
  const ledger = useLedger(account.account_id, range)
  return (
    <Section
      title={`كشف ${account.name}`}
      action={
        <div className="flex flex-wrap items-end gap-3">
          <Field label="من" name="ledger_from" type="date" dir="ltr" className="w-40" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} />
          <Field label="إلى" name="ledger_to" type="date" dir="ltr" className="w-40" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} />
        </div>
      }
    >
      {ledger.isPending ? <Loading /> : ledger.isError ? <Failed error={ledger.error} /> : (
        <>
          <p className="mb-2 text-sm text-ink-soft">الرصيد في بداية الفترة: <bdi className="font-semibold text-ink">{formatMoney(ledger.data.balance_before, account.currency)}</bdi></p>
          {ledger.data.entries.length === 0 ? <Empty>لا حركات في هذه الفترة.</Empty> : (
            <Table head={['التاريخ', 'الحركة', 'البيان', 'المبلغ', 'الرصيد بعدها']}>
              {ledger.data.entries.map((entry) => (
                <tr key={`${entry.kind}-${entry.id}`} className="border-b border-rule">
                  <td className={cn(TD, 'whitespace-nowrap text-ink-soft')}>{formatDate(entry.on_date)}</td>
                  <td className={TD}>{LEDGER_KIND[entry.kind]}{entry.category ? ` — ${EXPENSE_CATEGORY[entry.category]}` : ''}</td>
                  <td className={TD}>{[entry.party, entry.reference].filter(Boolean).join(' · ') || '—'}</td>
                  <td className={TD}><Signed value={entry.amount} currency={account.currency} /></td>
                  <td className={cn(TD, 'tabular-nums')}><bdi>{formatMoney(entry.balance_after, account.currency)}</bdi></td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-2 text-sm text-ink-soft">الرصيد في نهاية الفترة: <bdi className="font-semibold text-ink">{formatMoney(ledger.data.balance_after, account.currency)}</bdi></p>
        </>
      )}
    </Section>
  )
}

export const AccountsTab = () => {
  const accounts = useAccounts()
  const update = useUpdateAccount()
  const [adding, setAdding] = useState(false)
  const [moving, setMoving] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const account = accounts.data?.find((entry) => entry.account_id === selected) ?? null
  return (
    <>
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <Button variant="line" size="sm" disabled={(accounts.data?.length ?? 0) < 2} onClick={() => setMoving(true)}>
          <ArrowLeftRight className="size-4" aria-hidden="true" />
          تحويل بين حسابين
        </Button>
        <Button variant="ink" size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden="true" />
          حساب جديد
        </Button>
      </div>
      {accounts.isPending ? <Loading /> : accounts.isError ? <Failed error={accounts.error} /> : accounts.data.length === 0 ? (
        <Empty>لا حسابات بعد. أنشئ صندوق المكتب أو حسابه البنكي لتتابع الأرصدة.</Empty>
      ) : (
        <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {accounts.data.map((entry) => (
            <div key={entry.account_id} className={cn('rounded-md border p-4', selected === entry.account_id ? 'border-ink bg-marker/20' : 'border-ink/15 bg-paper/60', !entry.is_active && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">{entry.name}</p>
                  <p className="text-xs text-ink-faint">{ACCOUNT_TYPE[entry.account_type]} · {CURRENCY[entry.currency]}{entry.is_active ? '' : ' · مغلق'}</p>
                </div>
              </div>
              <p className={cn('mt-2 text-2xl tabular-nums', entry.balance < 0 ? 'text-stamp' : 'text-ink')}><bdi>{formatMoney(entry.balance, entry.currency)}</bdi></p>
              <div className="mt-2 flex gap-3">
                <button type="button" onClick={() => setSelected(entry.account_id)} className={cn(LINK, 'text-stamp-blue')}>الكشف</button>
                <button type="button" disabled={update.isPending} onClick={() => update.mutate({ accountId: entry.account_id, patch: { is_active: !entry.is_active } })} className={cn(LINK, 'text-ink-soft')}>
                  {entry.is_active ? 'أغلق الحساب' : 'أعد فتحه'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {update.isError && <p role="alert" className="mb-4 text-sm text-stamp">{messageOf(update.error)}</p>}
      {account && <LedgerView key={account.account_id} account={account} />}
      <NewAccount open={adding} onClose={() => setAdding(false)} />
      <TransferForm open={moving} onClose={() => setMoving(false)} accounts={accounts.data ?? []} />
    </>
  )
}

/* ───────────────────────── profitability ───────────────────────── */

const monthName = new Intl.DateTimeFormat(LOCALE, { month: 'short', year: '2-digit' })

export const ProfitTab = () => {
  const years = Array.from({ length: 4 }, (_, index) => new Date().getFullYear() - index)
  const [year, setYear] = useState(years[0]!)
  const range = { from: `${year}-01-01`, to: `${year}-12-31` }
  const report = useProfitability(range)
  const currencies = report.data?.totals.map((entry) => entry.currency) ?? []
  const [currency, setCurrency] = useState<Currency | ''>('')
  const shown: Currency | undefined = currency || currencies[0]
  const months = (report.data?.months ?? []).filter((entry) => entry.currency === shown)
  const peak = Math.max(1, ...months.map((entry) => Math.max(entry.collected, entry.spent)))
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SelectField label="السنة" name="profit_year" className="w-32" value={String(year)} onChange={(event) => setYear(Number(event.target.value))} options={years.map((entry) => [String(entry), String(entry)] as const)} />
        {currencies.length > 1 && (
          <SelectField label="العملة" name="profit_currency" className="w-40" value={shown ?? ''} onChange={(event) => setCurrency(event.target.value as Currency)} options={currencies.map((entry) => [entry, CURRENCY[entry] ?? entry] as const)} />
        )}
      </div>
      {report.isPending ? <Loading /> : report.isError ? <Failed error={report.error} /> : report.data.totals.length === 0 ? (
        <Empty>لا دفعات ولا مصاريف مسجّلة في هذه السنة.</Empty>
      ) : (
        <>
          <div className="mb-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {report.data.totals.map((entry) => (
              <div key={entry.currency} className="rounded-md border border-ink/15 bg-paper/60 p-5">
                <p className="text-sm font-semibold text-ink-soft">{CURRENCY[entry.currency]}</p>
                <p className="mt-1 text-xs text-ink-faint">صافي الربح</p>
                <p className={cn('text-3xl tabular-nums', entry.net < 0 ? 'text-stamp' : 'text-ink')}><bdi>{formatMoney(entry.net, entry.currency)}</bdi></p>
                <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-rule pt-3 text-sm">
                  <div><dt className="text-xs text-ink-faint">المحصَّل من الموكّلين</dt><dd className="tabular-nums text-stamp-green"><bdi>{formatMoney(entry.collected, entry.currency)}</bdi></dd></div>
                  <div><dt className="text-xs text-ink-faint">مصاريف المكتب</dt><dd className="tabular-nums text-stamp"><bdi>{formatMoney(entry.spent, entry.currency)}</bdi></dd></div>
                </dl>
              </div>
            ))}
          </div>

          {shown && months.length > 0 && (
            <Section title={`شهراً بشهر (${CURRENCY[shown]})`}>
              <ul className="space-y-2">
                {months.map((entry) => (
                  <li key={entry.month} className="grid grid-cols-[5rem_minmax(0,1fr)_7rem] items-center gap-3 text-sm">
                    <span className="text-ink-soft">{monthName.format(new Date(`${entry.month}-01T00:00:00`))}</span>
                    <span className="space-y-1">
                      <span className="block h-2 rounded-full bg-stamp-green" style={{ width: `${(entry.collected / peak) * 100}%` }} title={`المحصَّل ${formatMoney(entry.collected, shown)}`} />
                      <span className="block h-2 rounded-full bg-stamp/70" style={{ width: `${(entry.spent / peak) * 100}%` }} title={`المصاريف ${formatMoney(entry.spent, shown)}`} />
                    </span>
                    <span className="text-end"><Signed value={entry.net} currency={shown} /></span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 flex gap-4 text-xs text-ink-faint">
                <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-stamp-green" />المحصَّل</span>
                <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-stamp/70" />المصاريف</span>
              </p>
            </Section>
          )}

          {report.data.by_category.length > 0 && (
            <Section title="المصاريف حسب البند">
              <Table head={['البند', 'المبلغ']} min={320}>
                {report.data.by_category.map((entry) => (
                  <tr key={`${entry.category}-${entry.currency}`} className="border-b border-rule">
                    <td className={TD}>{EXPENSE_CATEGORY[entry.category]}</td>
                    <td className={cn(TD, 'tabular-nums')}><bdi>{formatMoney(entry.spent, entry.currency)}</bdi></td>
                  </tr>
                ))}
              </Table>
            </Section>
          )}

          {report.data.cases.length > 0 && (
            <Section title="ربحية القضايا في هذه السنة">
              <Table head={['القضية', 'المحصَّل', 'مصاريفها', 'الصافي']}>
                {report.data.cases.map((entry) => (
                  <tr key={`${entry.case_id}-${entry.currency}`} className="border-b border-rule">
                    <td className={TD}><bdi dir="ltr" className="font-semibold">{entry.case_number}</bdi> <span className="text-ink-soft">— {entry.title}</span></td>
                    <td className={cn(TD, 'tabular-nums')}><bdi>{formatMoney(entry.collected, entry.currency)}</bdi></td>
                    <td className={cn(TD, 'tabular-nums')}><bdi>{formatMoney(entry.spent, entry.currency)}</bdi></td>
                    <td className={TD}><Signed value={entry.net} currency={entry.currency} /></td>
                  </tr>
                ))}
              </Table>
            </Section>
          )}
          <p className="text-xs text-ink-faint">الربح هنا هو ما دفعه الموكّلون فعلاً ناقص ما أنفقه المكتب، لكل عملة على حدة. العُهدة لا تُحسب مصروفاً حتى يُسجَّل ما أُنفق منها.</p>
        </>
      )}
    </>
  )
}

/** A case's results since it opened, for the administrator, at the top of the case's finance tab. */
export const CaseProfit = ({ caseId }: { caseId: string }) => {
  const result = useCaseProfitability(caseId)
  if (!result.data || result.data.length === 0) return null
  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-2">
      {result.data.map((entry) => (
        <div key={entry.currency} className="rounded-md border border-ink/15 bg-paper/60 p-4">
          <p className="text-xs text-ink-faint">ربحية القضية ({CURRENCY[entry.currency]})</p>
          <p className="text-2xl"><Signed value={entry.net} currency={entry.currency} /></p>
          <p className="mt-1 text-xs text-ink-soft">
            حُصّل <bdi>{formatMoney(entry.collected, entry.currency)}</bdi> من <bdi>{formatMoney(entry.billed, entry.currency)}</bdi> · أُنفق عليها <bdi>{formatMoney(entry.spent, entry.currency)}</bdi>
          </p>
        </div>
      ))}
    </div>
  )
}
