import { useQuery } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, History, MessageSquare, Mic, Paperclip, Plus, Scale } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { PATHS, useAuth } from '@/auth/auth'
import { api, messageOf } from '@/lib/api'
import { CASE_STATUS, CURRENCY, formatDate, formatMoney, formatTime } from '@/lib/labels'
import { FILE_STATUS, NOTICE_KIND } from '@/lib/portalLink'
import type { CaseRelationships } from '@/lib/types'
import {
  INSTALLMENT_STATE,
  STAGE,
  STAGES,
  previewSchedule,
  useAgreements,
  useBriefcase,
  useCaseStage,
  useChangeStage,
  useCreateAgreement,
  useSetMizan,
  useSettleAgreement,
  type Currency,
  type FeeAgreement,
  type Stage,
} from '@/lib/workflow'
import { FormActions, Modal, SelectField, TextArea } from '@/ui/forms'
import { Button, cn, Field } from '@/ui/kit'
import { Empty, Failed, Loading, Pill, SheetHeader } from '@/ui/Shell'

const LINK = 'text-xs font-semibold underline-offset-4 hover:underline disabled:opacity-50'
const useRole = () => useAuth().session?.active_office?.role ?? null

/* ───────────────────────── stage bar ───────────────────────── */

/** The case's stage as a row of steps, with the move, the history and the Mizan number. */
export const StageBar = ({ caseId }: { caseId: string }) => {
  const stage = useCaseStage(caseId)
  const change = useChangeStage(caseId)
  const mizan = useSetMizan(caseId)
  const role = useRole()
  const canMove = role === 'admin' || role === 'lawyer'
  const [moving, setMoving] = useState<Stage | null>(null)
  const [note, setNote] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [editingMizan, setEditingMizan] = useState(false)
  const [mizanDraft, setMizanDraft] = useState('')
  const [copied, setCopied] = useState(false)
  if (!stage.data) return null
  const current = STAGES.indexOf(stage.data.stage)

  return (
    <section aria-label="مراحل القضية" className="mb-6 rounded-lg border border-rule bg-paper p-4">
      <ol className="flex flex-wrap items-center gap-1">
        {STAGES.map((key, index) => (
          <li key={key} className="flex items-center gap-1">
            <button
              type="button"
              disabled={!canMove || index === current}
              onClick={() => {
                setNote('')
                setMoving(key)
              }}
              aria-current={index === current ? 'step' : undefined}
              title={canMove && index !== current ? `انقل القضية إلى مرحلة ${STAGE[key]}` : undefined}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                index === current ? 'bg-stamp text-paper' : index < current ? 'bg-stamp-green/15 text-stamp-green' : 'border border-ink/15 text-ink-soft',
                canMove && index !== current && 'hover:border-ink hover:text-ink',
              )}
            >
              {index < current && <Check className="size-3" aria-hidden="true" />}
              {STAGE[key]}
            </button>
            {index < STAGES.length - 1 && <span aria-hidden="true" className="h-px w-3 bg-ink/20" />}
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-ink-soft">
          <Scale className="size-4" aria-hidden="true" />
          <span>رقم الدعوى في ميزان:</span>
          {editingMizan ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                mizan.mutate(mizanDraft.trim() || null, { onSuccess: () => setEditingMizan(false) })
              }}
              className="flex items-center gap-2"
            >
              <input
                aria-label="رقم الدعوى في ميزان"
                value={mizanDraft}
                maxLength={60}
                dir="ltr"
                onChange={(event) => setMizanDraft(event.target.value)}
                className="h-8 w-40 rounded border border-ink/25 bg-white/60 px-2 text-sm text-ink"
              />
              <Button type="submit" variant="ink" size="sm" disabled={mizan.isPending}>احفظ</Button>
              <button type="button" onClick={() => setEditingMizan(false)} className={cn(LINK, 'text-ink-soft')}>إلغاء</button>
            </form>
          ) : stage.data.mizan_number ? (
            <>
              <bdi dir="ltr" className="font-mono font-semibold text-ink">{stage.data.mizan_number}</bdi>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(stage.data.mizan_number ?? '').then(() => {
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1500)
                  })
                }}
                className={cn(LINK, 'inline-flex items-center gap-1 text-stamp-blue')}
              >
                <Copy className="size-3.5" aria-hidden="true" />
                {copied ? 'نُسخ' : 'انسخ'}
              </button>
              {stage.data.mizan_url && (
                <a href={stage.data.mizan_url} target="_blank" rel="noreferrer" className={cn(LINK, 'inline-flex items-center gap-1 text-stamp-blue')}>
                  افتح ميزان <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              )}
            </>
          ) : (
            <span className="text-ink-faint">غير مسجّل</span>
          )}
          {canMove && !editingMizan && (
            <button
              type="button"
              onClick={() => {
                setMizanDraft(stage.data.mizan_number ?? '')
                setEditingMizan(true)
              }}
              className={cn(LINK, 'text-stamp-blue')}
            >
              {stage.data.mizan_number ? 'تعديل' : 'أضف الرقم'}
            </button>
          )}
        </div>
        {(stage.data.history?.length ?? 0) > 0 && (
          <button type="button" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory} className={cn(LINK, 'inline-flex items-center gap-1 text-ink-soft')}>
            <History className="size-3.5" aria-hidden="true" />
            سجل المراحل
          </button>
        )}
      </div>
      {mizan.isError && <p role="alert" className="mt-2 text-sm text-stamp">{messageOf(mizan.error)}</p>}
      {showHistory && (
        <ul className="mt-3 space-y-1 border-t border-rule pt-3 text-sm">
          {stage.data.history?.map((entry) => (
            <li key={entry.history_id} className="text-ink">
              {entry.from_stage ? `${STAGE[entry.from_stage]} ← ` : ''}
              <span className="font-semibold">{STAGE[entry.to_stage]}</span>
              <span className="text-xs text-ink-soft"> · {formatDate(entry.changed_at)} {formatTime(entry.changed_at)} · {entry.changed_by.full_name}</span>
              {entry.note && <span className="block text-xs text-ink-soft">{entry.note}</span>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={moving !== null} onClose={() => setMoving(null)} title={moving ? `نقل القضية إلى مرحلة ${STAGE[moving]}` : ''}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (moving) change.mutate({ stage: moving, ...(note.trim() ? { note: note.trim() } : {}) }, { onSuccess: () => setMoving(null) })
          }}
          className="space-y-4"
        >
          <TextArea label="ملاحظة (اختياري)" name="stage_note" rows={3} maxLength={1000} placeholder="ما الذي حدث؟ مثلاً: صدر الحكم وقررنا الاستئناف" value={note} onChange={(event) => setNote(event.target.value)} />
          <FormActions error={change.isError ? messageOf(change.error) : null}>
            <Button variant="line" onClick={() => setMoving(null)}>إلغاء</Button>
            <Button type="submit" variant="ink" disabled={change.isPending}>{change.isPending ? 'يُنقل…' : 'انقل'}</Button>
          </FormActions>
        </form>
      </Modal>
    </section>
  )
}

/** The stage alone, as the client sees it on their case card. */
export const ClientStage = ({ caseId }: { caseId: string }) => {
  const stage = useCaseStage(caseId)
  if (!stage.data) return null
  const current = STAGES.indexOf(stage.data.stage)
  return (
    <div className="mt-3">
      <p className="text-sm text-ink">
        مرحلة القضية: <span className="font-semibold">{STAGE[stage.data.stage]}</span>
      </p>
      <div className="mt-1.5 flex gap-1" aria-hidden="true">
        {STAGES.map((key, index) => (
          <span key={key} className={cn('h-1.5 flex-1 rounded-full', index <= current ? 'bg-stamp-green' : 'bg-ink/10')} />
        ))}
      </div>
    </div>
  )
}

/* ───────────────────────── fee agreements ───────────────────────── */

const AgreementCard = ({ agreement, onSettle }: { agreement: FeeAgreement; onSettle?: () => void }) => (
  <article className="rounded-lg border border-rule bg-paper p-4">
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="font-semibold text-ink">
          {formatMoney(agreement.total_amount, agreement.currency)}
          {agreement.description && <span className="font-normal text-ink-soft"> — {agreement.description}</span>}
        </p>
        <p className="text-xs text-ink-soft">
          {agreement.client_name} · {agreement.case_number} · {formatDate(agreement.created_at)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {agreement.overdue_count > 0 && <Pill tone="red">{agreement.overdue_count === 1 ? 'قسط متأخر' : `${agreement.overdue_count} أقساط متأخرة`}</Pill>}
        {agreement.status === 'settled' ? <Pill tone="green">مُسوّاة</Pill> : <Pill tone="blue">سارية</Pill>}
      </div>
    </header>
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink/20 text-xs text-ink-soft">
            {['القسط', 'الاستحقاق', 'المبلغ', 'المدفوع', 'الفاتورة', 'الحالة'].map((head) => <th key={head} scope="col" className="py-1.5 pe-3 text-start font-semibold">{head}</th>)}
          </tr>
        </thead>
        <tbody>
          {agreement.installments.map((entry) => (
            <tr key={entry.installment_id} className="border-b border-rule">
              <td className="py-1.5 pe-3 tabular-nums">{entry.sequence}</td>
              <td className="py-1.5 pe-3 whitespace-nowrap">{formatDate(`${entry.due_on}T12:00:00`)}</td>
              <td className="py-1.5 pe-3 tabular-nums whitespace-nowrap">{formatMoney(entry.amount, agreement.currency)}</td>
              <td className="py-1.5 pe-3 tabular-nums whitespace-nowrap text-ink-soft">{formatMoney(entry.paid, agreement.currency)}</td>
              <td className="py-1.5 pe-3 text-ink-soft" dir="ltr">{entry.invoice_number}</td>
              <td className="py-1.5 pe-3"><Pill tone={INSTALLMENT_STATE[entry.state].tone}>{INSTALLMENT_STATE[entry.state].text}</Pill></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-ink-soft">
        المحصّل {formatMoney(agreement.paid, agreement.currency)} · المتبقي <span className="font-semibold text-ink">{formatMoney(agreement.remaining, agreement.currency)}</span>
      </span>
      {agreement.status === 'settled' ? (
        <span className="text-xs text-ink-soft">
          سُوّيت في {formatDate(agreement.settled_at)} بمبلغ {formatMoney(agreement.settlement_amount ?? 0, agreement.currency)}
          {agreement.settlement_note ? ` — ${agreement.settlement_note}` : ''}
        </span>
      ) : (
        onSettle && agreement.remaining > 0 && <button type="button" onClick={onSettle} className={cn(LINK, 'text-stamp')}>تسوية المتبقي</button>
      )}
    </footer>
  </article>
)

const NewAgreement = ({ caseId, open, onClose }: { caseId: string; open: boolean; onClose: () => void }) => {
  const relationships = useQuery({
    queryKey: ['relationships', caseId],
    enabled: open,
    queryFn: async () => (await api.get<{ relationships: CaseRelationships }>(`/cases/${caseId}/relationships`)).data.relationships,
  })
  const create = useCreateAgreement()
  const parties = relationships.data?.clients ?? []
  const [clientId, setClientId] = useState('')
  const [currency, setCurrency] = useState<Currency>('ILS')
  const [total, setTotal] = useState('')
  const [description, setDescription] = useState('')
  const [count, setCount] = useState('3')
  const [firstDue, setFirstDue] = useState('')
  const [every, setEvery] = useState('1')
  useEffect(() => {
    if (!open) return
    create.reset()
    setClientId(parties.length === 1 ? parties[0]!.client_id : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, parties.length])
  const schedule = previewSchedule(Number(total), Number(count), firstDue, Number(every))
  const ready = clientId && Number(total) > 0 && Number(count) >= 1 && Number(count) <= 60 && firstDue && schedule.length > 0

  const submit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate(
      {
        case_id: caseId,
        client_id: clientId,
        currency,
        total_amount: Number(total),
        ...(description.trim() ? { description: description.trim() } : {}),
        plan: { count: Number(count), first_due_on: firstDue, every_months: Number(every) },
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="اتفاقية أتعاب جديدة" wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label="الموكّل" name="fee_client" required value={clientId} onChange={(event) => setClientId(event.target.value)} options={[['', 'اختر الموكّل'], ...parties.map((party) => [party.client_id, party.full_name_or_org] as const)]} />
          <Field label="الأتعاب المتفق عليها" name="fee_total" type="number" min="0.01" step="0.01" required dir="ltr" value={total} onChange={(event) => setTotal(event.target.value)} />
          <SelectField label="العملة" name="fee_currency" value={currency} onChange={(event) => setCurrency(event.target.value as Currency)} options={(['ILS', 'JOD', 'USD'] as const).map((code) => [code, CURRENCY[code] ?? code] as const)} />
        </div>
        <Field label="الوصف (اختياري)" name="fee_description" maxLength={500} placeholder="أتعاب الدعوى حتى صدور الحكم" value={description} onChange={(event) => setDescription(event.target.value)} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="عدد الأقساط" name="fee_count" type="number" min="1" max="60" required dir="ltr" value={count} onChange={(event) => setCount(event.target.value)} />
          <Field label="استحقاق القسط الأول" name="fee_first" type="date" required dir="ltr" value={firstDue} onChange={(event) => setFirstDue(event.target.value)} />
          <SelectField label="كل" name="fee_every" value={every} onChange={(event) => setEvery(event.target.value)} options={[['1', 'شهر'], ['2', 'شهرين'], ['3', '3 أشهر'], ['6', '6 أشهر'], ['12', 'سنة']]} />
        </div>
        {schedule.length > 0 && (
          <div className="rounded-md border border-ink/15 bg-marker/15 p-3 text-sm">
            <p className="mb-1 text-xs font-semibold text-ink-soft">جدول الأقساط (تصدر فاتورة لكل قسط بتاريخ استحقاقه):</p>
            <ol className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
              {schedule.map((entry, index) => (
                <li key={entry.due_on} className="tabular-nums text-ink">{index + 1}. {formatDate(`${entry.due_on}T12:00:00`)} — {formatMoney(entry.amount, currency)}</li>
              ))}
            </ol>
          </div>
        )}
        <FormActions error={create.isError ? messageOf(create.error) : null}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="ink" disabled={!ready || create.isPending}>{create.isPending ? 'يُنشأ…' : 'أنشئ الاتفاقية والفواتير'}</Button>
        </FormActions>
      </form>
    </Modal>
  )
}

const SettleDialog = ({ agreement, onClose }: { agreement: FeeAgreement | null; onClose: () => void }) => {
  const settle = useSettleAgreement()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  useEffect(() => {
    if (!agreement) return
    settle.reset()
    setAmount('')
    setNote('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreement?.agreement_id])
  const value = amount === '' ? NaN : Number(amount)
  return (
    <Modal open={agreement !== null} onClose={onClose} title="تسوية المتبقي من الاتفاقية">
      {agreement && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            settle.mutate({ agreementId: agreement.agreement_id, amount: value, note: note.trim() }, { onSuccess: onClose })
          }}
          className="space-y-4"
        >
          <p className="text-sm text-ink">
            المتبقي الآن {formatMoney(agreement.remaining, agreement.currency)}. تُلغى الأقساط غير المدفوعة، وإن اتُّفق على مبلغ بدلاً منها تصدر به فاتورة واحدة مستحقة اليوم. الأقساط المدفوعة جزئياً تبقى كما هي.
          </p>
          <Field label="مبلغ التسوية (0 للإعفاء)" name="settle_amount" type="number" min="0" step="0.01" max={agreement.remaining} required dir="ltr" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <TextArea label="سبب التسوية" name="settle_note" rows={3} required maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          <FormActions error={settle.isError ? messageOf(settle.error) : null}>
            <Button variant="line" onClick={onClose}>إلغاء</Button>
            <Button type="submit" variant="stamp" disabled={Number.isNaN(value) || value < 0 || value > agreement.remaining || !note.trim() || settle.isPending}>
              {settle.isPending ? 'تُسوّى…' : 'سوِّ'}
            </Button>
          </FormActions>
        </form>
      )}
    </Modal>
  )
}

/** The case's fee agreements, for the office admin, in the case's finance tab. */
export const CaseFeeAgreements = ({ caseId }: { caseId: string }) => {
  const admin = useRole() === 'admin'
  const agreements = useAgreements({ caseId }, admin)
  const [creating, setCreating] = useState(false)
  const [settling, setSettling] = useState<FeeAgreement | null>(null)
  if (!admin) return null
  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xl text-ink">اتفاقيات الأتعاب والأقساط</h3>
        <Button variant="ink" size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden="true" />
          اتفاقية جديدة
        </Button>
      </div>
      {agreements.isPending ? (
        <Loading />
      ) : agreements.isError ? (
        <Failed error={agreements.error} />
      ) : agreements.data.length === 0 ? (
        <Empty>لا اتفاقيات أتعاب في هذه القضية. الاتفاقية تقسّم الأتعاب على أقساط تصدر بها فواتير بتواريخ استحقاقها.</Empty>
      ) : (
        <div className="space-y-3">
          {agreements.data.map((agreement) => <AgreementCard key={agreement.agreement_id} agreement={agreement} onSettle={() => setSettling(agreement)} />)}
        </div>
      )}
      <NewAgreement caseId={caseId} open={creating} onClose={() => setCreating(false)} />
      <SettleDialog agreement={settling} onClose={() => setSettling(null)} />
    </section>
  )
}

/* ───────────────────────── the client's briefcase ───────────────────────── */

const Panel = ({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) => (
  <section className="rounded-lg border border-rule bg-paper p-4">
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-lg text-ink">{title}</h2>
      {action}
    </div>
    {children}
  </section>
)

export const ClientBriefcase = () => {
  const { clientId = '' } = useParams()
  const briefcase = useBriefcase(clientId)
  if (briefcase.isPending) return <Loading />
  if (briefcase.isError) return <Failed error={new Error(messageOf(briefcase.error))} />
  const data = briefcase.data
  const client = data.client
  return (
    <>
      <Link to={`${PATHS.office}/clients`} className="mb-4 inline-block text-sm text-stamp-blue underline-offset-4 hover:underline">→ الموكّلون</Link>
      <SheetHeader
        title={client.full_name_or_org}
        note={[client.phone, client.email, data.has_portal ? 'له حساب في البوابة' : 'بلا حساب في البوابة'].filter(Boolean).join(' · ')}
        action={data.money && <Link to={`${PATHS.office}/clients/${clientId}/statement`} className="text-sm font-semibold text-stamp-blue underline-offset-4 hover:underline">كشف الحساب</Link>}
      />
      {data.money && data.money.currencies.length > 0 && (
        <dl className="mb-6 grid gap-3 sm:grid-cols-3">
          {data.money.currencies.map((entry) => (
            <div key={entry.currency} className="flex flex-col-reverse rounded-lg border border-rule bg-paper px-4 py-3">
              <dt className="text-xs text-ink-soft">{CURRENCY[entry.currency] ?? entry.currency}: المطالب {formatMoney(entry.billed, entry.currency)} · المدفوع {formatMoney(entry.paid, entry.currency)}</dt>
              <dd className={cn('font-doc text-2xl font-bold tabular-nums', entry.balance > 0 ? 'text-stamp' : 'text-stamp-green')}>{formatMoney(entry.balance, entry.currency)}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="القضايا">
          {data.cases.length === 0 ? <p className="text-sm text-ink-faint">لا قضايا ظاهرة لك لهذا الموكّل.</p> : (
            <ul className="divide-y divide-rule">
              {data.cases.map((row) => (
                <li key={row.case_id} className="py-2">
                  <Link to={`${PATHS.office}/cases/${row.case_id}`} className="font-semibold text-stamp-blue underline-offset-4 hover:underline">
                    <bdi dir="ltr">{row.case_number}</bdi> — {row.title}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                    <Pill tone="blue">{STAGE[row.stage]}</Pill>
                    <span>{CASE_STATUS[row.status]?.text ?? row.status}</span>
                    {row.next_hearing_at && <span>الجلسة القادمة {formatDate(row.next_hearing_at)} {formatTime(row.next_hearing_at)}</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          title="مراسلاتك معه"
          action={data.client_user_id && <Link to={`${PATHS.office}/messages?with=${data.client_user_id}`} className={cn(LINK, 'text-stamp-blue')}>افتح المحادثة</Link>}
        >
          {!data.has_portal ? <p className="text-sm text-ink-faint">لا حساب له في البوابة، فلا مراسلات.</p> : data.messages.length === 0 ? <p className="text-sm text-ink-faint">لا رسائل بينكما بعد.</p> : (
            <ul className="space-y-1.5 text-sm">
              {data.messages.map((message) => (
                <li key={message.message_id} className="flex items-start gap-2">
                  <MessageSquare className={cn('mt-0.5 size-4 shrink-0', message.mine ? 'text-ink-faint' : 'text-stamp-blue')} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-ink" dir="auto">{message.body || (message.has_voice ? 'رسالة صوتية' : message.has_attachment ? 'مرفق' : '')}</span>
                    <span className="text-xs text-ink-faint">{message.mine ? 'أنت' : client.full_name_or_org} · {formatDate(message.sent_at)} {formatTime(message.sent_at)}</span>
                  </span>
                  {message.has_voice && <Mic className="size-3.5 text-ink-faint" aria-hidden="true" />}
                  {message.has_attachment && <Paperclip className="size-3.5 text-ink-faint" aria-hidden="true" />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="ملفات أرسلها">
          {data.files.length === 0 ? <p className="text-sm text-ink-faint">لم يرسل ملفات بعد.</p> : (
            <ul className="divide-y divide-rule text-sm">
              {data.files.map((file) => (
                <li key={file.file_id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span dir="auto">{file.file_name}<span className="text-xs text-ink-faint"> · {file.case_number ?? 'محادثة'} · {formatDate(file.created_at)}</span></span>
                  <Pill tone={FILE_STATUS[file.status].tone}>{FILE_STATUS[file.status].text}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="مستنداته في القضايا">
          {data.documents.length === 0 ? <p className="text-sm text-ink-faint">لا مستندات مرتبطة به.</p> : (
            <ul className="divide-y divide-rule text-sm">
              {data.documents.map((document) => (
                <li key={document.document_id} className="py-1.5">
                  <span dir="auto">{document.file_name}</span>
                  <span className="text-xs text-ink-faint"> · {document.document_type} · {document.case_number} · {formatDate(document.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="الإشعارات الرسمية">
          {data.notices.length === 0 ? <p className="text-sm text-ink-faint">لم يُرسل له إشعار رسمي.</p> : (
            <ul className="divide-y divide-rule text-sm">
              {data.notices.map((notice) => (
                <li key={notice.notice_id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>{notice.title}<span className="text-xs text-ink-faint"> · {NOTICE_KIND[notice.kind]} · {formatDate(notice.sent_at)}</span></span>
                  {notice.acknowledged_at ? <Pill tone="green">اطّلع</Pill> : <Pill tone="ink">لم يطّلع</Pill>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {data.money && data.money.agreements.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-xl text-ink">اتفاقيات الأتعاب والأقساط</h2>
          <div className="space-y-3">
            {data.money.agreements.map((agreement) => <AgreementCard key={agreement.agreement_id} agreement={agreement} />)}
          </div>
        </section>
      )}
    </>
  )
}
