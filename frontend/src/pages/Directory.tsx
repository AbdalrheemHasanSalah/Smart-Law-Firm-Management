import { useQuery } from '@tanstack/react-query'
import { Clock, Copy, Mail, MapPin, MessageCircle, Phone, Plus, Search, StickyNote } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/auth'
import { messageOf } from '@/lib/api'
import {
  BUILT_IN_TEMPLATES,
  fillTemplate,
  mailtoUrl,
  PLACEHOLDERS,
  useColleagues,
  useCourtNote,
  useCourts,
  useDeleteColleague,
  useDeleteTemplate,
  useOfficeTemplates,
  useSaveColleague,
  useSaveCourt,
  useSaveTemplate,
  whatsappUrl,
  type Colleague,
  type ColleagueInput,
  type Court,
  type CourtInput,
  type MessageTemplate,
} from '@/lib/directory'
import { fetchCaseHearings } from '@/lib/hearings'
import { formatDate, formatTime } from '@/lib/labels'
import { oneOf, useParam } from '@/lib/useParam'
import { FormActions, Modal, SelectField, TextArea } from '@/ui/forms'
import { Button, cn, Field } from '@/ui/kit'
import { Empty, Failed, Loading, Pill, SheetHeader } from '@/ui/Shell'
import { useCases } from './Office'

const LINK = 'text-xs font-semibold underline-offset-4 hover:underline'
const TH = 'py-2 pe-3 text-start text-xs font-semibold text-ink-soft'
const TD = 'py-2.5 pe-3 align-top text-sm'

const SearchBox = ({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) => (
  <label className="relative block w-full max-w-sm">
    <span className="sr-only">{label}</span>
    <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-ink-faint" aria-hidden="true" />
    <input
      type="search"
      value={value}
      placeholder={label}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full rounded-md border border-ink/25 bg-white/60 ps-9 pe-3 text-sm text-ink"
    />
  </label>
)

/** A search value that settles after a short pause, so typing does not query on every key. */
const useSettled = (value: string, delay = 300) => {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value.trim()), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return settled
}

/* ───────────────────────── colleagues ───────────────────────── */

const COLLEAGUE_FIELDS = [
  ['full_name', 'الاسم', true],
  ['bar_number', 'رقم العضوية في النقابة', false],
  ['phone', 'الهاتف', false],
  ['email', 'البريد الإلكتروني', false],
  ['office_name', 'المكتب', false],
  ['city', 'المدينة', false],
] as const

const ColleagueForm = ({ colleague, open, onClose }: { colleague: Colleague | null; open: boolean; onClose: () => void }) => {
  const save = useSaveColleague()
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!open) return
    save.reset()
    setValues(Object.fromEntries([...COLLEAGUE_FIELDS.map(([key]) => key), 'notes'].map((key) => [key, (colleague?.[key as keyof Colleague] as string | null) ?? ''])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, colleague?.colleague_id])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const input = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim() || null])) as ColleagueInput
    save.mutate({ colleagueId: colleague?.colleague_id, input }, { onSuccess: onClose })
  }
  return (
    <Modal open={open} onClose={onClose} title={colleague ? 'تعديل بيانات الزميل' : 'إضافة زميل'}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {COLLEAGUE_FIELDS.map(([key, label, required]) => (
            <Field
              key={key}
              label={label}
              name={`colleague_${key}`}
              required={required}
              type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
              dir={key === 'email' || key === 'phone' || key === 'bar_number' ? 'ltr' : undefined}
              maxLength={key === 'phone' || key === 'bar_number' ? 40 : 150}
              value={values[key] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
            />
          ))}
        </div>
        <TextArea label="ملاحظات (اختياري)" name="colleague_notes" rows={2} maxLength={1000} value={values.notes ?? ''} onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} />
        <FormActions error={save.isError ? messageOf(save.error) : null}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="ink" disabled={save.isPending}>{save.isPending ? 'يُحفظ…' : 'احفظ'}</Button>
        </FormActions>
      </form>
    </Modal>
  )
}

