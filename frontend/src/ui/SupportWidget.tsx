import { useMutation } from '@tanstack/react-query'
import { ArrowRight, CheckCircle2, Headset, Landmark, MessageCircle, Send, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router'
import { personaOf, useAuth } from '@/auth/auth'
import { api, DEMO, messageOf } from '@/lib/api'
import { LANG } from '@/lib/i18n'
import { SelectField, TextArea } from './forms'
import { Button, cn, Field } from './kit'

type Turn = { role: 'user' | 'assistant'; text: string; contact?: boolean }

const STORAGE_KEY = 'qadiyati.support.chat'
const WELCOME: Turn = {
  role: 'assistant',
  text: 'أهلاً بك في قضيتي. أنا مساعد الموقع، أجيب عن أسئلتك حول استعمال المنصّة: التسجيل والدخول والاشتراك والخصائص.',
}
const SUGGESTIONS = ['كيف أسجّل مكتبي؟', 'ما سعر الاشتراك وطرق الدفع؟', 'نسيت كلمة المرور', 'كيف أدعو فريقي وموكّليّ؟']
const TOPICS = [
  ['registration', 'تسجيل المكتب'],
  ['subscription', 'الاشتراك والدفع'],
  ['account', 'الحساب والدخول'],
  ['technical', 'مشكلة تقنية'],
  ['other', 'أخرى'],
] as const

/** A remembered conversation survives page changes within the visit; storage may be unavailable. */
const loadChat = (): Turn[] => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as Turn[] | null
    return Array.isArray(saved) && saved.length ? saved : [WELCOME]
  } catch {
    return [WELCOME]
  }
}
const saveChat = (turns: Turn[]) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-30)))
  } catch {
    // Private windows may refuse storage; the chat still works for this page.
  }
}

/* ───────────────────────── the chat ───────────────────────── */

const Chat = ({ turns, setTurns, onContact }: { turns: Turn[]; setTurns: (turns: Turn[]) => void; onContact: () => void }) => {
  const [draft, setDraft] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const ask = useMutation({
    mutationFn: async (history: Turn[]) =>
      (
        await api.post<{ reply: string; suggest_contact: boolean }>('/support/chat', {
          messages: history.filter((turn) => turn !== WELCOME).map(({ role, text }) => ({ role, text })),
          // The assistant answers in the language the site is shown in.
          lang: LANG,
        })
      ).data,
    onSuccess: (answer, history) => setTurns([...history, { role: 'assistant', text: answer.reply, contact: answer.suggest_contact }]),
    onError: (error, history) =>
      setTurns([...history, { role: 'assistant', text: `${messageOf(error)} يمكنك التواصل مع إدارة المنصّة مباشرة.`, contact: true }]),
  })
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' })
  }, [turns, ask.isPending])

  const send = (text: string) => {
    const question = text.trim().slice(0, 500)
    if (!question || ask.isPending) return
    const history: Turn[] = [...turns, { role: 'user', text: question }]
    setTurns(history)
    setDraft('')
    ask.mutate(history)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    send(draft)
  }
  const fresh = turns.length === 1

  return (
    <>
      <div ref={list} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {turns.map((turn, index) => (
          <div key={index} className={cn('flex', turn.role === 'user' ? 'justify-start' : 'justify-end')}>
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line',
                turn.role === 'user' ? 'rounded-ee-sm bg-stamp text-paper' : 'rounded-es-sm bg-paper-shade text-ink',
              )}
            >
              {turn.text}
              {turn.contact && (
                <button type="button" onClick={onContact} className="mt-2 flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper hover:bg-ink/85">
                  <Headset className="size-3.5" aria-hidden="true" />
                  تواصل مع إدارة المنصّة
                </button>
              )}
            </div>
          </div>
        ))}
        {ask.isPending && (
          <div className="flex justify-end">
            <div className="flex gap-1 rounded-2xl rounded-es-sm bg-paper-shade px-4 py-3" aria-label="يكتب المساعد">
              {[0, 1, 2].map((dot) => (
                <motion.span key={dot} className="size-1.5 rounded-full bg-ink-soft" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: dot * 0.2 }} />
              ))}
            </div>
          </div>
        )}
        {fresh && (
          <div className="flex flex-wrap gap-2 pt-1">
            {SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} type="button" onClick={() => send(suggestion)} className="rounded-full border border-ink/20 px-3 py-1.5 text-xs text-ink transition-colors hover:border-stamp hover:text-stamp">
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 border-t border-ink/10 px-3 py-3">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={500}
          placeholder="اكتب سؤالك عن الموقع…"
          aria-label="سؤالك"
          className="h-10 min-w-0 flex-1 rounded-full border border-ink/20 bg-white px-4 text-sm text-ink placeholder:text-ink-faint focus:border-stamp-blue focus:outline-none"
        />
        <button type="submit" disabled={!draft.trim() || ask.isPending} aria-label="أرسل" className="grid size-10 shrink-0 place-items-center rounded-full bg-stamp text-paper transition-opacity disabled:opacity-40">
          <Send className="size-4 -scale-x-100" aria-hidden="true" />
        </button>
      </form>
      <button type="button" onClick={onContact} className="flex items-center justify-center gap-2 border-t border-ink/10 py-2.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-paper-shade hover:text-ink">
        <Headset className="size-4" aria-hidden="true" />
        تحتاج شخصاً من الإدارة؟ تواصل مع إدارة المنصّة
      </button>
    </>
  )
}

/* ───────────────────────── writing to the management ───────────────────────── */

