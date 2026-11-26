import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, Check, Clock, Copy, CreditCard, FileCheck2, Landmark, Paperclip, Smartphone, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { api, messageOf } from '@/lib/api'
import { formatDate, formatMoney, PAYMENT_METHOD } from '@/lib/labels'
import type { ManualPaymentOption, PaymentRequest, SubscriptionPayment, SubscriptionPlan, SubscriptionPrice, SubscriptionSummary } from '@/lib/types'
import { FormActions, Modal, TextArea } from './forms'
import { Button, cn, Field } from './kit'
import { Empty, Failed, Loading } from './Shell'

export type CheckoutData = {
  subscription: SubscriptionSummary
  plan: SubscriptionPlan
  /** What each period costs this office, as the server will charge it. */
  prices: SubscriptionPrice[]
  online_payments: boolean
  payment_methods: ManualPaymentOption[]
  pending_request: SubscriptionPayment | null
}

/** "محامٍ واحد", "محاميان", "5 محامين", "12 محامياً". */
export const lawyersText = (count: number) =>
  count === 1 ? 'محامٍ واحد' : count === 2 ? 'محاميان' : count <= 10 ? `${count} محامين` : `${count} محامياً`

/**
 * The same rule as the server's: the monthly price for each lawyer and each month, less the
 * yearly discount on a whole year. Used where the server has not priced it (the platform's form).
 */
export const priceFor = (plan: SubscriptionPlan, lawyers: number, months: number): SubscriptionPrice => {
  const fullCents = Math.round(plan.monthly_price * 100) * lawyers * months
  const discountPercent = months === plan.yearly_months ? plan.yearly_discount_percent : 0
  const discountCents = Math.round((fullCents * discountPercent) / 100)
  return {
    lawyers,
    months,
    full_amount: fullCents / 100,
    discount_percent: discountPercent,
    discount_amount: discountCents / 100,
    amount: (fullCents - discountCents) / 100,
  }
}

type Choice = 'bank_transfer' | 'wallet' | 'cash' | 'card'

const METHOD_CARD: Record<Choice, { title: string; note: string; icon: LucideIcon }> = {
  bank_transfer: { title: 'تحويل بنكي', note: 'حوّل المبلغ إلى حساب المنصّة ثم أرسل رقم الحوالة.', icon: Landmark },
  wallet: { title: 'محفظة إلكترونية', note: 'ادفع من محفظتك ثم أرسل رقم العملية.', icon: Smartphone },
  cash: { title: 'نقداً', note: 'ادفع في مقر إدارة المنصّة واستلم إيصالاً.', icon: Banknote },
  card: { title: 'بطاقة ائتمان', note: 'ادفع فوراً عبر صفحة دفع آمنة، ويُفعَّل الاشتراك تلقائياً.', icon: CreditCard },
}

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024
const RECEIPT_ACCEPT = 'image/png,image/jpeg,application/pdf'

/** The new end date a payment of `months` would give, starting from the later of now and the current end. */
const endAfter = (endsAt: string | null, months: number) => {
  const start = new Date(Math.max(Date.now(), endsAt ? new Date(endsAt).getTime() : 0))
  start.setMonth(start.getMonth() + months)
  return start.toISOString()
}

/** "شهر واحد", "3 أشهر", "12 شهراً" (Arabic counts 11 and up with the singular). */
export const monthsText = (months: number) => (months === 1 ? 'شهر واحد' : months <= 10 ? `${months} أشهر` : `${months} شهراً`)

