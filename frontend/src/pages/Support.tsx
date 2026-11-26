import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Mail, MessageSquareText } from 'lucide-react'
import { useState } from 'react'
import { api, messageOf } from '@/lib/api'
import { formatDate, formatTime } from '@/lib/labels'
import { TextArea } from '@/ui/forms'
import { Button, cn } from '@/ui/kit'
import { Empty, Failed, Loading, Pill, SheetHeader } from '@/ui/Shell'

type Status = 'new' | 'in_progress' | 'closed'

type SupportMessage = {
  message_id: string
  name: string
  email: string
  phone: string | null
  topic: string
  body: string
  transcript: { role: 'user' | 'assistant'; text: string }[] | null
  page_path: string | null
  status: Status
  reply: string | null
  replied_at: string | null
  created_at: string
  office_name: string | null
  account_name: string | null
  replied_by_name: string | null
}

const TOPIC: Record<string, string> = {
  registration: 'تسجيل المكتب',
  subscription: 'الاشتراك والدفع',
  account: 'الحساب والدخول',
  technical: 'مشكلة تقنية',
  other: 'أخرى',
}
const STATUS: Record<Status, { text: string; tone: 'red' | 'blue' | 'ink' }> = {
  new: { text: 'جديدة', tone: 'red' },
  in_progress: { text: 'قيد المتابعة', tone: 'blue' },
  closed: { text: 'مغلقة', tone: 'ink' },
}
const FILTERS: [Status | '', string][] = [['new', 'جديدة'], ['in_progress', 'قيد المتابعة'], ['closed', 'مغلقة'], ['', 'الكل']]

const MessageCard = ({ message, onNotice }: { message: SupportMessage; onNotice: (text: string) => void }) => {
  const queryClient = useQueryClient()
  const [reply, setReply] = useState('')
  const [showChat, setShowChat] = useState(false)
  const update = useMutation({
    mutationFn: async (body: { reply?: string; status?: Status }) =>
      (await api.patch<{ emailed: boolean }>(`/platform/support/messages/${message.message_id}`, body)).data,
    onSuccess: (result, body) => {
      // Told at page level: a replied message moves to another filter and this card disappears.
      if (body.reply) {
        setReply('')
        onNotice(
          result.emailed
            ? `أُرسل الرد إلى بريد ${message.name}، ونُقلت الرسالة إلى «قيد المتابعة».`
            : `حُفظ الرد على رسالة ${message.name} ونُقلت إلى «قيد المتابعة»، لكن البريد غير مفعّل على الخادم فلم يُرسل. راسله على ${message.email} مباشرة.`,
        )
      } else if (body.status) {
        onNotice(`نُقلت رسالة ${message.name} إلى «${STATUS[body.status].text}».`)
      }
      void queryClient.invalidateQueries({ queryKey: ['support-messages'] })
    },
  })
  const status = STATUS[message.status]
  return (
    <li className={cn('rounded-xl border p-4', message.status === 'new' ? 'border-stamp/30 bg-stamp/[0.03]' : 'border-ink/12')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">
            {message.name}
            <span className="ms-2 text-xs font-normal text-ink-soft">{TOPIC[message.topic] ?? message.topic}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-soft">
            <a href={`mailto:${message.email}`} className="inline-flex items-center gap-1 text-stamp-blue hover:underline">
              <Mail className="size-3.5" aria-hidden="true" />
              <bdi>{message.email}</bdi>
            </a>
            {message.phone && <bdi>{message.phone}</bdi>}
            {message.office_name ? <span>مكتب: {message.office_name}</span> : message.account_name ? <span>حساب: {message.account_name}</span> : <span>زائر</span>}
            {message.page_path && <bdi className="text-ink-faint">{message.page_path}</bdi>}
          </p>
        </div>
        <div className="text-end">
          <Pill tone={status.tone}>{status.text}</Pill>
          <p className="mt-1 text-xs text-ink-faint">
            {formatDate(message.created_at)} · <bdi>{formatTime(message.created_at)}</bdi>
          </p>
        </div>
      </div>

      <p className="mt-3 rounded-lg bg-paper-shade px-3 py-2.5 text-sm leading-relaxed whitespace-pre-line text-ink">{message.body}</p>

      {message.transcript && message.transcript.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowChat((current) => !current)} className="inline-flex items-center gap-1 text-xs font-semibold text-ink-soft hover:text-ink">
            <MessageSquareText className="size-3.5" aria-hidden="true" />
            محادثته مع المساعد ({message.transcript.length})
            <ChevronDown className={cn('size-3.5 transition-transform', showChat && 'rotate-180')} aria-hidden="true" />
          </button>
          {showChat && (
            <ul className="mt-2 space-y-1.5 border-s-2 border-ink/10 ps-3 text-xs">
              {message.transcript.map((turn, index) => (
                <li key={index} className={turn.role === 'user' ? 'text-ink' : 'text-ink-soft'}>
                  <span className="font-semibold">{turn.role === 'user' ? 'المرسل: ' : 'المساعد: '}</span>
                  {turn.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {message.reply && (
        <div className="mt-3 border-s-4 border-stamp-green bg-stamp-green/8 px-3 py-2 text-sm text-ink">
          <p className="text-xs font-semibold text-stamp-green">
            ردّ {message.replied_by_name ?? 'الإدارة'} · {formatDate(message.replied_at)}
          </p>
          <p className="mt-1 whitespace-pre-line">{message.reply}</p>
        </div>
      )}

      {message.status !== 'closed' && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            update.mutate({ reply: reply.trim() })
          }}
          className="mt-3"
        >
          <TextArea label={message.reply ? 'رد إضافي' : 'الرد'} name={`reply-${message.message_id}`} rows={2} maxLength={3000} value={reply} onChange={(event) => setReply(event.target.value)} />
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ status: 'closed' })}>
              أغلق الرسالة
            </Button>
            <Button type="submit" size="sm" variant="ink" disabled={!reply.trim() || update.isPending}>
              {update.isPending ? 'يُرسل…' : 'أرسل الرد'}
            </Button>
          </div>
        </form>
      )}
      {message.status === 'closed' && (
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ status: 'in_progress' })}>
            أعد فتحها
          </Button>
        </div>
      )}
      {update.isError && <p role="alert" className="mt-2 text-sm text-stamp">{messageOf(update.error)}</p>}
    </li>
  )
}

