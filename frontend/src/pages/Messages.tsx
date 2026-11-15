import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Send } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/auth'
import { api, messageOf } from '@/lib/api'
import { ROLE } from '@/lib/labels'
import type { Contact, Message } from '@/lib/types'
import { timeAgo } from '@/ui/Inbox'
import { cn } from '@/ui/kit'
import { Empty, Failed, Loading, SheetHeader } from '@/ui/Shell'

const initialsOf = (name: string) =>
  name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join(' ')

const timeOf = new Intl.DateTimeFormat('ar-PS-u-nu-latn', { hour: 'numeric', minute: '2-digit' })
const dayOf = new Intl.DateTimeFormat('ar-PS-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' })

/** The conversation with one contact. It refreshes every few seconds while open. */
const Thread = ({ contact, onBack }: { contact: Contact; onBack: () => void }) => {
  const { session } = useAuth()
  const me = session?.user.user_id
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const thread = useQuery({
    queryKey: ['messages', 'thread', contact.user_id],
    refetchInterval: 5000,
    queryFn: async () => (await api.get<{ messages: Message[] }>(`/messages/${contact.user_id}`)).data.messages,
  })
  const send = useMutation({
    mutationFn: (body: string) => api.post(`/messages/${contact.user_id}`, { body }),
    onSuccess: () => {
      setText('')
      void queryClient.invalidateQueries({ queryKey: ['messages'] })
    },
  })
  const count = thread.data?.length ?? 0
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
    // Opening a thread marks it read on the server: refresh the counts shown elsewhere.
    void queryClient.invalidateQueries({ queryKey: ['messages', 'contacts'] })
    void queryClient.invalidateQueries({ queryKey: ['messages', 'unread'] })
  }, [count, queryClient])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (text.trim() && !send.isPending) send.mutate(text.trim())
  }

  let lastDay = ''
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-ink/10 px-4 py-3">
        <button type="button" onClick={onBack} aria-label="العودة إلى جهات الاتصال" className="grid size-9 place-items-center rounded-full text-ink-soft hover:bg-ink/6 md:hidden">
          <ArrowRight className="size-5" aria-hidden="true" />
        </button>
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-desk text-sm font-bold text-paper">{initialsOf(contact.full_name)}</span>
        <div className="leading-tight">
          <p className="font-semibold text-ink">{contact.full_name}</p>
          <p className="text-xs text-ink-faint">{ROLE[contact.role]}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-paper-shade/60 px-4 py-5">
        {thread.isPending ? (
          <Loading />
        ) : thread.isError ? (
          <Failed error={thread.error} />
        ) : count === 0 ? (
          <p className="py-10 text-center text-sm text-ink-faint">لا رسائل بعد. اكتب أول رسالة.</p>
        ) : (
          thread.data.map((message) => {
            const mine = message.sender_user_id === me
            const day = dayOf.format(new Date(message.sent_at))
            const showDay = day !== lastDay
            lastDay = day
            return (
              <div key={message.message_id}>
                {showDay && <p className="my-3 text-center text-xs text-ink-faint">{day}</p>}
                <motion.div initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.2 }} className={cn('flex', mine ? 'justify-start' : 'justify-end')}>
                  <div className={cn('max-w-[80%] rounded-2xl px-4 py-2.5 shadow-sm', mine ? 'rounded-ss-md bg-desk text-paper' : 'rounded-se-md bg-white text-ink')}>
                    <p className="leading-relaxed whitespace-pre-wrap">{message.body}</p>
                    <p className={cn('mt-1 text-[0.68rem]', mine ? 'text-paper/60' : 'text-ink-faint')}>
                      {timeOf.format(new Date(message.sent_at))}
                      {mine && (message.read_at ? ' · قُرئت' : ' · أُرسلت')}
                    </p>
                  </div>
                </motion.div>
              </div>
            )
          })
        )}
        <div ref={end} />
      </div>

      <form onSubmit={submit} className="border-t border-ink/10 p-3">
        {send.isError && <p role="alert" className="mb-2 text-sm text-stamp">{messageOf(send.error)}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) submit(event)
            }}
            rows={1}
            maxLength={4000}
            placeholder="اكتب رسالتك…"
            aria-label="نص الرسالة"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-ink/20 bg-white px-4 py-2.5 text-ink placeholder:text-ink-faint focus:border-stamp-blue focus:outline-none"
          />
          <button type="submit" disabled={!text.trim() || send.isPending} aria-label="إرسال" className="grid size-11 shrink-0 place-items-center rounded-full bg-stamp text-paper transition-[transform,background-color] hover:bg-[#c00a17] active:scale-95 disabled:opacity-40">
            <Send className="size-5 rtl:-scale-x-100" aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  )
}

/** Direct messages: contacts on one side, the open conversation on the other. */
export const Messages = () => {
  const { session } = useAuth()
  const isClient = session?.role === 'client'
  const [openId, setOpenId] = useState<string | null>(null)
  const contacts = useQuery({
    queryKey: ['messages', 'contacts'],
    refetchInterval: 15_000,
    queryFn: async () => (await api.get<{ contacts: Contact[] }>('/messages/contacts')).data.contacts,
  })
  const open = contacts.data?.find((contact) => contact.user_id === openId) ?? null

  return (
    <>
      <SheetHeader title="الرسائل" note={isClient ? 'راسل المحامين المسندين إلى قضاياك.' : session?.role === 'admin' ? 'راسل أعضاء مكتبك وموكّليه.' : 'راسل موكّلي قضاياك وصاحب المكتب.'} />
      {contacts.isPending ? (
        <Loading />
      ) : contacts.isError ? (
        <Failed error={contacts.error} />
      ) : contacts.data.length === 0 ? (
        <Empty>{isClient ? 'لا يوجد محامٍ مسند إلى قضاياك بعد.' : 'لا جهات اتصال متاحة بعد.'}</Empty>
      ) : (
        <div className="grid h-[min(38rem,70dvh)] overflow-hidden rounded-xl border border-ink/10 md:grid-cols-[18rem_minmax(0,1fr)]">
          <ul className={cn('overflow-y-auto border-ink/10 md:border-e', open && 'hidden md:block')} aria-label="جهات الاتصال">
            {contacts.data.map((contact) => (
              <li key={contact.user_id}>
                <button
                  type="button"
                  onClick={() => setOpenId(contact.user_id)}
                  aria-current={contact.user_id === openId}
                  className={cn('flex w-full items-center gap-3 border-b border-ink/6 px-4 py-3 text-start transition-colors', contact.user_id === openId ? 'bg-stamp/8' : 'hover:bg-paper-shade')}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-desk text-sm font-bold text-paper">{initialsOf(contact.full_name)}</span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-semibold text-ink">{contact.full_name}</span>
                    <span className="block text-xs text-ink-faint">
                      {ROLE[contact.role]}
                      {contact.last_message_at && ` · ${timeAgo(contact.last_message_at)}`}
                    </span>
                  </span>
                  {contact.unread_count > 0 && <span className="grid min-w-6 place-items-center rounded-full bg-stamp px-1.5 text-xs leading-6 font-bold text-paper">{contact.unread_count}</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className={cn('min-h-0', !open && 'hidden md:block')}>
            {open ? <Thread key={open.user_id} contact={open} onBack={() => setOpenId(null)} /> : <p className="grid h-full place-items-center px-6 text-center text-ink-faint">اختر جهة اتصال لفتح المحادثة.</p>}
          </div>
        </div>
      )}
    </>
  )
}