/** Opens a private receipt in a new tab (the request carries the session cookie). */
export const openReceipt = async (path: string) => {
  const preview = window.open('', '_blank')
  try {
    const response = await api.get<Blob>(path, { responseType: 'blob' })
    const url = URL.createObjectURL(response.data)
    if (preview) preview.location.href = url
    else window.open(url, '_blank')
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch {
    preview?.close()
    window.alert('تعذّر فتح الإيصال.')
  }
}

const uploadReceipt = (paymentId: string, file: File) =>
  api.put(`/offices/current/subscription/requests/${paymentId}/receipt`, file, { headers: { 'Content-Type': file.type } })

const receiptProblem = (file: File | null) => {
  if (!file) return null
  if (!RECEIPT_ACCEPT.split(',').includes(file.type)) return 'الإيصال يجب أن يكون صورة PNG أو JPG أو ملف PDF.'
  if (file.size > MAX_RECEIPT_BYTES) return 'حجم الإيصال أكبر من 5 ميغابايت.'
  return null
}

/* ───────────────────────── small pieces ───────────────────────── */

const CopyValue = ({ label, value }: { label: string; value: string }) => {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink/10 py-2 last:border-0">
      <span className="text-xs text-ink-soft">{label}</span>
      <span className="flex items-center gap-2">
        <bdi className="font-semibold text-ink tabular-nums">{value}</bdi>
        <button type="button" onClick={copy} aria-label={`نسخ ${label}`} className="rounded p-1 text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink">
          {copied ? <Check className="size-4 text-stamp-green" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
        </button>
      </span>
    </div>
  )
}

const Steps = ({ step }: { step: 1 | 2 | 3 }) => (
  <ol className="mb-6 flex items-center gap-2 text-xs font-semibold" aria-label="خطوات الدفع">
    {['المدة', 'طريقة الدفع', 'الدفع والتأكيد'].map((label, index) => {
      const number = (index + 1) as 1 | 2 | 3
      const done = number < step
      const current = number === step
      return (
        <li key={label} className="flex items-center gap-2" aria-current={current ? 'step' : undefined}>
          <span className={cn('grid size-6 place-items-center rounded-full text-[0.7rem]', done ? 'bg-stamp-green text-paper' : current ? 'bg-stamp text-paper' : 'bg-ink/8 text-ink-soft')}>
            {done ? <Check className="size-3.5" aria-hidden="true" /> : number}
          </span>
          <span className={current ? 'text-ink' : 'text-ink-soft'}>{label}</span>
          {number < 3 && <span aria-hidden="true" className="mx-1 h-px w-6 bg-ink/15 sm:w-10" />}
        </li>
      )
    })}
  </ol>
)

/** How the amount is made: lawyers × months × the price, the yearly discount, and the total. */
const Summary = ({ plan, price, endsAt }: { plan: SubscriptionPlan; price: SubscriptionPrice; endsAt: string | null }) => (
  <div className="rounded-xl bg-paper-shade px-4 py-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-ink-soft">
      <span>
        <span>{lawyersText(price.lawyers)}</span> × <span>{monthsText(price.months)}</span> × <bdi className="tabular-nums">{formatMoney(plan.monthly_price, plan.currency)}</bdi>
      </span>
      <bdi className="tabular-nums">{formatMoney(price.full_amount, plan.currency)}</bdi>
    </div>
    {price.discount_amount > 0 && (
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3 text-stamp-green">
        <span>{`خصم الاشتراك السنوي ${price.discount_percent}%`}</span>
        <bdi className="tabular-nums">−{formatMoney(price.discount_amount, plan.currency)}</bdi>
      </div>
    )}
    <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-2">
      <span className="text-ink-soft">
        فعّال حتى <strong className="text-ink">{formatDate(endAfter(endsAt, price.months))}</strong>
      </span>
      <bdi className="text-lg font-semibold text-ink tabular-nums">{formatMoney(price.amount, plan.currency)}</bdi>
    </div>
  </div>
)

/* ───────────────────────── the office owner's checkout ───────────────────────── */

/** Three ordered steps: how long, how to pay, then pay and confirm. */
export const CheckoutWizard = ({ data }: { data: CheckoutData }) => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { plan } = data
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [months, setMonths] = useState(3)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [receipt, setReceipt] = useState<File | null>(null)
  const methods = data.payment_methods ?? []
  const choices: Choice[] = [...methods.map((option) => option.method), ...(data.online_payments ? (['card'] as const) : [])]
  const option = methods.find((entry) => entry.method === choice)
  const walletName = methods.flatMap((entry) => (entry.method === 'wallet' ? [entry.details.wallet_name] : []))[0]
  const lawyers = plan.lawyers ?? 1
  // Priced by the server; computed by the same rule if an older server sent no prices.
  const prices = data.prices ?? [1, 3, 6, plan.yearly_months ?? 12].map((value) => priceFor(plan, lawyers, value))
  const price = prices.find((entry) => entry.months === months) ?? priceFor(plan, lawyers, months)
  const amount = price.amount
  const problem = receiptProblem(receipt)

  const submit = useMutation({
    mutationFn: async () => {
      const { request } = (
        await api.post<{ request: SubscriptionPayment }>('/offices/current/subscription/requests', {
          months,
          method: choice,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        })
      ).data
      if (receipt) await uploadReceipt(request.payment_id, receipt)
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['office-subscription'] }),
  })
  const checkout = useMutation({
    mutationFn: async () => (await api.post<{ checkout_url: string }>('/offices/current/subscription/checkout', { months })).data.checkout_url,
    onSuccess: (url) => (url.startsWith(window.location.origin) ? void navigate(url.slice(window.location.origin.length)) : window.location.assign(url)),
  })

  if (choices.length === 0) {
    return (
      <section className="rounded-2xl border border-ink/10 p-6">
        <h2 className="text-2xl text-ink">تجديد الاشتراك</h2>
        <p className="mt-2 text-sm text-ink-soft">لم تُضبط طرق الدفع بعد. تواصل مع إدارة المنصّة لتجديد اشتراك مكتبك.</p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-ink/10 p-6">
      <h2 className="mb-1 text-2xl text-ink">تجديد الاشتراك</h2>
      <div className="mb-5 space-y-1 text-sm text-ink-soft">
        <p>
          <bdi className="font-semibold text-ink tabular-nums">{formatMoney(plan.monthly_price, plan.currency)}</bdi> <span>لكل محامٍ شهرياً</span>
          {' · '}
          <span>في مكتبك</span> <strong className="text-ink">{lawyersText(lawyers)}</strong>
          {' · '}
          <span>المساعدون مجاناً</span>
        </p>
        <p>المدة الجديدة تُضاف بعد نهاية اشتراكك الحالي، فلا تخسر أي يوم.</p>
      </div>
      <Steps step={step} />

      {step === 1 && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {prices.map((option) => (
              <button
                key={option.months}
                type="button"
                onClick={() => setMonths(option.months)}
                aria-pressed={months === option.months}
                className={cn(
                  'relative rounded-xl border p-3 text-start transition-colors',
                  months === option.months ? 'border-stamp bg-stamp/6' : 'border-ink/15 hover:border-ink/35',
                  option.discount_percent > 0 && months !== option.months && 'border-stamp-green/50',
                )}
              >
                {option.discount_percent > 0 && (
                  <span className="absolute -top-2.5 end-2 rounded-full bg-stamp-green px-2 py-0.5 text-[0.7rem] font-bold text-paper">{`وفّر ${option.discount_percent}%`}</span>
                )}
                <span className="block font-semibold text-ink">{monthsText(option.months)}</span>
                <bdi className="block text-sm font-semibold text-ink tabular-nums">{formatMoney(option.amount, plan.currency)}</bdi>
                {option.discount_percent > 0 && <bdi className="block text-xs text-ink-faint line-through tabular-nums">{formatMoney(option.full_amount, plan.currency)}</bdi>}
              </button>
            ))}
          </div>
          <div className="mt-5">
            <Summary plan={plan} price={price} endsAt={data.subscription.ends_at} />
          </div>
          <div className="mt-5 flex justify-end">
            <Button variant="ink" onClick={() => setStep(2)}>
              التالي: طريقة الدفع
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {choices.map((key) => {
              const { title, note: hint, icon: Icon } = METHOD_CARD[key]
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setChoice(key)}
                  aria-pressed={choice === key}
                  className={cn('flex items-start gap-3 rounded-xl border p-4 text-start transition-colors', choice === key ? 'border-stamp bg-stamp/6' : 'border-ink/15 hover:border-ink/35')}
                >
                  <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg', choice === key ? 'bg-stamp text-paper' : 'bg-ink/6 text-ink')}>
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block font-semibold text-ink">
                      {title}
                      {key === 'wallet' && walletName && <span className="ms-1 text-xs font-normal text-ink-soft">({walletName})</span>}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-soft">{hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="mt-5 flex justify-between gap-3">
            <Button variant="line" onClick={() => setStep(1)}>
              رجوع
            </Button>
            <Button variant="ink" disabled={!choice} onClick={() => setStep(3)}>
              التالي: الدفع والتأكيد
            </Button>
          </div>
        </>
      )}

      {step === 3 && choice && (
        <div className="space-y-5">
          <Summary plan={plan} price={price} endsAt={data.subscription.ends_at} />

          {choice === 'card' ? (
            <div>
              {checkout.isError && <p role="alert" className="mb-3 text-sm text-stamp">{messageOf(checkout.error)}</p>}
              <Button variant="stamp" size="lg" disabled={checkout.isPending} onClick={() => checkout.mutate()}>
                <CreditCard className="size-5" aria-hidden="true" />
                {checkout.isPending ? 'تُفتح صفحة الدفع…' : `ادفع ${formatMoney(amount, plan.currency)} بالبطاقة`}
              </Button>
              <p className="mt-2 text-xs text-ink-faint">تنتقل إلى صفحة دفع آمنة لدى مزوّد الدفع. لا تمرّ بيانات بطاقتك عبر قضيتي.</p>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-ink/12 p-4">
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
                  <span className="grid size-6 place-items-center rounded-full bg-stamp text-[0.7rem] text-paper">١</span>
                  {choice === 'cash' ? 'ادفع في مقر الإدارة' : choice === 'wallet' ? 'ادفع إلى محفظة المنصّة' : 'حوّل المبلغ إلى حساب المنصّة'}
                </p>
                {option?.method === 'bank_transfer' && (
                  <>
                    {option.details.bank_name && <CopyValue label="البنك" value={option.details.bank_name} />}
                    {option.details.account_name && <CopyValue label="اسم الحساب" value={option.details.account_name} />}
                    <CopyValue label="رقم الحساب / IBAN" value={option.details.account} />
                  </>
                )}
                {option?.method === 'wallet' && (
                  <>
                    <CopyValue label="المحفظة" value={option.details.wallet_name} />
                    {option.details.account_name && <CopyValue label="باسم" value={option.details.account_name} />}
                    <CopyValue label="رقم المحفظة" value={option.details.account} />
                  </>
                )}
                {option?.method === 'cash' && (
                  <>
                    <CopyValue label="العنوان" value={option.details.address} />
                    {option.details.hours && <CopyValue label="أوقات الدوام" value={option.details.hours} />}
                  </>
                )}
                <CopyValue label="المبلغ" value={formatMoney(amount, plan.currency)} />
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  submit.mutate()
                }}
                className="rounded-xl border border-ink/12 p-4"
              >
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                  <span className="grid size-6 place-items-center rounded-full bg-stamp text-[0.7rem] text-paper">٢</span>
                  أرسل بيانات الدفع للمراجعة
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {choice !== 'cash' && (
                    <Field
                      label={choice === 'wallet' ? 'رقم العملية' : 'رقم الحوالة أو المرجع'}
                      name="reference"
                      dir="ltr"
                      required
                      maxLength={120}
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                    />
                  )}
                  <div className={choice === 'cash' ? 'sm:col-span-2' : ''}>
                    <span className="block text-xs font-semibold text-ink-soft">صورة الإيصال (اختياري)</span>
                    <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-ink/30 px-3 py-2 text-sm text-ink-soft hover:border-ink/60">
                      <Paperclip className="size-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{receipt ? receipt.name : 'اختر صورة أو PDF (حتى 5 ميغابايت)'}</span>
                      <input type="file" accept={RECEIPT_ACCEPT} className="sr-only" onChange={(event) => setReceipt(event.target.files?.[0] ?? null)} />
                    </label>
                  </div>
                  <TextArea label="ملاحظة للإدارة (اختياري)" name="note" rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} className="sm:col-span-2" />
                </div>
                {problem && <p role="alert" className="mt-3 text-sm text-stamp">{problem}</p>}
                {submit.isError && <p role="alert" className="mt-3 text-sm text-stamp">{messageOf(submit.error)}</p>}
                <p className="mt-3 text-xs text-ink-faint">تراجع إدارة المنصّة الدفعة، فيُجدَّد اشتراكك فور اعتمادها ويصلك إشعار.</p>
                <div className="mt-4 flex justify-between gap-3">
                  <Button variant="line" onClick={() => setStep(2)}>
                    رجوع
                  </Button>
                  <Button type="submit" variant="stamp" disabled={submit.isPending || Boolean(problem) || (choice !== 'cash' && !reference.trim())}>
                    {submit.isPending ? 'يُرسَل…' : 'أرسل للمراجعة'}
                  </Button>
                </div>
              </form>
            </>
          )}
          {choice === 'card' && (
            <div className="flex justify-start">
              <Button variant="line" onClick={() => setStep(2)}>
                رجوع
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** Shown instead of the checkout while a request waits for the platform owner. */
export const PendingRequest = ({ request }: { request: SubscriptionPayment }) => {
  const queryClient = useQueryClient()
  const [receipt, setReceipt] = useState<File | null>(null)
  const problem = receiptProblem(receipt)
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['office-subscription'] })
  const upload = useMutation({ mutationFn: () => uploadReceipt(request.payment_id, receipt!), onSuccess: () => (setReceipt(null), refresh()) })
  const cancel = useMutation({ mutationFn: () => api.post(`/offices/current/subscription/requests/${request.payment_id}/cancel`), onSuccess: refresh })
  return (
    <section className="rounded-2xl border-2 border-stamp-blue/30 bg-stamp-blue/5 p-6">
      <p className="flex items-center gap-2 text-sm font-semibold text-stamp-blue">
        <Clock className="size-4" aria-hidden="true" />
        طلب الدفع قيد المراجعة
      </p>
      <h2 className="mt-1 text-2xl text-ink">
        <bdi>{formatMoney(request.amount, request.currency.trim())}</bdi> · <span>{monthsText(request.months)}</span>
        {request.lawyer_count ? (
          <>
            {' · '}
            <span>{lawyersText(request.lawyer_count)}</span>
          </>
        ) : null}
      </h2>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-ink-soft">الطريقة:</dt>
          <dd className="text-ink">{PAYMENT_METHOD[request.method]}</dd>
        </div>
        {request.reference && (
          <div className="flex gap-2">
            <dt className="text-ink-soft">المرجع:</dt>
            <dd>
              <bdi className="text-ink">{request.reference}</bdi>
            </dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="text-ink-soft">أُرسل:</dt>
          <dd className="text-ink">{formatDate(request.created_at)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-ink-soft">الإيصال:</dt>
          <dd className="text-ink">
            {request.has_receipt ? (
              <button type="button" onClick={() => void openReceipt(`/offices/current/subscription/requests/${request.payment_id}/receipt`)} className="inline-flex items-center gap-1 text-stamp-blue underline-offset-4 hover:underline">
                <FileCheck2 className="size-4" aria-hidden="true" />
                مرفق، اعرضه
              </button>
            ) : (
              'لم يُرفق'
            )}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-sm text-ink-soft">تراجع إدارة المنصّة الدفعة، فيُجدَّد الاشتراك فور اعتمادها ويصلك إشعار.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-ink/30 bg-white/60 px-3 py-2 text-sm text-ink-soft hover:border-ink/60">
          <Paperclip className="size-4" aria-hidden="true" />
          <span className="max-w-48 truncate">{receipt ? receipt.name : request.has_receipt ? 'استبدل الإيصال' : 'أرفق الإيصال'}</span>
          <input type="file" accept={RECEIPT_ACCEPT} className="sr-only" onChange={(event) => setReceipt(event.target.files?.[0] ?? null)} />
        </label>
        {receipt && (
          <Button size="sm" variant="ink" disabled={upload.isPending || Boolean(problem)} onClick={() => upload.mutate()}>
            {upload.isPending ? 'يُرفع…' : 'ارفع الإيصال'}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => window.confirm('إلغاء طلب الدفع؟') && cancel.mutate()}>
          ألغِ الطلب
        </Button>
      </div>
      {(problem || upload.isError || cancel.isError) && (
        <p role="alert" className="mt-2 text-sm text-stamp">
          {problem ?? messageOf(upload.error ?? cancel.error)}
        </p>
      )}
    </section>
  )
}

/* ───────────────────────── the platform owner's review ───────────────────────── */

const Detail = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex gap-1.5">
    <dt className="text-ink-faint">{label}:</dt>
    <dd className="text-ink">{children}</dd>
  </div>
)

/** Payment requests waiting for the platform owner, oldest first. */
export const PaymentRequestsPanel = () => {
  const queryClient = useQueryClient()
  const [rejecting, setRejecting] = useState<PaymentRequest | null>(null)
  const [reason, setReason] = useState('')
  const requests = useQuery({
    queryKey: ['payment-requests'],
    queryFn: async () => (await api.get<{ requests: PaymentRequest[] }>('/platform/payment-requests')).data.requests,
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['payment-requests'] })
    void queryClient.invalidateQueries({ queryKey: ['platform-subscriptions'] })
  }
  const approve = useMutation({ mutationFn: (id: string) => api.post(`/platform/payment-requests/${id}/approve`), onSuccess: refresh })
  const reject = useMutation({
    mutationFn: () => api.post(`/platform/payment-requests/${rejecting!.payment_id}/reject`, { note: reason.trim() }),
    onSuccess: () => {
      setRejecting(null)
      setReason('')
      refresh()
    },
  })

  if (requests.isPending) return <Loading />
  if (requests.isError) return <Failed error={requests.error} />
  return (
    <section className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 text-2xl text-ink">
        طلبات دفع بانتظار المراجعة
        {requests.data.length > 0 && <span className="rounded-full bg-stamp px-2 py-0.5 text-xs font-bold text-paper">{requests.data.length}</span>}
      </h2>
      {requests.data.length === 0 ? (
        <Empty>لا طلبات دفع بانتظار المراجعة.</Empty>
      ) : (
        <ul className="space-y-3">
          {requests.data.map((request) => (
            <li key={request.payment_id} className="rounded-xl border border-ink/12 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">
                    {request.office_name}
                    {request.office_city && <span className="ms-1 text-xs font-normal text-ink-faint">· {request.office_city}</span>}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {request.requested_by_name} · <bdi>{request.requested_by_email}</bdi>
                  </p>
                </div>
                <p className="text-xl font-semibold text-ink tabular-nums">{formatMoney(request.amount, request.currency.trim())}</p>
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <Detail label="الطريقة">{PAYMENT_METHOD[request.method]}</Detail>
                <Detail label="المدة">{monthsText(request.months)}</Detail>
                {request.lawyer_count ? <Detail label="المحامون">{lawyersText(request.lawyer_count)}</Detail> : null}
                <Detail label="المرجع">{request.reference ? <bdi>{request.reference}</bdi> : '—'}</Detail>
                <Detail label="أُرسل">{formatDate(request.created_at)}</Detail>
              </dl>
              {request.payer_note && <p className="mt-2 rounded-md bg-paper-shade px-3 py-2 text-sm text-ink">«{request.payer_note}»</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {request.has_receipt ? (
                  <Button size="sm" variant="line" onClick={() => void openReceipt(`/platform/payment-requests/${request.payment_id}/receipt`)}>
                    <FileCheck2 className="size-4" aria-hidden="true" />
                    اعرض الإيصال
                  </Button>
                ) : (
                  <span className="text-xs text-ink-faint">لم يُرفق إيصال</span>
                )}
                <span className="flex-1" />
                <Button size="sm" variant="line" onClick={() => setRejecting(request)}>
                  ارفض
                </Button>
                <Button
                  size="sm"
                  variant="ink"
                  disabled={approve.isPending}
                  onClick={() =>
                    window.confirm(`اعتماد دفعة ${request.office_name} وتجديد اشتراكه ${monthsText(request.months)}؟`) && approve.mutate(request.payment_id)
                  }
                >
                  <Check className="size-4" aria-hidden="true" />
                  اعتمد وجدّد الاشتراك
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {approve.isError && <p role="alert" className="mt-2 text-sm text-stamp">{messageOf(approve.error)}</p>}
      <Modal open={rejecting !== null} onClose={() => setRejecting(null)} title={rejecting ? `رفض طلب ${rejecting.office_name}` : ''}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            reject.mutate()
          }}
          className="space-y-4"
        >
          <TextArea label="سبب الرفض (يصل إلى صاحب المكتب)" name="reason" rows={3} maxLength={500} required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="مثلاً: لم نجد الحوالة في كشف الحساب" />
          <FormActions error={reject.isError ? messageOf(reject.error) : null}>
            <Button variant="line" onClick={() => setRejecting(null)}>
              تراجع
            </Button>
            <Button type="submit" variant="stamp" disabled={!reason.trim() || reject.isPending}>
              {reject.isPending ? 'يُرفض…' : 'ارفض الطلب'}
            </Button>
          </FormActions>
        </form>
      </Modal>
    </section>
  )
}