/** Writes a message to a colleague from a template and opens it in WhatsApp or the mail app. */
const Composer = ({ colleague, onClose }: { colleague: Colleague | null; onClose: () => void }) => {
  const { session } = useAuth()
  const office = useOfficeTemplates()
  const cases = useCases()
  const templates = [...BUILT_IN_TEMPLATES, ...(office.data ?? [])]
  const [templateId, setTemplateId] = useState(BUILT_IN_TEMPLATES[0]!.template_id)
  const [caseId, setCaseId] = useState('')
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const hearings = useQuery({ queryKey: ['hearings', caseId], enabled: Boolean(caseId), queryFn: () => fetchCaseHearings(caseId) })
  const template = templates.find((entry) => entry.template_id === templateId) ?? templates[0]!
  const chosen = cases.data?.find((row) => row.case_id === caseId)
  const next = (hearings.data ?? [])
    .filter((entry) => entry.status === 'scheduled' && new Date(entry.hearing_at).getTime() > Date.now())
    .sort((a, b) => a.hearing_at.localeCompare(b.hearing_at))[0]

  useEffect(() => {
    if (!colleague) return
    setText(
      fillTemplate(template.body, {
        '{الزميل}': colleague.full_name,
        '{رقم_القضية}': chosen?.case_number,
        '{موضوع_القضية}': chosen?.title,
        '{المحكمة}': next?.court_name,
        '{الجلسة_القادمة}': next ? `${formatDate(next.hearing_at)} ${formatTime(next.hearing_at)}` : null,
        '{اسمي}': session?.user.full_name,
        '{مكتبي}': session?.active_office?.office_name,
      }),
    )
  }, [colleague, template.body, chosen?.case_number, chosen?.title, next?.court_name, next?.hearing_at, session?.user.full_name, session?.active_office?.office_name])

  return (
    <Modal open={colleague !== null} onClose={onClose} title={colleague ? `رسالة إلى ${colleague.full_name}` : ''} wide>
      {colleague && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="القالب" name="composer_template" value={templateId} onChange={(event) => setTemplateId(event.target.value)} options={templates.map((entry) => [entry.template_id, entry.title] as const)} />
            <SelectField
              label="القضية (تملأ الرقم والمحكمة والجلسة)"
              name="composer_case"
              value={caseId}
              onChange={(event) => setCaseId(event.target.value)}
              options={[['', 'بلا قضية'], ...(cases.data ?? []).map((row) => [row.case_id, `${row.case_number} — ${row.title}`] as const)]}
            />
          </div>
          <TextArea label="نص الرسالة (عدّله كما تشاء قبل الإرسال)" name="composer_text" rows={10} maxLength={4000} value={text} onChange={(event) => setText(event.target.value)} />
          {text.includes('…') && <p className="text-xs text-stamp">في النص حقول فارغة (…) — اختر قضية أو أكملها بنفسك.</p>}
          <p className="text-xs text-ink-faint">لا يُرسل النظام شيئاً: يفتح الرسالة جاهزة في واتساب أو بريدك، وأنت من يضغط إرسال.</p>
          <div className="flex flex-wrap items-center gap-2">
            {colleague.phone && (
              <a href={whatsappUrl(colleague.phone, text)} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-stamp-green px-3 text-sm font-semibold text-paper hover:opacity-90">
                <MessageCircle className="size-4" aria-hidden="true" />
                افتح في واتساب
              </a>
            )}
            {colleague.email && (
              <a href={mailtoUrl(colleague.email, template.title, text)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-paper hover:opacity-90">
                <Mail className="size-4" aria-hidden="true" />
                افتح في البريد
              </a>
            )}
            <Button
              variant="line"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(text).then(() => {
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1500)
                })
              }}
            >
              <Copy className="size-4" aria-hidden="true" />
              {copied ? 'نُسخ' : 'انسخ النص'}
            </Button>
            {!colleague.phone && !colleague.email && <span className="text-xs text-ink-soft">لا هاتف ولا بريد لهذا الزميل — انسخ النص أو أضف وسيلة تواصل.</span>}
          </div>
        </div>
      )}
    </Modal>
  )
}