const Contact = ({ turns, onBack }: { turns: Turn[]; onBack: () => void }) => {
  const { session } = useAuth()
  const location = useLocation()
  const [values, setValues] = useState({
    name: session?.user.full_name ?? '',
    email: session?.user.email ?? '',
    phone: '',
    topic: 'other',
    body: '',
    website: '',
  })
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const send = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ message_id: string | null }>('/support/messages', {
          name: values.name.trim(),
          email: values.email.trim(),
          ...(values.phone.trim() ? { phone: values.phone.trim() } : {}),
          topic: values.topic,
          body: values.body.trim(),
          website: values.website,
          page_path: location.pathname,
          // The chat so far, so the management sees what was already asked.
          transcript: turns.filter((turn) => turn !== WELCOME).map(({ role, text }) => ({ role, text })),
        })
      ).data,
  })

  if (send.isSuccess) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <CheckCircle2 className="size-12 text-stamp-green" aria-hidden="true" />
        <h3 className="mt-3 text-xl text-ink">وصلت رسالتك</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">تراجعها إدارة المنصّة وتردّ عليك على بريدك {values.email && <bdi className="font-semibold text-ink">{values.email}</bdi>}.</p>
        {send.data.message_id && (
          <p className="mt-2 text-xs text-ink-faint">
            رقم الرسالة: <bdi>{send.data.message_id.slice(0, 8).toUpperCase()}</bdi>
          </p>
        )}
        <Button variant="line" size="sm" className="mt-5" onClick={onBack}>
          العودة إلى المحادثة
        </Button>
      </div>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        send.mutate()
      }}
      className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
    >
      <p className="text-sm text-ink-soft">اكتب رسالتك وستصل إلى إدارة المنصّة مع محادثتك مع المساعد، ويصلك الرد على بريدك.</p>
      <Field label="الاسم" name="support-name" required maxLength={150} value={values.name} onChange={set('name')} />
      <Field label="البريد الإلكتروني" name="support-email" type="email" dir="ltr" required maxLength={254} value={values.email} onChange={set('email')} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="الهاتف (اختياري)" name="support-phone" dir="ltr" maxLength={30} value={values.phone} onChange={set('phone')} />
        <SelectField label="الموضوع" name="support-topic" value={values.topic} onChange={set('topic')} options={TOPICS} />
      </div>
      <TextArea label="رسالتك" name="support-body" rows={4} required maxLength={3000} value={values.body} onChange={set('body')} />
      {/* Left empty by people; bots that fill every field are ignored by the server. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" value={values.website} onChange={set('website')} className="hidden" aria-hidden="true" />
      {send.isError && <p role="alert" className="text-sm text-stamp">{messageOf(send.error)}</p>}
      <div className="flex justify-between gap-2 pt-1">
        <Button variant="line" size="sm" onClick={onBack}>
          رجوع
        </Button>
        <Button type="submit" variant="stamp" size="sm" disabled={send.isPending || !values.name.trim() || !values.email.trim() || !values.body.trim()}>
          {send.isPending ? 'تُرسل…' : 'أرسل إلى الإدارة'}
        </Button>
      </div>
    </form>
  )
}

/* ───────────────────────── the floating button and window ───────────────────────── */

/** A round help button in the corner of every page, opening the site's support chat. */
export const SupportWidget = () => {
  const { session } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'chat' | 'contact'>('chat')
  const [turns, setTurnsState] = useState<Turn[]>(loadChat)
  const setTurns = (next: Turn[]) => {
    setTurnsState(next)
    saveChat(next)
  }
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // The platform's own management does not need to write to itself; demo mode has no backend.
  if (DEMO || personaOf(session) === 'platform' || location.pathname.startsWith('/platform')) return null

  return (
    // In right-to-left pages "end" is the left side: the button stays in the corner under the window.
    <div className="no-print fixed bottom-5 left-5 z-40 flex flex-col items-end gap-3">
      <AnimatePresence>
        {open && (
          <motion.section
            role="dialog"
            aria-label="مساعد قضيتي"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="flex h-[min(34rem,calc(100dvh-7rem))] w-[min(23rem,calc(100vw-2.5rem))] origin-bottom-left flex-col overflow-hidden rounded-2xl border border-ink/10 bg-paper shadow-[0_18px_50px_-12px_rgba(6,29,51,0.45)]"
          >
            <header className="desk flex items-center gap-3 px-4 py-3 text-paper">
              {view === 'contact' ? (
                <button type="button" onClick={() => setView('chat')} aria-label="العودة إلى المحادثة" className="rounded-full p-1 hover:bg-paper/10">
                  <ArrowRight className="size-5 ltr:-scale-x-100" aria-hidden="true" />
                </button>
              ) : (
                <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-stamp">
                  <Landmark className="size-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{view === 'contact' ? 'تواصل مع إدارة المنصّة' : 'مساعد قضيتي'}</p>
                <p className="flex items-center gap-1.5 text-xs text-paper/70">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-[#3ecf8e]" />
                  {view === 'contact' ? 'نردّ على بريدك' : 'يجيب عن أسئلة الموقع فوراً'}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق" className="rounded-full p-1 hover:bg-paper/10">
                <X className="size-5" aria-hidden="true" />
              </button>
            </header>
            {view === 'chat' ? <Chat turns={turns} setTurns={setTurns} onContact={() => setView('contact')} /> : <Contact turns={turns} onBack={() => setView('chat')} />}
          </motion.section>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={open ? 'أغلق المساعد' : 'افتح مساعد قضيتي'}
        aria-expanded={open}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        className="relative grid size-14 place-items-center rounded-full bg-stamp text-paper shadow-[0_10px_30px_-6px_rgba(217,11,26,0.6)]"
      >
        {!open && <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-stamp/30 [animation-duration:2.5s]" />}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={open ? 'close' : 'open'} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
            {open ? <X className="size-6" aria-hidden="true" /> : <MessageCircle className="size-6" aria-hidden="true" />}
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </div>
  )
}
