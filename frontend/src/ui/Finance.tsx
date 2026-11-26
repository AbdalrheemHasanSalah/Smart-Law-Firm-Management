import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, Ban } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { PATHS } from '@/auth/auth'
import { api, messageOf } from '@/lib/api'
import { CLIENT_PAYMENT_METHODS, CURRENCY, formatDate, formatMoney, INVOICE_CATEGORY, INVOICE_STATE, PAYMENT_METHOD } from '@/lib/labels'
import type { Client, Currency, Invoice, InvoiceCategory } from '@/lib/types'
import { FormActions, Modal, SelectField, TextArea } from './forms'
import { Button, cn, Field } from './kit'
import { Pill } from './Shell'

export const useInvoices = (params: { case_id?: string; client_id?: string; state?: string } = {}) =>
  useQuery({
    queryKey: ['invoices', params],
    queryFn: async () => (await api.get<{ invoices: Invoice[] }>('/finance/invoices', { params: { pageSize: 50, ...params } })).data.invoices,
  })

const refreshFinance = (queryClient: ReturnType<typeof useQueryClient>) => {
  void queryClient.invalidateQueries({ queryKey: ['invoices'] })
  void queryClient.invalidateQueries({ queryKey: ['finance-summary'] })
  void queryClient.invalidateQueries({ queryKey: ['statement'] })
}

const TH = 'pe-4 pb-2 text-start text-xs font-semibold text-ink-soft'
const TD = 'py-3 pe-4 align-middle text-sm text-ink'

/** Totals per currency from a list of invoices; money is never added across currencies. */
export const totalsOf = (invoices: Invoice[]) => {
  const totals = new Map<Currency, { billed: number; paid: number; remaining: number }>()
  for (const invoice of invoices) {
    if (invoice.status === 'cancelled') continue
    const entry = totals.get(invoice.currency) ?? { billed: 0, paid: 0, remaining: 0 }
    entry.billed += invoice.amount
    entry.paid += invoice.paid_amount
    entry.remaining += invoice.remaining
    totals.set(invoice.currency, entry)
  }
  return [...totals.entries()]
}