const ColleaguesTab = ({ admin }: { admin: boolean }) => {
  const [search, setSearch] = useState('')
  const colleagues = useColleagues(useSettled(search))
  const remove = useDeleteColleague()
  const [editing, setEditing] = useState<Colleague | null>(null)
  const [adding, setAdding] = useState(false)
  const [writing, setWriting] = useState<Colleague | null>(null)
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchBox value={search} onChange={setSearch} label="ابحث بالاسم أو رقم العضوية أو المدينة" />
        <Button variant="stamp" size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden="true" />
          إضافة زميل
        </Button>
      </div>
      {remove.isError && <p role="alert" className="mb-3 text-sm text-stamp">{messageOf(remove.error)}</p>}
      {colleagues.isPending ? (
        <Loading />
      ) : colleagues.isError ? (
        <Failed error={colleagues.error} />
      ) : colleagues.data.length === 0 ? (
        <Empty>{search.trim() ? 'لا زملاء يطابقون البحث.' : 'لا زملاء في دليل مكتبك بعد. أضف المحامين الذين تتعامل معهم من المكاتب الأخرى لتراسلهم بسرعة.'}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b-2 border-ink">
                {['الزميل', 'رقم العضوية', 'المدينة', 'التواصل', ''].map((head) => <th key={head} scope="col" className={TH}>{head}</th>)}
              </tr>
            </thead>
            <tbody>
              {colleagues.data.map((colleague) => (
                <tr key={colleague.colleague_id} className="border-b border-rule">
                  <td className={TD}>
                    <span className="font-semibold text-ink">{colleague.full_name}</span>
                    {colleague.office_name && <span className="block text-xs text-ink-soft">{colleague.office_name}</span>}
                    {colleague.notes && <span className="block text-xs text-ink-faint">{colleague.notes}</span>}
                  </td>
                  <td className={cn(TD, 'tabular-nums')} dir="ltr">{colleague.bar_number ?? '—'}</td>
                  <td className={TD}>{colleague.city ?? '—'}</td>
                  <td className={cn(TD, 'text-xs')}>
                    {colleague.phone && <a href={`tel:${colleague.phone.replace(/\s/g, '')}`} className="block text-stamp-blue" dir="ltr">{colleague.phone}</a>}
                    {colleague.email && <a href={`mailto:${colleague.email}`} className="block text-stamp-blue" dir="ltr">{colleague.email}</a>}
                  </td>
                  <td className={cn(TD, 'text-end whitespace-nowrap')}>
                    <button type="button" onClick={() => setWriting(colleague)} className={cn(LINK, 'me-3 text-stamp')}>راسله</button>
                    <button type="button" onClick={() => setEditing(colleague)} className={cn(LINK, 'me-3 text-stamp-blue')}>تعديل</button>
                    {admin && (
                      <button
                        type="button"
                        disabled={remove.isPending}
                        onClick={() => window.confirm(`حذف ${colleague.full_name} من دليل المكتب؟`) && remove.mutate(colleague.colleague_id)}
                        className={cn(LINK, 'text-ink-soft')}
                      >
                        حذف
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ColleagueForm colleague={editing} open={adding || editing !== null} onClose={() => { setAdding(false); setEditing(null) }} />
      <Composer colleague={writing} onClose={() => setWriting(null)} />
    </>
  )
}

/* ───────────────────────── courts ───────────────────────── */

const COURT_FIELDS = [
  ['name', 'اسم المحكمة', true],
  ['court_type', 'النوع (صلح، بداية، استئناف…)', false],
  ['city', 'المدينة', false],
  ['location', 'العنوان', false],
  ['phone', 'الهاتف', false],
  ['email', 'البريد الإلكتروني', false],
  ['working_hours', 'ساعات الدوام', false],
] as const

const CourtForm = ({ court, open, onClose }: { court: Court | null; open: boolean; onClose: () => void }) => {
  const save = useSaveCourt()
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!open) return
    save.reset()
    setValues(Object.fromEntries(COURT_FIELDS.map(([key]) => [key, (court?.[key] as string | null) ?? ''])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, court?.court_id])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const input = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim() || null])) as CourtInput
    save.mutate({ courtId: court?.court_id, input }, { onSuccess: onClose })
  }
  return (
    <Modal open={open} onClose={onClose} title={court ? 'تعديل بيانات المحكمة' : 'إضافة محكمة'}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {COURT_FIELDS.map(([key, label, required]) => (
            <Field
              key={key}
              label={label}
              name={`court_${key}`}
              required={required}
              dir={key === 'email' || key === 'phone' ? 'ltr' : undefined}
              maxLength={key === 'location' ? 300 : 150}
              value={values[key] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
            />
          ))}
        </div>
        <FormActions error={save.isError ? messageOf(save.error) : null}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="ink" disabled={save.isPending}>{save.isPending ? 'يُحفظ…' : 'احفظ'}</Button>
        </FormActions>
      </form>
    </Modal>
  )
}

const CourtNote = ({ court }: { court: Court }) => {
  const save = useCourtNote()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  if (!editing) {
    return (
      <div className="mt-3 flex items-start gap-2 border-t border-rule pt-2 text-xs">
        <StickyNote className="mt-0.5 size-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
        <span className={cn('min-w-0 flex-1', court.office_note ? 'text-ink' : 'text-ink-faint')}>{court.office_note ?? 'لا ملاحظة لمكتبك على هذه المحكمة.'}</span>
        <button type="button" onClick={() => { setDraft(court.office_note ?? ''); setEditing(true) }} className={cn(LINK, 'shrink-0 text-stamp-blue')}>
          {court.office_note ? 'تعديل' : 'أضف ملاحظة'}
        </button>
      </div>
    )
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate({ courtId: court.court_id, note: draft.trim() }, { onSuccess: () => setEditing(false) })
      }}
      className="mt-3 space-y-2 border-t border-rule pt-2"
    >
      <TextArea label="ملاحظة مكتبك (لا يراها غيركم)" name={`court_note_${court.court_id}`} rows={2} maxLength={1000} value={draft} onChange={(event) => setDraft(event.target.value)} />
      {save.isError && <p role="alert" className="text-xs text-stamp">{messageOf(save.error)}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="ink" size="sm" disabled={save.isPending}>احفظ</Button>
        <Button variant="line" size="sm" onClick={() => setEditing(false)}>إلغاء</Button>
      </div>
    </form>
  )
}

/** The shared court list: offices read it and keep notes; the platform admin edits it. */
export const CourtsList = ({ manage }: { manage: boolean }) => {
  const [search, setSearch] = useState('')
  const courts = useCourts(useSettled(search))
  const save = useSaveCourt()
  const [editing, setEditing] = useState<Court | null>(null)
  const [adding, setAdding] = useState(false)
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchBox value={search} onChange={setSearch} label="ابحث باسم المحكمة أو المدينة" />
        {manage && (
          <Button variant="stamp" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" />
            إضافة محكمة
          </Button>
        )}
      </div>
      {courts.isPending ? (
        <Loading />
      ) : courts.isError ? (
        <Failed error={courts.error} />
      ) : courts.data.length === 0 ? (
        <Empty>{search.trim() ? 'لا محاكم تطابق البحث.' : manage ? 'لا محاكم في الدليل بعد. أضف المحاكم ليراها كل المكاتب.' : 'دليل المحاكم فارغ حالياً، تضيفه إدارة المنصّة.'}</Empty>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {courts.data.map((court) => (
            <li key={court.court_id} className={cn('rounded-lg border border-rule bg-paper p-4', !court.is_active && 'opacity-60')}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">{court.name}</p>
                  <p className="text-xs text-ink-soft">{[court.court_type, court.city].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                {!court.is_active && <Pill tone="ink">مخفية عن المكاتب</Pill>}
              </div>
              <ul className="mt-2 space-y-1 text-sm text-ink-soft">
                {court.location && <li className="flex items-center gap-2"><MapPin className="size-3.5 shrink-0" aria-hidden="true" />{court.location}</li>}
                {court.phone && <li className="flex items-center gap-2"><Phone className="size-3.5 shrink-0" aria-hidden="true" /><a href={`tel:${court.phone.replace(/\s/g, '')}`} dir="ltr" className="text-stamp-blue">{court.phone}</a></li>}
                {court.email && <li className="flex items-center gap-2"><Mail className="size-3.5 shrink-0" aria-hidden="true" /><a href={`mailto:${court.email}`} dir="ltr" className="text-stamp-blue">{court.email}</a></li>}
                {court.working_hours && <li className="flex items-center gap-2"><Clock className="size-3.5 shrink-0" aria-hidden="true" />{court.working_hours}</li>}
              </ul>
              {manage ? (
                <div className="mt-3 flex gap-3 border-t border-rule pt-2">
                  <button type="button" onClick={() => setEditing(court)} className={cn(LINK, 'text-stamp-blue')}>تعديل</button>
                  <button
                    type="button"
                    disabled={save.isPending}
                    onClick={() => save.mutate({ courtId: court.court_id, input: { is_active: !court.is_active } })}
                    className={cn(LINK, 'text-ink-soft')}
                  >
                    {court.is_active ? 'إخفاء عن المكاتب' : 'إظهار للمكاتب'}
                  </button>
                </div>
              ) : (
                <CourtNote court={court} />
              )}
            </li>
          ))}
        </ul>
      )}
      {manage && <CourtForm court={editing} open={adding || editing !== null} onClose={() => { setAdding(false); setEditing(null) }} />}
    </>
  )
}

/* ───────────────────────── templates ───────────────────────── */

const TemplateForm = ({ template, open, onClose }: { template: MessageTemplate | null; open: boolean; onClose: () => void }) => {
  const save = useSaveTemplate()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  useEffect(() => {
    if (!open) return
    save.reset()
    setTitle(template?.title ?? '')
    setBody(template?.body ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.template_id])
  return (
    <Modal open={open} onClose={onClose} title={template ? 'تعديل القالب' : 'قالب جديد'} wide>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate({ templateId: template?.template_id, input: { title: title.trim(), body: body.trim() } }, { onSuccess: onClose })
        }}
        className="space-y-4"
      >
        <Field label="العنوان" name="template_title" required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
        <TextArea label="النص" name="template_body" rows={9} required maxLength={3000} value={body} onChange={(event) => setBody(event.target.value)} />
        <div className="text-xs text-ink-soft">
          <p className="mb-1">حقول تُملأ تلقائياً — اضغط لإضافتها:</p>
          <div className="flex flex-wrap gap-1.5">
            {PLACEHOLDERS.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setBody((current) => `${current}${key}`)} title={label} className="rounded-full border border-ink/20 px-2 py-0.5 hover:border-ink" data-no-translate>
                {key}
              </button>
            ))}
          </div>
        </div>
        <FormActions error={save.isError ? messageOf(save.error) : null}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="ink" disabled={save.isPending || !title.trim() || !body.trim()}>{save.isPending ? 'يُحفظ…' : 'احفظ'}</Button>
        </FormActions>
      </form>
    </Modal>
  )
}