/** The platform management's inbox of messages sent from the support chat. */
export const SupportInbox = () => {
  const [status, setStatus] = useState<Status | ''>('new')
  const [notice, setNotice] = useState<string | null>(null)
  const inbox = useQuery({
    queryKey: ['support-messages', status],
    queryFn: async () =>
      (await api.get<{ messages: SupportMessage[]; counts: Partial<Record<Status, number>> }>('/platform/support/messages', { params: status ? { status } : {} })).data,
  })
  const counts = inbox.data?.counts ?? {}
  return (
    <>
      <SheetHeader title="رسائل الدعم" note="ما أرسله الزوار والمستخدمون من نافذة المساعدة، مع محادثتهم مع المساعد." />
      <div className="mb-5 flex flex-wrap gap-1.5" role="group" aria-label="تصفية حسب الحالة">
        {FILTERS.map(([key, label]) => (
          <button key={key || 'all'} type="button" onClick={() => setStatus(key)} aria-pressed={status === key} className={cn('rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors', status === key ? 'bg-ink text-paper' : 'bg-ink/6 text-ink-soft hover:text-ink')}>
            {label}
            {key && counts[key] ? <span className="ms-1.5 tabular-nums">({counts[key]})</span> : null}
          </button>
        ))}
      </div>
      {notice && (
        <div role="status" className="mb-4 flex items-start justify-between gap-3 rounded-lg bg-stamp-green/10 px-4 py-3 text-sm text-ink">
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-xs font-semibold underline-offset-4 hover:underline">
            إخفاء
          </button>
        </div>
      )}
      {inbox.isPending ? (
        <Loading />
      ) : inbox.isError ? (
        <Failed error={inbox.error} />
      ) : inbox.data.messages.length === 0 ? (
        <Empty>لا رسائل في هذا التصنيف.</Empty>
      ) : (
        <ul className="space-y-3">
          {inbox.data.messages.map((message) => (
            <MessageCard key={message.message_id} message={message} onNotice={setNotice} />
          ))}
        </ul>
      )}
    </>
  )
}