export const InvoiceTotals = ({ invoices }: { invoices: Invoice[] }) => {
  const totals = totalsOf(invoices)
  if (totals.length === 0) return null
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {totals.map(([currency, entry]) => (
        <div key={currency} className="rounded-md border border-ink/15 bg-paper/60 p-4">
          <p className="text-xs font-semibold text-ink-soft">{CURRENCY[currency]}</p>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-xs text-ink-faint">المطالب به</dt>
              <dd className="tabular-nums text-ink">{formatMoney(entry.billed, currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">المدفوع</dt>
              <dd className="tabular-nums text-stamp-green">{formatMoney(entry.paid, currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">المتبقي</dt>
              <dd className={cn('tabular-nums font-semibold', entry.remaining > 0 ? 'text-stamp' : 'text-ink')}>{formatMoney(entry.remaining, currency)}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  )
}

/** Invoices with their state; the office administrator records payments and cancels from here. */
export const InvoicesTable = ({ rows, owner, showClient = true, showCase = true }: { rows: Invoice[]; owner: boolean; showClient?: boolean; showCase?: boolean }) => {
  const queryClient = useQueryClient()
  const [paying, setPaying] = useState<Invoice | null>(null)
  const cancel = useMutation({
    mutationFn: (invoiceId: string) => api.post(`/finance/invoices/${invoiceId}/cancel`),
    onSuccess: () => refreshFinance(queryClient),
  })
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem]">
          <thead>
            <tr className="border-b-2 border-ink">
              {['الرقم', 'البند', ...(showClient ? ['الموكّل'] : []), ...(showCase ? ['القضية'] : []), 'المبلغ', 'المدفوع', 'الاستحقاق', 'الحالة', ''].map((cell) => (
                <th key={cell || 'actions'} className={TH}>
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((invoice) => {
              const state = INVOICE_STATE[invoice.state]
              const open = invoice.status === 'unpaid' || invoice.status === 'partially_paid'
              return (
                <tr key={invoice.invoice_id} className={cn('border-b border-rule transition-colors hover:bg-marker/25', invoice.status === 'cancelled' && 'opacity-55')}>
                  <td className={cn(TD, 'whitespace-nowrap font-semibold')} dir="ltr">
                    {invoice.invoice_number}
                  </td>
                  <td className={TD}>
                    <p className="font-semibold">{INVOICE_CATEGORY[invoice.category]}</p>
                    {invoice.description && <p className="text-xs text-ink-soft">{invoice.description}</p>}
                  </td>
                  {showClient && <td className={TD}>{invoice.client_name}</td>}
                  {showCase && (
                    <td className={TD}>
                      {invoice.case_id ? (
                        <Link to={`${PATHS.office}/cases/${invoice.case_id}`} className="underline-offset-4 hover:text-stamp hover:underline" dir="ltr">
                          {invoice.case_number}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
                  <td className={cn(TD, 'whitespace-nowrap tabular-nums')}>{formatMoney(invoice.amount, invoice.currency)}</td>
                  <td className={cn(TD, 'whitespace-nowrap tabular-nums text-ink-soft')}>{invoice.paid_amount > 0 ? formatMoney(invoice.paid_amount, invoice.currency) : '—'}</td>
                  <td className={cn(TD, 'whitespace-nowrap', invoice.state === 'overdue' ? 'font-semibold text-stamp' : 'text-ink-soft')}>{invoice.due_at ? formatDate(invoice.due_at) : '—'}</td>
                  <td className={TD}>{state && <Pill tone={state.tone}>{state.text}</Pill>}</td>
                  <td className={cn(TD, 'text-end whitespace-nowrap')}>
                    {owner && open && (
                      <span className="inline-flex gap-3">
                        <button type="button" onClick={() => setPaying(invoice)} className="inline-flex items-center gap-1 text-xs font-semibold text-stamp-blue underline-offset-4 hover:underline">
                          <Banknote className="size-3.5" aria-hidden="true" />
                          سجّل دفعة
                        </button>
                        {invoice.status === 'unpaid' && (
                          <button
                            type="button"
                            disabled={cancel.isPending}
                            onClick={() => window.confirm(`إلغاء الفاتورة ⁦${invoice.invoice_number}⁩؟`) && cancel.mutate(invoice.invoice_id)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-ink-soft underline-offset-4 hover:text-stamp hover:underline disabled:opacity-50"
                          >
                            <Ban className="size-3.5" aria-hidden="true" />
                            إلغاء
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {cancel.isError && <p role="alert" className="mt-2 text-sm text-stamp">{messageOf(cancel.error)}</p>}
      <RecordPayment invoice={paying} onClose={() => setPaying(null)} />
    </>
  )
}

const todayInput = () => new Date().toISOString().slice(0, 10)

const RecordPayment = ({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) => {
  const queryClient = useQueryClient()
  const [values, setValues] = useState({ amount: '', method: 'cash', paidAt: todayInput(), reference: '' })
  useEffect(() => {
    if (invoice) setValues({ amount: String(invoice.remaining), method: 'cash', paidAt: todayInput(), reference: '' })
  }, [invoice])
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const save = useMutation({
    mutationFn: () =>
      api.post(`/finance/invoices/${invoice!.invoice_id}/payments`, {
        amount: Number(values.amount),
        method: values.method,
        // Noon of the chosen day, so the date does not move with the time zone.
        paid_at: new Date(`${values.paidAt}T12:00:00`).toISOString(),
        ...(values.reference.trim() ? { reference: values.reference.trim() } : {}),
      }),
    onSuccess: () => {
      refreshFinance(queryClient)
      onClose()
    },
  })
  return (
    // U+2066/U+2069 isolate the number so right-to-left text does not reverse "2026-0001".
    <Modal open={invoice !== null} onClose={onClose} title={invoice ? `دفعة على الفاتورة ⁦${invoice.invoice_number}⁩` : 'دفعة'}>
      {invoice && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate()
          }}
          className="grid gap-4 sm:grid-cols-2"
        >
          <p className="text-sm text-ink-soft sm:col-span-2">
            {invoice.client_name} · المتبقي <span className="font-semibold text-ink">{formatMoney(invoice.remaining, invoice.currency)}</span>
          </p>
          <Field label={`المبلغ (${CURRENCY[invoice.currency]})`} name="amount" type="number" min="0.01" step="0.01" max={invoice.remaining} dir="ltr" required value={values.amount} onChange={set('amount')} />
          <SelectField label="طريقة الدفع" name="method" value={values.method} onChange={set('method')} options={CLIENT_PAYMENT_METHODS.map((method) => [method, PAYMENT_METHOD[method]!] as const)} />
          <Field label="تاريخ الدفع" name="paid_at" type="date" dir="ltr" max={todayInput()} required value={values.paidAt} onChange={set('paidAt')} />
          <Field label="رقم المرجع (اختياري)" name="reference" dir="ltr" value={values.reference} onChange={set('reference')} hint="رقم الشيك أو الحوالة." />
          <div className="sm:col-span-2">
            <FormActions error={save.isError ? messageOf(save.error) : null}>
              <Button variant="line" onClick={onClose}>
                إلغاء
              </Button>
              <Button type="submit" variant="ink" disabled={!(Number(values.amount) > 0) || save.isPending}>
                {save.isPending ? 'تُسجّل…' : 'سجّل الدفعة'}
              </Button>
            </FormActions>
          </div>
        </form>
      )}
    </Modal>
  )
}

/**
 * Bill a client. From a case, `clients` are the case's parties and the invoice is tied to the
 * case; from the finance page, any client of the office and no case.
 */
export const NewInvoice = ({ open, onClose, caseId, clients }: { open: boolean; onClose: () => void; caseId?: string; clients: Pick<Client, 'client_id' | 'full_name_or_org'>[] }) => {
  const queryClient = useQueryClient()
  const empty = { clientId: '', category: 'legal_fees' as InvoiceCategory, amount: '', currency: 'ILS' as Currency, description: '', due: '' }
  const [values, setValues] = useState(empty)
  useEffect(() => {
    if (open) setValues({ ...empty, clientId: clients.length === 1 ? clients[0]!.client_id : '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const save = useMutation({
    mutationFn: () =>
      api.post('/finance/invoices', {
        client_id: values.clientId,
        ...(caseId ? { case_id: caseId } : {}),
        category: values.category,
        amount: Number(values.amount),
        currency: values.currency,
        ...(values.description.trim() ? { description: values.description.trim() } : {}),
        ...(values.due ? { due_at: new Date(`${values.due}T23:59:00`).toISOString() } : {}),
      }),
    onSuccess: () => {
      refreshFinance(queryClient)
      onClose()
    },
  })
  return (
    <Modal open={open} onClose={onClose} title="مطالبة مالية جديدة">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <SelectField
          label="الموكّل"
          name="client"
          required
          value={values.clientId}
          onChange={set('clientId')}
          options={[['', clients.length ? 'اختر موكّلاً' : 'لا موكّلين مرتبطين'], ...clients.map((client) => [client.client_id, client.full_name_or_org] as const)]}
          className="sm:col-span-2"
        />
        <SelectField label="البند" name="category" value={values.category} onChange={set('category')} options={Object.entries(INVOICE_CATEGORY)} />
        <SelectField label="العملة" name="currency" value={values.currency} onChange={set('currency')} options={Object.entries(CURRENCY)} />
        <Field label="المبلغ" name="amount" type="number" min="0.01" step="0.01" dir="ltr" required value={values.amount} onChange={set('amount')} />
        <Field label="تاريخ الاستحقاق (اختياري)" name="due" type="date" dir="ltr" value={values.due} onChange={set('due')} />
        <TextArea label="الوصف (اختياري)" name="description" rows={2} maxLength={500} value={values.description} onChange={set('description')} className="sm:col-span-2" />
        <div className="sm:col-span-2">
          <FormActions error={save.isError ? messageOf(save.error) : null}>
            <Button variant="line" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" variant="ink" disabled={!values.clientId || !(Number(values.amount) > 0) || save.isPending}>
              {save.isPending ? 'تُحفظ…' : 'أصدر المطالبة'}
            </Button>
          </FormActions>
        </div>
      </form>
    </Modal>
  )
}
