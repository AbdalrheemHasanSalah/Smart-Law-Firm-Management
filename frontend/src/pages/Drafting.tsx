import { FilePlus2, Lock, Printer, Sparkles, Trash2, Undo2 } from 'lucide-react'
import { appendText } from '@/lib/voice'
import { DictateButton } from '@/ui/Voice'
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { PATHS, useAuth } from '@/auth/auth'
import { messageOf } from '@/lib/api'
import {
  DRAFT_KIND,
  DRAFT_SOURCE,
  DRAFT_STATUS,
  MAX_DESCRIPTION,
  openGaps,
  useCreateDraft,
  useDeleteDraft,
  useDraft,
  useDrafts,
  useFinalizeDraft,
  useGenerateDraft,
  useRevokeDraft,
  useTemplates,
  useUpdateDraft,
  type Draft,
  type DraftKind,
} from '@/lib/drafting'
import { formatDate, formatTime } from '@/lib/labels'
import { formatCode } from '@/lib/printing'
import { useParam } from '@/lib/useParam'
import { FormActions, Modal, SelectField, TextArea } from '@/ui/forms'
import { Button, cn, Field } from '@/ui/kit'
import { PrintSheet } from '@/ui/PrintSheet'
import { Empty, Failed, Loading, Pill } from '@/ui/Shell'

const KIND_OPTIONS = Object.entries(DRAFT_KIND) as [DraftKind, string][]

/* ───────────────────────── starting a draft ───────────────────────── */

type StartMode = 'template' | 'ai' | 'blank'