const TemplatesTab = ({ admin }: { admin: boolean }) => {
  const office = useOfficeTemplates()
  const remove = useDeleteTemplate()
  const [editing, setEditing] = useState<MessageTemplate | null>(null)
  const [adding, setAdding] = useState(false)
  const Card = ({ template }: { template: MessageTemplate }) => (
    <li className="rounded-lg border border-rule bg-paper p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-ink">{template.title}</p>
        {template.builtIn ? (
          <Pill tone="ink">جاهز</Pill>
        ) : (
          admin && (
            <span className="flex gap-3">
              <button type="button" onClick={() => setEditing(template)} className={cn(LINK, 'text-stamp-blue')}>تعديل</button>
              <button type="button" disabled={remove.isPending} onClick={() => window.confirm(`حذف القالب «${template.title}»؟`) && remove.mutate(template.template_id)} className={cn(LINK, 'text-ink-soft')}>حذف</button>
            </span>
          )
        )}
      </div>
      <p className="line-clamp-4 text-sm whitespace-pre-line text-ink-soft" dir="rtl" data-no-translate>{template.body}</p>
    </li>
  )
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-soft">القوالب الجاهزة متاحة لكل المكاتب. {admin ? 'أضف قوالب مكتبك الخاصة لتظهر لفريقك عند مراسلة الزملاء.' : 'قوالب المكتب الخاصة يضيفها صاحب المكتب.'}</p>
        {admin && (
          <Button variant="stamp" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" />
            قالب جديد
          </Button>
        )}
      </div>
      {remove.isError && <p role="alert" className="mb-3 text-sm text-stamp">{messageOf(remove.error)}</p>}
      <ul className="grid gap-3 md:grid-cols-2">
        {BUILT_IN_TEMPLATES.map((template) => <Card key={template.template_id} template={template} />)}
        {(office.data ?? []).map((template) => <Card key={template.template_id} template={template} />)}
      </ul>
      {office.isError && <Failed error={office.error} />}
      {admin && <TemplateForm template={editing} open={adding || editing !== null} onClose={() => { setAdding(false); setEditing(null) }} />}
    </>
  )
}

