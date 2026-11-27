import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { useState } from 'react'
import { oneOf, useParam } from '@/lib/useParam'
import { AccountsTab, CustodiesTab, ExpensesTab, ProfitTab } from './FinanceOffice'
import { Link, useParams } from 'react-router'
import { PATHS } from '@/auth/auth'
import { api } from '@/lib/api'
import { CURRENCY, formatDate, formatMoney, INVOICE_CATEGORY, INVOICE_STATE, PAYMENT_METHOD } from '@/lib/labels'
import type { Client, CurrencySummary, Statement } from '@/lib/types'
import { InvoicesTable, NewInvoice, useInvoices } from '@/ui/Finance'
import { Button, cn, Logo, Stamp } from '@/ui/kit'
import { Empty, Failed, Loading, SheetHeader } from '@/ui/Shell'

/* ───────────────────────── office finances ───────────────────────── */

const FILTERS = [
  ['open', 'المستحقة'],
  ['overdue', 'المتأخرة'],
  ['paid', 'المدفوعة'],
  ['', 'الكل'],
] as const

const SummaryCard = ({ summary }: { summary: CurrencySummary }) => (
  <div className="rounded-md border border-ink/15 bg-paper/60 p-5">
    <div className="flex items-baseline justify-between gap-2">
      <p className="text-sm font-semibold text-ink-soft">{CURRENCY[summary.currency]}</p>
      <p className="text-xs text-ink-faint">{summary.open_count} مطالبة مفتوحة</p>
    </div>
    <p className="mt-2 text-xs text-ink-faint">المتبقي على الموكّلين</p>
    <p className={cn('text-3xl tabular-nums', summary.outstanding > 0 ? 'text-stamp' : 'text-ink')}>{formatMoney(summary.outstanding, summary.currency)}</p>
    <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-rule pt-3 text-sm">
      <div>
        <dt className="text-xs text-ink-faint">المطالب به</dt>
        <dd className="tabular-nums text-ink">{formatMoney(summary.billed, summary.currency)}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink-faint">المحصّل</dt>
        <dd className="tabular-nums text-stamp-green">{formatMoney(summary.paid, summary.currency)}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink-faint">متأخر ({summary.overdue_count})</dt>
        <dd className={cn('tabular-nums', summary.overdue > 0 ? 'font-semibold text-stamp' : 'text-ink')}>{formatMoney(summary.overdue, summary.currency)}</dd>
      </div>
    </dl>
  </div>
)

const FINANCE_TABS = [
  ['claims', 'المطالبات'],
  ['expenses', 'المصاريف'],
  ['custodies', 'العُهد'],
  ['accounts', 'الحسابات'],
  ['profit', 'الربحية'],
] as const
type FinanceTab = (typeof FINANCE_TABS)[number][0]