const NewDraft = ({ caseId, open, onClose, onCreated }: { caseId: string; open: boolean; onClose: () => void; onCreated: (draft: Draft) => void }) => {
  const templates = useTemplates()
  const create = useCreateDraft(caseId)
  const generate = useGenerateDraft(caseId)
  const [mode, setMode] = useState<StartMode>('template')
  const [choice, setChoice] = useState('')
  const [kind, setKind] = useState<DraftKind>('contract')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  useEffect(() => {
    if (!open) return
    create.reset()
    generate.reset()
    setChoice('')
    setTitle('')
    setDescription('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const done = { onSuccess: (draft: Draft) => { onCreated(draft); onClose() } }
    if (mode === 'ai') generate.mutate({ kind, description: description.trim() }, done)
    else if (mode === 'blank') create.mutate({ kind, title: title.trim() }, done)
    else if (choice.startsWith('b:')) create.mutate({ template_key: choice.slice(2) }, done)
    else if (choice.startsWith('t:')) create.mutate({ template_id: choice.slice(2) }, done)
  }
  const busy = create.isPending || generate.isPending
  const ready = mode === 'ai' ? description.trim().length >= 10 : mode === 'blank' ? title.trim().length > 0 : choice !== ''
  const error = create.isError ? messageOf(create.error) : generate.isError ? messageOf(generate.error) : null
  const options = [
    ['', templates.isPending ? 'يُحمَّل…' : 'اختر نموذجاً'] as const,
    ...(templates.data?.templates ?? []).map((template) => [`t:${template.template_id}`, `نموذج المكتب: ${template.title}`] as const),
    ...(templates.data?.builtin ?? []).map((template) => [`b:${template.key}`, `هيكل جاهز: ${template.title}`] as const),
  ]

  return (
    <Modal open={open} onClose={onClose} title="مسودة جديدة" wide>
      <form onSubmit={submit} className="space-y-4">
        <div role="radiogroup" aria-label="طريقة البدء" className="flex flex-wrap gap-2">
          {([['template', 'من نموذج'], ['ai', 'بالذكاء الاصطناعي'], ['blank', 'صفحة فارغة']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={mode === key}
              onClick={() => setMode(key)}
              className={cn('rounded-full px-3 py-1.5 text-sm', mode === key ? 'bg-ink text-paper' : 'border border-ink/20 text-ink hover:bg-ink/5')}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === 'template' && (
          <>
            <SelectField label="النموذج" name="draft_template" value={choice} onChange={(event) => setChoice(event.target.value)} options={options} />
            <p className="text-xs text-ink-faint">
              تُملأ بيانات القضية والموكّل والخصم تلقائياً، وما لا يتوفر يبقى بين قوسين مربعين لتكمله. يدير المكتب نماذجه من{' '}
              <Link to={`${PATHS.office}/templates`} className="text-stamp-blue underline-offset-4 hover:underline">صفحة النماذج</Link>.
            </p>
          </>
        )}
        {mode !== 'template' && (
          <SelectField label="نوع المستند" name="draft_kind" className="w-48" value={kind} onChange={(event) => setKind(event.target.value as DraftKind)} options={KIND_OPTIONS} />
        )}
        {mode === 'blank' && <Field label="العنوان" name="draft_title" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />}
        {mode === 'ai' && (
          <>
            <TextArea
              label="صِف المستند المطلوب"
              name="draft_description"
              rows={5}
              maxLength={MAX_DESCRIPTION}
              placeholder="مثلاً: عقد إيجار شقة سكنية لمدة سنة، الأجرة تُدفع كل ثلاثة أشهر، مع تأمين، ويتحمل المستأجر الصيانة البسيطة."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <DictateButton onText={(spoken) => setDescription((current) => appendText(current, spoken))} />
            <p className="text-xs text-ink-faint">
              تُحجب الأسماء والأرقام قبل الإرسال، وتُحسب من رصيد التحليلات الشهري. الناتج مسودة يراجعها المحامي، وما ينقصها من بيانات يظهر بين أقواس مربعة.
            </p>
          </>
        )}
        <FormActions error={error}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant={mode === 'ai' ? 'stamp' : 'ink'} disabled={!ready || busy}>
            {mode === 'ai' && <Sparkles className="size-4" aria-hidden="true" />}
            {busy ? (mode === 'ai' ? 'يُصاغ… قد يستغرق دقيقة' : 'يُنشأ…') : 'أنشئ المسودة'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  )
}

/* ───────────────────────── one draft ───────────────────────── */

const DraftEditor = ({ caseId, draft, onClosed }: { caseId: string; draft: Draft; onClosed: () => void }) => {
  const admin = useAuth().session?.active_office?.role === 'admin'
  const me = useAuth().session?.user.user_id
  const update = useUpdateDraft(caseId)
  const finalize = useFinalizeDraft(caseId)
  const revoke = useRevokeDraft(caseId)
  const remove = useDeleteDraft(caseId)
  const [title, setTitle] = useState(draft.title)
  const [kind, setKind] = useState<DraftKind>(draft.kind)
  const [body, setBody] = useState(draft.body ?? '')
  const [confirm, setConfirm] = useState<'finalize' | 'revoke' | 'delete' | null>(null)
  const [preview, setPreview] = useState(draft.status !== 'draft')
  useEffect(() => {
    setTitle(draft.title)
    setKind(draft.kind)
    setBody(draft.body ?? '')
    setPreview(draft.status !== 'draft')
  }, [draft.draft_id, draft.status, draft.title, draft.kind, draft.body])

  const editable = draft.status === 'draft'
  const dirty = editable && (title !== draft.title || kind !== draft.kind || body !== (draft.body ?? ''))
  const gaps = openGaps(body)
  const save = () => update.mutate({ draftId: draft.draft_id, title: title.trim(), kind, body })
  const error = [update, finalize, revoke, remove].find((mutation) => mutation.isError)?.error

  return (
    <section className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={DRAFT_STATUS[draft.status].tone}>{DRAFT_STATUS[draft.status].text}</Pill>
          <span className="text-xs text-ink-soft">{DRAFT_SOURCE[draft.source]} · {draft.created_by.full_name}</span>
          {draft.verification_code && (
            <span className="text-xs text-ink-soft">رمز التحقق: <bdi dir="ltr" className="font-mono">{formatCode(draft.verification_code)}</bdi></span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <Button variant="line" size="sm" onClick={() => setPreview(!preview)}>{preview ? 'عُد إلى التحرير' : 'معاينة الطباعة'}</Button>
          )}
          {(preview || !editable) && (
            <Button variant="ink" size="sm" disabled={dirty} onClick={() => window.print()} title={dirty ? 'احفظ التعديلات أولاً' : undefined}>
              <Printer className="size-4" aria-hidden="true" />
              اطبع
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClosed}>إغلاق</Button>
        </div>
      </div>

      {editable && !preview ? (
        <div className="no-print space-y-3 rounded-lg border border-rule bg-paper p-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <Field label="العنوان" name="edit_title" maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
            <SelectField label="النوع" name="edit_kind" value={kind} onChange={(event) => setKind(event.target.value as DraftKind)} options={KIND_OPTIONS} />
          </div>
          <TextArea label="نص المستند" name="edit_body" rows={22} className="[&_textarea]:font-doc [&_textarea]:text-lg [&_textarea]:leading-loose" value={body} onChange={(event) => setBody(event.target.value)} />
          <DictateButton onText={(spoken) => setBody((current) => appendText(current, spoken))} />
          <p className={cn('text-xs', gaps ? 'font-semibold text-stamp' : 'text-ink-faint')}>
            {gaps ? (gaps === 1 ? 'بقيت فجوة واحدة بين أقواس مربعة لتكملها.' : `بقيت ${gaps} فجوات بين أقواس مربعة لتكملها.`) : 'لا فجوات بين أقواس مربعة.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ink" size="sm" disabled={!dirty || !title.trim() || update.isPending} onClick={save}>{update.isPending ? 'يُحفظ…' : 'احفظ'}</Button>
            <Button variant="stamp" size="sm" disabled={dirty || !body.trim()} onClick={() => setConfirm('finalize')} title={dirty ? 'احفظ التعديلات أولاً' : undefined}>
              <Lock className="size-4" aria-hidden="true" />
              اعتمد المستند
            </Button>
            {(admin || me === draft.created_by.user_id) && (
              <Button variant="ghost" size="sm" onClick={() => setConfirm('delete')}>
                <Trash2 className="size-4" aria-hidden="true" />
                احذف المسودة
              </Button>
            )}
          </div>
        </div>
      ) : (
        <PrintSheet kind={draft.kind} title={draft.title} draft={draft.status === 'draft'} code={draft.status === 'final' ? draft.verification_code : null}>
          {draft.status === 'revoked' && (
            <p role="alert" className="mb-4 rounded-md border border-stamp/40 bg-stamp/5 px-3 py-2 text-sm font-semibold text-stamp">
              سُحب هذا المستند في {formatDate(draft.revoked_at)}: رمز التحقق يظهر الآن «مسحوب».
            </p>
          )}
          <div className="font-doc text-lg leading-loose whitespace-pre-line text-ink" data-no-translate>{draft.status === 'draft' ? body : draft.body}</div>
        </PrintSheet>
      )}

      {draft.status === 'final' && admin && (
        <div className="no-print">
          <Button variant="ghost" size="sm" onClick={() => setConfirm('revoke')}>
            <Undo2 className="size-4" aria-hidden="true" />
            اسحب المستند
          </Button>
        </div>
      )}
      {error && <p role="alert" className="no-print text-sm text-stamp">{messageOf(error)}</p>}

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'finalize' ? 'اعتماد المستند' : confirm === 'revoke' ? 'سحب المستند' : 'حذف المسودة'}
      >
        <p className="leading-relaxed text-ink">
          {confirm === 'finalize'
            ? `بعد الاعتماد لا يمكن تعديل النص، ويأخذ المستند بصمة ورمز تحقق يُطبع عليه، ويبقى في ملف القضية.${gaps ? ` تنبيه: في النص ${gaps === 1 ? 'فجوة واحدة' : `${gaps} فجوات`} بين أقواس مربعة.` : ''}`
            : confirm === 'revoke'
              ? 'يبقى المستند في السجل، لكن رمز التحقق المطبوع عليه سيُظهر لمن يتحقق منه أنه «مسحوب».'
              : 'تُحذف المسودة نهائياً.'}
        </p>
        <FormActions>
          <Button variant="line" onClick={() => setConfirm(null)}>تراجع</Button>
          <Button
            variant={confirm === 'finalize' ? 'stamp' : 'ink'}
            onClick={() => {
              const close = { onSuccess: () => setConfirm(null) }
              if (confirm === 'finalize') finalize.mutate(draft.draft_id, close)
              if (confirm === 'revoke') revoke.mutate(draft.draft_id, close)
              if (confirm === 'delete') remove.mutate(draft.draft_id, { onSuccess: () => { setConfirm(null); onClosed() } })
            }}
          >
            {confirm === 'finalize' ? 'اعتمد' : confirm === 'revoke' ? 'اسحب' : 'احذف'}
          </Button>
        </FormActions>
      </Modal>
    </section>
  )
}

/* ───────────────────────── the tab ───────────────────────── */

export const CaseDrafting = ({ caseId }: { caseId: string }) => {
  const drafts = useDrafts(caseId)
  const [selected, setSelected] = useParam('draft')
  const draft = useDraft(caseId, selected)
  const [creating, setCreating] = useState(false)

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-soft">
          عقود ولوائح وكتب القضية: ابدأ من نموذج أو صفحة فارغة أو اطلب مسودة من الذكاء الاصطناعي، ثم حرّرها واعتمدها. المستند المعتمد لا يتغير، ويُطبع بترويسة المكتب ورمز تحقق.
        </p>
        <Button variant="ink" size="sm" onClick={() => setCreating(true)}>
          <FilePlus2 className="size-4" aria-hidden="true" />
          مسودة جديدة
        </Button>
      </div>

      {selected && (draft.isPending ? <Loading /> : draft.isError ? <Failed error={new Error(messageOf(draft.error))} /> : <DraftEditor caseId={caseId} draft={draft.data} onClosed={() => setSelected(null)} />)}

      <section className="no-print">
        <h3 className="mb-2 text-xl text-ink">مستندات القضية</h3>
        {drafts.isPending ? (
          <Loading />
        ) : drafts.isError ? (
          <Failed error={drafts.error} />
        ) : drafts.data.length === 0 ? (
          <Empty>لا مسودات أو مستندات معتمدة لهذه القضية بعد.</Empty>
        ) : (
          <ul className="divide-y divide-rule rounded-lg border border-rule bg-paper">
            {drafts.data.map((entry) => (
              <li key={entry.draft_id}>
                <button
                  type="button"
                  onClick={() => setSelected(entry.draft_id)}
                  aria-current={selected === entry.draft_id}
                  className={cn('flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-start hover:bg-marker/20', selected === entry.draft_id && 'bg-marker/25')}
                >
                  <span>
                    <span className="block text-sm font-semibold text-ink" data-no-translate>{entry.title}</span>
                    <span className="text-xs text-ink-soft">
                      {DRAFT_KIND[entry.kind]} · {DRAFT_SOURCE[entry.source]} · {formatDate(entry.updated_at)} {formatTime(entry.updated_at)}
                    </span>
                  </span>
                  <Pill tone={DRAFT_STATUS[entry.status].tone}>{DRAFT_STATUS[entry.status].text}</Pill>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <NewDraft caseId={caseId} open={creating} onClose={() => setCreating(false)} onCreated={(created) => setSelected(created.draft_id)} />
    </div>
  )
}
