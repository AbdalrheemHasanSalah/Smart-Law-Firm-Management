import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock, CreditCard, History, Lock, Plus, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { PATHS, personaOf, useAuth } from '@/auth/auth'
import { api, messageOf } from '@/lib/api'
import { oneOf, useParam } from '@/lib/useParam'
import { daysText, formatDate, formatMoney, PAYMENT_METHOD, PAYMENT_STATUS, SUBSCRIPTION_STATE } from '@/lib/labels'
import type {
  OfficeSubscriptionRow,
  PaymentMethod,
  SubscriptionPayment,
  SubscriptionPlan,
  SubscriptionState,
  SubscriptionSummary,
} from '@/lib/types'
import { FormActions, Modal, SelectField } from '@/ui/forms'
import { Button, cn, Field } from '@/ui/kit'
import { CheckoutWizard, lawyersText, monthsText, PaymentRequestsPanel, PendingRequest, priceFor, type CheckoutData } from '@/ui/PaymentCheckout'
import { Empty, Failed, Loading, Pill, SheetHeader } from '@/ui/Shell'

/* ───────────────────────── shared ───────────────────────── */

const STATE_STYLE: Record<SubscriptionState, { badge: string; panel: string; icon: LucideIcon }> = {
  active: { badge: 'bg-stamp-green/15 text-stamp-green', panel: 'bg-stamp-green', icon: CheckCircle2 },
  grace: { badge: 'bg-[#a35f0c]/12 text-[#a35f0c]', panel: 'bg-[#a35f0c]', icon: Clock },
  expired: { badge: 'bg-stamp/10 text-stamp', panel: 'bg-stamp', icon: Lock },
  none: { badge: 'bg-ink/8 text-ink-soft', panel: 'bg-manila-deep', icon: AlertTriangle },
}

export const StateBadge = ({ state }: { state: SubscriptionState }) => (
  <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap', STATE_STYLE[state].badge)}>
    <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
    {SUBSCRIPTION_STATE[state]}
  </span>
)

/** One line saying where the subscription stands. */
const stateLine = (subscription: SubscriptionSummary) => {
  const { state, ends_at: endsAt, days_left: days } = subscription
  if (state === 'none' || !endsAt) return 'لا يوجد اشتراك مسجّل'
  if (state === 'active') return `حتى ${formatDate(endsAt)} · بقي ${daysText(days ?? 0)}`
  if (state === 'grace') return `انتهى ${formatDate(endsAt)} · يتوقف بعد ${daysText(days ?? 0)}`
  return `متوقف منذ ${formatDate(subscription.grace_ends_at)}`
}

/** The new end date a payment of `months` would give, starting from the later of now and the current end. */
const endAfter = (endsAt: string | null, months: number) => {
  const start = new Date(Math.max(Date.now(), endsAt ? new Date(endsAt).getTime() : 0))
  start.setMonth(start.getMonth() + months)
  return start.toISOString()
}