/* ───────────────────────── page ───────────────────────── */

const TABS = [
  ['colleagues', 'الزملاء'],
  ['courts', 'المحاكم'],
  ['templates', 'قوالب الرسائل'],
] as const

export const Directory = () => {
  const admin = useAuth().session?.active_office?.role === 'admin'
  const [tabParam, setTabParam] = useParam('tab')
  const tab = oneOf(tabParam, TABS.map(([key]) => key), 'colleagues')
  return (
    <>
      <SheetHeader title="الدليل المهني" note="زملاؤك من المكاتب الأخرى، ودليل المحاكم، وقوالب جاهزة لمراسلة الزملاء عبر واتساب أو البريد." />
      <div role="tablist" aria-label="أقسام الدليل" className="mb-6 flex flex-wrap gap-1 border-b border-rule">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTabParam(key === 'colleagues' ? null : key)}
            className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-semibold', tab === key ? 'border-stamp text-ink' : 'border-transparent text-ink-soft hover:text-ink')}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'colleagues' && <ColleaguesTab admin={admin} />}
      {tab === 'courts' && <CourtsList manage={false} />}
      {tab === 'templates' && <TemplatesTab admin={admin} />}
    </>
  )
}

/** The platform admin's page for the shared court list. */
export const PlatformCourts = () => (
  <>
    <SheetHeader title="دليل المحاكم" note="قائمة واحدة تراها كل المكاتب. المحكمة المخفية تبقى مرتبطة بقضاياها لكنها لا تظهر في الدليل." />
    <CourtsList manage />
  </>
)