/** The office's money: claims on clients, its own expenses and custodies, its accounts and its results. */
export const OfficeFinance = () => {
  const [tabParam, setTabParam] = useParam('tab')
  const tab = oneOf(tabParam, FINANCE_TABS.map(([key]) => key), 'claims')
  const setTab = (key: FinanceTab) => setTabParam(key === 'claims' ? null : key)
  return (
    <>
      <SheetHeader title="المالية" note="المطالبات على الموكّلين، ومصاريف المكتب وعُهده، وأرصدة حساباته، وربحيته — بكل عملة على حدة." />
      <div role="tablist" aria-label="أقسام المالية" className="mb-6 flex flex-wrap gap-1 border-b border-rule">
        {FINANCE_TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors', tab === key ? 'border-stamp text-ink' : 'border-transparent text-ink-soft hover:text-ink')}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'claims' && <ClaimsTab />}
      {tab === 'expenses' && <ExpensesTab />}
      {tab === 'custodies' && <CustodiesTab />}
      {tab === 'accounts' && <AccountsTab />}
      {tab === 'profit' && <ProfitTab />}
    </>
  )
}

const ClaimsTab = () => {
  const [state, setState] = useState<string>('open')
  const [billing, setBilling] = useState(false)
  const summary = useQuery({
    queryKey: ['finance-summary'],
    queryFn: async () => (await api.get<{ currencies: CurrencySummary[] }>('/finance/summary')).data.currencies,
  })
  const invoices = useInvoices(state ? { state } : {})
  const clients = useQuery({
    queryKey: ['clients', ''],
    queryFn: async () => (await api.get<{ clients: Client[] }>('/clients', { params: { pageSize: 50 } })).data.clients,
  })
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">أتعاب المكتب ورسوم المحاكم والمصاريف المطالب بها، وما حُصّل منها.</p>
        <Button variant="stamp" size="sm" onClick={() => setBilling(true)}>
          مطالبة جديدة
        </Button>
      </div>
      {summary.isPending ? (
        <Loading />
      ) : summary.isError ? (
        <Failed error={summary.error} />
      ) : summary.data.length === 0 ? null : (
        <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {summary.data.map((entry) => (
            <SummaryCard key={entry.currency} summary={entry} />
          ))}
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl text-ink">المطالبات</h2>
        <div className="flex rounded-md border border-ink/25 p-0.5">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setState(key)} aria-pressed={state === key} className={cn('rounded px-3 py-1.5 text-xs font-semibold transition-colors', state === key ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink')}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {invoices.isPending ? (
        <Loading />
      ) : invoices.isError ? (
        <Failed error={invoices.error} />
      ) : invoices.data.length === 0 ? (
        <Empty>لا مطالبات في هذا التصنيف.</Empty>
      ) : (
        <InvoicesTable rows={invoices.data} owner />
      )}
      <p className="mt-6 text-xs text-ink-faint">
        المطالبات المرتبطة بقضية تُصدر من تبويب «المالية» داخل ملف القضية. كشف حساب كل موكّل من صفحة <Link to={`${PATHS.office}/clients`} className="underline underline-offset-4">الموكّلين</Link>.
      </p>
      <NewInvoice open={billing} onClose={() => setBilling(false)} clients={clients.data ?? []} />
    </>
  )
}

/* ───────────────────────── statement of account ───────────────────────── */

/** Scrolls inside the sheet on a narrow screen instead of pushing the page sideways. */
const SheetTable = ({ head, children }: { head: string[]; children: React.ReactNode }) => (
  <div className="mt-2 overflow-x-auto">
    {/* Both sides padded: left-to-right number cells would put a one-sided padding on the wrong side. */}
    <table className="w-full text-[0.8rem] [&_td]:px-1.5 [&_td]:py-2">
      <thead>
        <tr className="border-b-2 border-ink">
          {head.map((cell) => (
            <th key={cell} className="px-1.5 pb-1.5 text-start text-xs font-semibold whitespace-nowrap text-ink-soft">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
)

/** The statement as a printable paper: office letterhead, client, totals per currency, details. */
const StatementSheet = ({ statement, backTo }: { statement: Statement; backTo?: string }) => {
  const settled = statement.currencies.every((entry) => entry.balance <= 0)
  return (
    <>
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        {backTo ? (
          <Link to={backTo} className="text-sm text-ink-soft underline-offset-4 hover:underline">
            → رجوع
          </Link>
        ) : (
          <span />
        )}
        <Button variant="ink" size="sm" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden="true" />
          اطبع أو احفظ PDF
        </Button>
      </div>
      <article className="print-sheet paper rounded-md p-6 sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-4">
          <div>
            <Logo />
            <p className="mt-3 text-xl font-semibold text-ink">{statement.office.name}</p>
            <p className="text-xs text-ink-soft">
              {[statement.office.city, statement.office.phone, statement.office.email].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="text-end">
            <h1 className="text-3xl text-ink">كشف حساب</h1>
            <p className="mt-1 text-xs text-ink-soft">بتاريخ {formatDate(statement.generated_at)}</p>
            <div className="mt-2">
              <Stamp slam="none" tone={settled ? 'green' : 'red'} className="text-sm">
                {settled ? 'لا رصيد مستحق' : 'رصيد مستحق'}
              </Stamp>
            </div>
          </div>
        </header>

        <section className="mt-4 text-sm">
          <p className="text-xs font-semibold text-ink-soft">الموكّل</p>
          <p className="text-lg font-semibold text-ink">{statement.client.full_name_or_org}</p>
          <p className="text-xs text-ink-soft">
            {[statement.client.national_id && `هوية/تسجيل: ${statement.client.national_id}`, statement.client.phone, statement.client.email].filter(Boolean).join(' · ')}
          </p>
        </section>

        {statement.currencies.length === 0 ? (
          <p className="mt-6 text-sm text-ink-soft">لا مطالبات مالية على هذا الحساب.</p>
        ) : (
          <>
            <section className="mt-6">
              <h2 className="text-lg text-ink">الملخّص</h2>
              <SheetTable head={['العملة', 'أتعاب محاماة', 'رسوم محكمة', 'مصاريف', 'المجموع', 'المدفوع', 'الرصيد']}>
                {statement.currencies.map((entry) => (
                  <tr key={entry.currency} className="border-b border-rule">
                    <td className="font-semibold text-ink">{CURRENCY[entry.currency]}</td>
                    {[entry.legal_fees, entry.court_fees, entry.expenses, entry.billed, entry.paid].map((value, index) => (
                      <td key={index} className="tabular-nums text-ink">
                        {formatMoney(value, entry.currency)}
                      </td>
                    ))}
                    <td className={cn('font-semibold tabular-nums whitespace-nowrap', entry.balance > 0 ? 'text-stamp' : 'text-stamp-green')}>{formatMoney(entry.balance, entry.currency)}</td>
                  </tr>
                ))}
              </SheetTable>
            </section>

            <section className="mt-6">
              <h2 className="text-lg text-ink">المطالبات</h2>
              <SheetTable head={['الرقم', 'التاريخ', 'البند', 'القضية', 'المبلغ', 'المدفوع', 'المتبقي', 'الحالة']}>
                {statement.invoices.map((invoice) => (
                  <tr key={invoice.invoice_id} className="border-b border-rule align-top">
                    <td className="whitespace-nowrap text-ink" dir="ltr">
                      {invoice.invoice_number}
                    </td>
                    <td className="whitespace-nowrap text-ink-soft">{formatDate(invoice.issued_at)}</td>
                    <td className="min-w-32 text-ink">
                      {INVOICE_CATEGORY[invoice.category]}
                      {invoice.description && <span className="block text-xs text-ink-soft">{invoice.description}</span>}
                    </td>
                    <td className="text-ink-soft" dir="ltr">
                      {invoice.case_number ?? '—'}
                    </td>
                    <td className="whitespace-nowrap tabular-nums text-ink">{formatMoney(invoice.amount, invoice.currency)}</td>
                    <td className="whitespace-nowrap tabular-nums text-ink-soft">{formatMoney(invoice.paid_amount, invoice.currency)}</td>
                    <td className="whitespace-nowrap tabular-nums font-semibold text-ink">{formatMoney(invoice.remaining, invoice.currency)}</td>
                    <td className="whitespace-nowrap text-xs">{INVOICE_STATE[invoice.state]?.text}</td>
                  </tr>
                ))}
              </SheetTable>
            </section>

            {statement.payments.length > 0 && (
              <section className="mt-6">
                <h2 className="text-lg text-ink">الدفعات المستلمة</h2>
                <SheetTable head={['التاريخ', 'عن الفاتورة', 'الطريقة', 'المرجع', 'المبلغ']}>
                  {statement.payments.map((payment) => (
                    <tr key={payment.payment_id} className="border-b border-rule">
                      <td className="whitespace-nowrap text-ink-soft">{formatDate(payment.paid_at)}</td>
                      <td className="text-ink" dir="ltr">
                        {payment.invoice_number}
                      </td>
                      <td className="text-ink">{PAYMENT_METHOD[payment.method] ?? payment.method}</td>
                      <td className="text-ink-soft" dir="ltr">
                        {payment.reference ?? '—'}
                      </td>
                      <td className="whitespace-nowrap tabular-nums text-stamp-green">{formatMoney(payment.amount, payment.currency)}</td>
                    </tr>
                  ))}
                </SheetTable>
              </section>
            )}
          </>
        )}
        <footer className="mt-8 border-t border-rule pt-3 text-xs text-ink-faint">
          كشف صادر من نظام قضيتي. المبالغ بكل عملة منفصلة ولا تُجمع العملات معاً. لأي استفسار تواصل مع المكتب.
        </footer>
      </article>
    </>
  )
}

/** A client's statement, opened by the office administrator from the clients page. */
export const ClientStatement = () => {
  const { clientId = '' } = useParams()
  const statement = useQuery({
    queryKey: ['statement', clientId],
    queryFn: async () => (await api.get<{ statement: Statement }>(`/finance/statements/${clientId}`)).data.statement,
  })
  if (statement.isPending) return <Loading />
  if (statement.isError) return <Failed error={statement.error} />
  return <StatementSheet statement={statement.data} backTo={`${PATHS.office}/clients`} />
}

/** The signed-in client's own statement, in the portal. */
export const PortalStatement = () => {
  const statement = useQuery({
    queryKey: ['statement', 'me'],
    queryFn: async () => (await api.get<{ statement: Statement }>('/finance/statement')).data.statement,
  })
  return (
    <>
      <div className="no-print">
        <SheetHeader title="كشف الحساب" note="ما طالبك به مكتبك من أتعاب ورسوم ومصاريف، وما دفعته." />
      </div>
      {statement.isPending ? <Loading /> : statement.isError ? <Failed error={statement.error} /> : <StatementSheet statement={statement.data} />}
    </>
  )
}