const PaymentsTable = ({ payments, showRecorder = false }: { payments: SubscriptionPayment[]; showRecorder?: boolean }) =>
  payments.length === 0 ? (
    <Empty>لا دفعات مسجّلة بعد.</Empty>
  ) : (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="border-b border-ink/15 text-xs text-ink-soft">
            {['التاريخ', 'المبلغ', 'المدة', 'الطريقة', 'الفترة', 'الحالة', ...(showRecorder ? ['سجّلها'] : [])].map((cell) => (
              <th key={cell} className="pe-4 pb-2.5 text-start font-semibold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.payment_id} className="border-b border-ink/8 last:border-0">
              <td className="py-3 pe-4 whitespace-nowrap text-ink-soft">{formatDate(payment.paid_at ?? payment.created_at)}</td>
              <td className="py-3 pe-4 font-semibold whitespace-nowrap text-ink">{formatMoney(payment.amount, payment.currency.trim())}</td>
              <td className="py-3 pe-4 whitespace-nowrap">
                {monthsText(payment.months)}
                {payment.lawyer_count ? <span className="block text-xs text-ink-faint">{lawyersText(payment.lawyer_count)}</span> : null}
              </td>
              <td className="py-3 pe-4">
                {PAYMENT_METHOD[payment.method]}
                {payment.reference && payment.reference !== 'demo' && (
                  <bdi className="ms-1 text-xs text-ink-faint">({payment.reference})</bdi>
                )}
              </td>
              <td className="py-3 pe-4 text-xs whitespace-nowrap text-ink-soft">
                {payment.period_start && payment.period_end ? `${formatDate(payment.period_start)} ← ${formatDate(payment.period_end)}` : '—'}
              </td>
              <td className="py-3 pe-4">
                <Pill tone={PAYMENT_STATUS[payment.status]?.tone}>{PAYMENT_STATUS[payment.status]?.text}</Pill>
                {payment.status === 'rejected' && payment.review_note && <p className="mt-1 max-w-56 text-xs text-stamp">السبب: {payment.review_note}</p>}
              </td>
              {showRecorder && <td className="py-3 text-ink-soft">{payment.recorded_by_name ?? 'إلكتروني'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

/* ───────────────────────── platform owner ───────────────────────── */

const RecordPayment = ({ office, plan, onClose }: { office: OfficeSubscriptionRow | null; plan: SubscriptionPlan; onClose: () => void }) => {
  const queryClient = useQueryClient()
  const [months, setMonths] = useState(1)
  // Suggested from the office's lawyers and the period; the platform owner enters what was received.
  const suggested = (value: number) => String(priceFor(plan, office?.lawyers ?? 1, value).amount)
  const [amount, setAmount] = useState(String(plan.monthly_price))
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer')
  const [reference, setReference] = useState('')
  useEffect(() => {
    if (!office) return
    setMonths(1)
    setAmount(String(priceFor(plan, office.lawyers ?? 1, 1).amount))
    setMethod('bank_transfer')
    setReference('')
  }, [office, plan])
  const record = useMutation({
    mutationFn: () =>
      api.post(`/platform/offices/${office!.office_id}/payments`, {
        amount: Number(amount),
        months,
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform-subscriptions'] })
      void queryClient.invalidateQueries({ queryKey: ['office-payments'] })
      onClose()
    },
  })
  const pickMonths = (value: number) => {
    setMonths(value)
    setAmount(suggested(value))
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    record.mutate()
  }
  return (
    <Modal open={office !== null} onClose={onClose} title={office ? `تسجيل دفعة — ${office.name}` : ''}>
      {office && (
        <form onSubmit={submit} className="space-y-5">
          <div>
            <p className="text-xs font-semibold text-ink-soft">المدة</p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {[1, 3, 6, 12].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => pickMonths(value)}
                  aria-pressed={months === value}
                  className={cn('rounded-lg border py-2 text-sm font-semibold transition-colors', months === value ? 'border-stamp bg-stamp text-paper' : 'border-ink/20 text-ink hover:border-ink/40')}
                >
                  {monthsText(value)}
                </button>
              ))}
            </div>
          </div>
          <p className="rounded-lg bg-paper-shade px-4 py-3 text-sm text-ink-soft">
            <span>السعر حسب الخطة:</span> <span>{lawyersText(office.lawyers ?? 1)}</span> × <span>{monthsText(months)}</span>
            {' = '}
            <bdi className="font-semibold text-ink tabular-nums">{formatMoney(priceFor(plan, office.lawyers ?? 1, months).amount, plan.currency)}</bdi>
            {months === plan.yearly_months && plan.yearly_discount_percent > 0 && <span className="ms-1 text-stamp-green">{`(بعد خصم ${plan.yearly_discount_percent}%)`}</span>}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`المبلغ المستلم (${plan.currency})`} name="amount" type="number" min="0.01" step="0.01" dir="ltr" required value={amount} onChange={(event) => setAmount(event.target.value)} />
            <SelectField
              label="طريقة الدفع"
              name="method"
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
              options={[['bank_transfer', 'تحويل بنكي'], ['cash', 'نقداً'], ['cheque', 'شيك']]}
            />
            <Field label="رقم الإيصال أو الحوالة (اختياري)" name="reference" dir="ltr" value={reference} onChange={(event) => setReference(event.target.value)} className="sm:col-span-2" />
          </div>
          <p className="rounded-lg bg-stamp-green/10 px-4 py-3 text-sm text-ink">
            سيصبح اشتراك المكتب فعّالاً حتى <strong>{formatDate(endAfter(office.subscription.ends_at, months))}</strong>.
          </p>
          <FormActions error={record.isError ? messageOf(record.error) : null}>
            <Button variant="line" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" variant="ink" disabled={!(Number(amount) > 0) || record.isPending}>
              {record.isPending ? 'تُسجَّل…' : 'سجّل الدفعة'}
            </Button>
          </FormActions>
        </form>
      )}
    </Modal>
  )
}

const OfficeHistory = ({ office, onClose }: { office: OfficeSubscriptionRow | null; onClose: () => void }) => {
  const payments = useQuery({
    queryKey: ['office-payments', office?.office_id],
    enabled: office !== null,
    queryFn: async () => (await api.get<{ payments: SubscriptionPayment[] }>(`/platform/offices/${office!.office_id}/payments`)).data.payments,
  })
  return (
    <Modal open={office !== null} onClose={onClose} title={office ? `سجلّ الدفعات — ${office.name}` : ''} wide>
      {payments.isPending ? <Loading /> : payments.isError ? <Failed error={payments.error} /> : <PaymentsTable payments={payments.data} showRecorder />}
    </Modal>
  )
}

const FILTERS: [SubscriptionState | 'all', string][] = [['all', 'الكل'], ['active', 'فعّال'], ['grace', 'في المهلة'], ['expired', 'متوقف'], ['none', 'بدون اشتراك']]

const Tile = ({ label, value, tone, active, onClick, delay }: { label: string; value: ReactNode; tone: string; active: boolean; onClick?: () => void; delay: number }) => (
  <motion.button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.35, delay }}
    className={cn('rounded-xl border p-4 text-start transition-[border-color,transform] hover:-translate-y-0.5', active ? 'border-ink' : 'border-ink/10')}
  >
    <span className={cn('mb-2 block h-1 w-8 rounded-full', tone)} />
    <span className="block font-doc text-3xl leading-none font-bold text-ink tabular-nums">{value}</span>
    <span className="mt-1 block text-xs text-ink-soft">{label}</span>
  </motion.button>
)

export const PlatformSubscriptions = () => {
  const [stateParam, setStateParam] = useParam('state')
  const filter = oneOf<SubscriptionState | 'all'>(stateParam, ['all', 'active', 'grace', 'expired', 'none'], 'all')
  const setFilter = (key: SubscriptionState | 'all') => setStateParam(key === 'all' ? null : key)
  const [paying, setPaying] = useState<OfficeSubscriptionRow | null>(null)
  const [history, setHistory] = useState<OfficeSubscriptionRow | null>(null)
  const data = useQuery({
    queryKey: ['platform-subscriptions'],
    queryFn: async () => (await api.get<{ offices: OfficeSubscriptionRow[]; plan: SubscriptionPlan }>('/platform/subscriptions')).data,
  })
  const offices = data.data?.offices ?? []
  const plan = data.data?.plan
  const count = (state: SubscriptionState) => offices.filter((office) => office.subscription.state === state).length
  const total = offices.reduce((sum, office) => sum + office.paid_total, 0)
  const shown = filter === 'all' ? offices : offices.filter((office) => office.subscription.state === filter)

  return (
    <>
      <SheetHeader
        title="اشتراكات المكاتب"
        note={plan ? `${formatMoney(plan.monthly_price, plan.currency)} لكل محامٍ شهرياً · خصم ${plan.yearly_discount_percent}% على الاشتراك السنوي · مهلة السماح ${daysText(plan.grace_days)} بعد انتهاء الاشتراك` : undefined}
      />
      <PaymentRequestsPanel />
      {data.isPending ? (
        <Loading />
      ) : data.isError ? (
        <Failed error={data.error} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label="فعّال" value={count('active')} tone="bg-stamp-green" active={filter === 'active'} onClick={() => setFilter(filter === 'active' ? 'all' : 'active')} delay={0} />
            <Tile label="في مهلة السماح" value={count('grace')} tone="bg-[#a35f0c]" active={filter === 'grace'} onClick={() => setFilter(filter === 'grace' ? 'all' : 'grace')} delay={0.05} />
            <Tile label="متوقف لعدم الدفع" value={count('expired')} tone="bg-stamp" active={filter === 'expired'} onClick={() => setFilter(filter === 'expired' ? 'all' : 'expired')} delay={0.1} />
            <Tile label="بدون اشتراك" value={count('none')} tone="bg-manila-deep" active={filter === 'none'} onClick={() => setFilter(filter === 'none' ? 'all' : 'none')} delay={0.15} />
            <Tile label="مجموع المدفوع" value={plan ? formatMoney(total, plan.currency) : total} tone="bg-desk" active={false} delay={0.2} />
          </div>

          <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="تصفية حسب حالة الاشتراك">
            {FILTERS.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key} className={cn('rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors', filter === key ? 'bg-ink text-paper' : 'bg-ink/6 text-ink-soft hover:text-ink')}>
                {label}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <Empty>لا مكاتب في هذا التصنيف.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-b border-ink/15 text-xs text-ink-soft">
                    {['المكتب', 'صاحب المكتب', 'الاشتراك', 'آخر دفعة', ''].map((cell) => (
                      <th key={cell} className="pe-5 pb-3 text-start font-semibold">
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((office, index) => (
                    <motion.tr key={office.office_id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }} className="border-b border-ink/8 last:border-0 hover:bg-paper-shade">
                      <td className="py-3.5 pe-5">
                        <p className="font-semibold text-ink">{office.name}</p>
                        <p className="text-xs text-ink-faint">
                          {office.city ?? '—'}
                          {' · '}
                          <span>{lawyersText(office.lawyers ?? 1)}</span>
                          {office.status === 'suspended' && ' · موقوف يدوياً'}
                        </p>
                      </td>
                      <td className="py-3.5 pe-5">
                        <p className="text-ink">{office.owner_name}</p>
                        <bdi className="text-xs text-ink-faint">{office.owner_email}</bdi>
                      </td>
                      <td className="py-3.5 pe-5">
                        <StateBadge state={office.subscription.state} />
                        <p className="mt-1 text-xs text-ink-soft">{stateLine(office.subscription)}</p>
                      </td>
                      <td className="py-3.5 pe-5">
                        {office.last_amount !== null ? (
                          <>
                            <p className="font-semibold text-ink">{formatMoney(office.last_amount, (office.last_currency ?? 'ILS').trim())}</p>
                            <p className="text-xs text-ink-faint">
                              {formatDate(office.last_paid_at)} · {PAYMENT_METHOD[office.last_method ?? ''] ?? ''}
                            </p>
                          </>
                        ) : (
                          <span className="text-ink-faint">لم يدفع بعد</span>
                        )}
                      </td>
                      <td className="py-3.5 text-end whitespace-nowrap">
                        <button type="button" onClick={() => setHistory(office)} className="me-3 inline-flex items-center gap-1 text-xs font-semibold text-stamp-blue hover:underline">
                          <History className="size-3.5" aria-hidden="true" />
                          السجل
                        </button>
                        <Button size="sm" variant="ink" onClick={() => setPaying(office)}>
                          <Plus className="size-4" aria-hidden="true" />
                          تسجيل دفعة
                        </Button>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {plan && <RecordPayment office={paying} plan={plan} onClose={() => setPaying(null)} />}
          <OfficeHistory office={history} onClose={() => setHistory(null)} />
        </>
      )}
    </>
  )
}

/* ───────────────────────── office owner ───────────────────────── */

type OfficeSubscriptionData = CheckoutData & { payments: SubscriptionPayment[] }

const StatusPanel = ({ subscription }: { subscription: SubscriptionSummary }) => {
  const { icon: Icon, panel } = STATE_STYLE[subscription.state]
  const { state, ends_at: endsAt, days_left: days } = subscription
  const headline =
    state === 'active'
      ? 'اشتراك مكتبك فعّال'
      : state === 'grace'
        ? 'انتهى اشتراك مكتبك'
        : state === 'expired'
          ? 'توقف عمل المكتب لانتهاء الاشتراك'
          : 'لا يوجد اشتراك مسجّل لمكتبك'
  const detail =
    state === 'active'
      ? `ينتهي في ${formatDate(endsAt)}، بعد ${daysText(days ?? 0)}.`
      : state === 'grace'
        ? `انتهى في ${formatDate(endsAt)}. يعمل المكتب خلال مهلة السماح، ويتوقف بعد ${daysText(days ?? 0)} إن لم يُجدَّد.`
        : state === 'expired'
          ? 'لا يستطيع أعضاء المكتب ولا موكّلوه الدخول إلى بياناتهم حتى يُجدَّد الاشتراك. البيانات محفوظة ولم يُحذف شيء.'
          : 'تواصل مع إدارة المنصّة لتفعيل اشتراك مكتبك.'
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className={cn('relative overflow-hidden rounded-2xl p-6 text-paper sm:p-8', panel)}>
      <Icon aria-hidden="true" className="absolute -bottom-6 -left-6 size-40 opacity-15" />
      <div className="relative">
        <p className="flex items-center gap-2 text-sm text-paper/85">
          <Icon className="size-4" aria-hidden="true" />
          {SUBSCRIPTION_STATE[state]}
        </p>
        <h2 className="mt-2 text-3xl text-paper sm:text-4xl">{headline}</h2>
        <p className="mt-2 max-w-xl leading-relaxed text-paper/90">{detail}</p>
      </div>
    </motion.section>
  )
}

export const OfficeSubscription = () => {
  const { refresh } = useAuth()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const result = params.get('payment')
  const data = useQuery({
    queryKey: ['office-subscription'],
    queryFn: async () => (await api.get<OfficeSubscriptionData>('/offices/current/subscription')).data,
  })
  // Coming back from the payment page: the webhook may land a moment later, so check twice.
  useEffect(() => {
    if (result !== 'success') return
    const update = () => {
      void queryClient.invalidateQueries({ queryKey: ['office-subscription'] })
      void refresh()
    }
    update()
    const timer = window.setTimeout(update, 4000)
    return () => window.clearTimeout(timer)
  }, [result, queryClient, refresh])

  return (
    <>
      <SheetHeader title="الاشتراك" note="اشتراك مكتبك في قضيتي ودفعاته." />
      {result && (
        <div role="status" className={cn('mb-5 flex items-start justify-between gap-4 rounded-xl px-4 py-3 text-sm', result === 'success' ? 'bg-stamp-green/12 text-ink' : 'bg-ink/6 text-ink-soft')}>
          <p>{result === 'success' ? 'تمّت عملية الدفع. يُحدَّث اشتراكك خلال لحظات بعد تأكيد مزوّد الدفع، ويصلك إشعار بذلك.' : 'أُلغيت عملية الدفع ولم يُخصم أي مبلغ.'}</p>
          <button type="button" onClick={() => setParams({})} className="shrink-0 text-xs font-semibold underline-offset-4 hover:underline">
            إخفاء
          </button>
        </div>
      )}
      {data.isPending ? (
        <Loading />
      ) : data.isError ? (
        <Failed error={data.error} />
      ) : (
        <div className="space-y-6">
          <StatusPanel subscription={data.data.subscription} />
          {data.data.pending_request ? <PendingRequest request={data.data.pending_request} /> : <CheckoutWizard data={data.data} />}
          <section>
            <h2 className="mb-3 text-2xl text-ink">سجلّ الدفعات</h2>
            <PaymentsTable payments={data.data.payments} />
          </section>
        </div>
      )}
    </>
  )
}

/* ───────────────────────── warnings in the workspace ───────────────────────── */

/** A strip above every page while the subscription is about to end or has ended. */
export const SubscriptionBanner = () => {
  const { session } = useAuth()
  const subscription = session?.subscription
  const owner = personaOf(session) === 'owner'
  if (!subscription) return null
  const { state, days_left: days } = subscription
  const endingSoon = state === 'active' && owner && days !== null && days <= 7
  if (state !== 'grace' && !endingSoon) return null
  const text =
    state === 'grace'
      ? `انتهى اشتراك المكتب. يتوقف العمل بعد ${daysText(days ?? 0)} إن لم يُجدَّد${owner ? '.' : '، تواصل مع صاحب المكتب.'}`
      : `ينتهي اشتراك المكتب بعد ${daysText(days ?? 0)}.`
  return (
    <div role="status" className={cn('flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-8', state === 'grace' ? 'bg-stamp text-paper' : 'bg-[#a35f0c]/12 text-[#7a4709]')}>
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
        {text}
      </p>
      {owner && (
        <Link to={`${PATHS.office}/subscription`} className={cn('rounded-full px-3.5 py-1 text-xs font-bold', state === 'grace' ? 'bg-paper text-stamp' : 'bg-[#a35f0c] text-paper')}>
          جدّد الاشتراك
        </Link>
      )}
    </div>
  )
}

/** Shown instead of a page while the office is locked for non-payment. */
export const SubscriptionLocked = () => {
  const { session } = useAuth()
  const owner = personaOf(session) === 'owner'
  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-stamp/10 text-stamp">
        <Lock className="size-7" aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-3xl text-ink">توقف عمل المكتب مؤقتاً</h1>
      <p className="mt-3 leading-relaxed text-ink-soft">
        انتهى اشتراك {session?.active_office?.office_name ?? 'المكتب'} ومهلة السماح بعده. البيانات كلها محفوظة، ويعود كل شيء كما كان فور تجديد الاشتراك.
      </p>
      {owner ? (
        <Link to={`${PATHS.office}/subscription`} className="mt-6 inline-flex items-center gap-2 rounded-md bg-stamp px-6 py-3 font-semibold text-paper hover:bg-[#c00a17]">
          <CreditCard className="size-5" aria-hidden="true" />
          جدّد الاشتراك
        </Link>
      ) : (
        <p className="mt-6 rounded-lg bg-paper-shade px-4 py-3 text-sm text-ink">تواصل مع صاحب المكتب لتجديد الاشتراك.</p>
      )}
    </div>
  )
}
