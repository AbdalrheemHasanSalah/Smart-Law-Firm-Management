import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, FileText, Plus, ShieldAlert, ShieldCheck, Upload, XCircle } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { PATHS, useAuth } from '@/auth/auth'
import { messageOf } from '@/lib/api'
import { DRAFT_KIND, TEMPLATE_FIELDS, useArchiveTemplate, useSaveTemplate, useTemplates, type DraftKind, type Template } from '@/lib/drafting'
import { formatDate } from '@/lib/labels'
import { PRINT_KIND, fetchVerification, formatCode, useLetterhead, useLetterheadLogo, useSaveLetterhead, type Letterhead } from '@/lib/printing'
import { tafqeet } from '@/lib/tafqeet'
import { FormActions, Modal, SelectField, TextArea } from '@/ui/forms'
import { Button, Field, Logo } from '@/ui/kit'
import { PrintSheet } from '@/ui/PrintSheet'
import { Empty, Failed, Loading, Pill, SheetHeader } from '@/ui/Shell'

/* ───────────────────────── templates ───────────────────────── */

const TemplateForm = ({ template, onClose }: { template: Template | 'new' | null; onClose: () => void }) => {
  const save = useSaveTemplate()
  const [kind, setKind] = useState<DraftKind>('contract')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const key = template === null ? null : template === 'new' ? 'new' : template.template_id ?? template.key
  useEffect(() => {
    if (template === null) return
    save.reset()
    setKind(template === 'new' ? 'contract' : template.kind)
    setTitle(template === 'new' ? '' : template.builtin ? `${template.title} (نسخة المكتب)` : template.title)
    setBody(template === 'new' ? '' : template.body)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const editing = template !== null && template !== 'new' && !template.builtin ? template.template_id : undefined
  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate({ templateId: editing, kind, title: title.trim(), body }, { onSuccess: onClose })
  }
  return (
    <Modal open={template !== null} onClose={onClose} title={editing ? 'تعديل النموذج' : 'نموذج جديد للمكتب'} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <Field label="العنوان" name="template_title" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
          <SelectField label="النوع" name="template_kind" value={kind} onChange={(event) => setKind(event.target.value as DraftKind)} options={Object.entries(DRAFT_KIND) as [DraftKind, string][]} />
        </div>
        <TextArea label="نص النموذج" name="template_body" required rows={16} className="[&_textarea]:font-doc [&_textarea]:leading-loose" value={body} onChange={(event) => setBody(event.target.value)} />
        <div>
          <p className="text-xs font-semibold text-ink-soft">حقول تُملأ من القضية (انقر لإضافتها في آخر النص):</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {TEMPLATE_FIELDS.map(([field, label]) => (
              <button key={field} type="button" onClick={() => setBody((current) => `${current}{{${field}}}`)} className="rounded bg-stamp-blue/10 px-2 py-0.5 text-xs text-stamp-blue hover:bg-stamp-blue/20">
                {label} <bdi dir="ltr" className="font-mono">{`{{${field}}}`}</bdi>
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-faint">ما لا يتوفر في القضية يظهر […]، وما تتركه أنت بين أقواس مربعة يُحسب فجوة يكملها المحامي.</p>
        </div>
        <FormActions error={save.isError ? messageOf(save.error) : null}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="ink" disabled={!title.trim() || !body.trim() || save.isPending}>{save.isPending ? 'يُحفظ…' : 'احفظ'}</Button>
        </FormActions>
      </form>
    </Modal>
  )
}

export const Templates = () => {
  const templates = useTemplates()
  const archive = useArchiveTemplate()
  const role = useAuth().session?.active_office?.role
  const editor = role === 'admin' || role === 'lawyer'
  const [editing, setEditing] = useState<Template | 'new' | null>(null)
  const [viewing, setViewing] = useState<Template | null>(null)
  return (
    <>
      <SheetHeader
        title="النماذج"
        note="نماذج المكتب، والهياكل الجاهزة للعقود واللوائح. تُستعمل من تبويب «الصياغة» في ملف القضية."
        action={editor && <Button variant="ink" size="sm" onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden="true" />نموذج جديد</Button>}
      />
      {templates.isPending ? (
        <Loading />
      ) : templates.isError ? (
        <Failed error={templates.error} />
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-xl text-ink">نماذج المكتب</h2>
            {templates.data.templates.length === 0 ? (
              <Empty>لم يضف المكتب نماذجه بعد. ابدأ بنسخة من أحد الهياكل الجاهزة أدناه.</Empty>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {templates.data.templates.map((template) => (
                  <li key={template.template_id} className="rounded-lg border border-rule bg-paper p-4">
                    <p className="font-semibold text-ink" data-no-translate>{template.title}</p>
                    <p className="text-xs text-ink-soft">{DRAFT_KIND[template.kind]}{template.updated_at ? ` · ${formatDate(template.updated_at)}` : ''}</p>
                    <div className="mt-2 flex gap-4 text-xs font-semibold">
                      <button type="button" onClick={() => setViewing(template)} className="text-ink underline-offset-4 hover:underline">عرض</button>
                      {editor && <button type="button" onClick={() => setEditing(template)} className="text-stamp-blue underline-offset-4 hover:underline">تعديل</button>}
                      {editor && <button type="button" onClick={() => archive.mutate(template.template_id!)} className="text-stamp underline-offset-4 hover:underline">أرشفة</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2 className="mb-1 text-xl text-ink">هياكل جاهزة</h2>
            <p className="mb-3 text-sm text-ink-soft">أقسام كل مستند وحقوله فقط، دون نصوص قانونية: يكتب المحامي المضمون ويراجع المسودة قبل استعمالها.</p>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {templates.data.builtin.map((template) => (
                <li key={template.key} className="flex items-center justify-between gap-2 rounded-lg border border-rule bg-paper p-4">
                  <span>
                    <span className="flex items-center gap-1.5 font-semibold text-ink"><FileText className="size-4 text-ink-soft" aria-hidden="true" />{template.title}</span>
                    <span className="text-xs text-ink-soft">{DRAFT_KIND[template.kind]}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1 text-xs font-semibold">
                    <button type="button" onClick={() => setViewing(template)} className="text-ink underline-offset-4 hover:underline">عرض</button>
                    {editor && <button type="button" onClick={() => setEditing(template)} className="text-stamp-blue underline-offset-4 hover:underline">نسخة للمكتب</button>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
      <TemplateForm template={editing} onClose={() => setEditing(null)} />
      <Modal open={viewing !== null} onClose={() => setViewing(null)} title={viewing?.title ?? ''} wide>
        <pre className="max-h-[60vh] overflow-auto font-doc text-base leading-loose whitespace-pre-wrap text-ink" data-no-translate>{viewing?.body}</pre>
      </Modal>
    </>
  )
}

/* ───────────────────────── letterhead ───────────────────────── */

const LETTERHEAD_FIELDS: [keyof Letterhead['saved'], string, string][] = [
  ['display_name', 'اسم المكتب كما يُطبع', 'يُستعمل اسم المكتب المسجّل إن تُرك فارغاً'],
  ['subtitle', 'سطر تحت الاسم', 'مثلاً: محامون ومستشارون قانونيون'],
  ['address', 'العنوان', 'يُستعمل عنوان المكتب المسجّل إن تُرك فارغاً'],
  ['phone', 'الهاتف', 'يُستعمل هاتف المكتب المسجّل إن تُرك فارغاً'],
  ['email', 'البريد الإلكتروني', 'يُستعمل بريد المكتب المسجّل إن تُرك فارغاً'],
  ['license_number', 'رقم الترخيص', ''],
  ['footer_text', 'تذييل الصفحة', 'سطر صغير في أسفل كل ورقة'],
]

export const LetterheadSettings = () => {
  const letterhead = useLetterhead()
  const save = useSaveLetterhead()
  const logo = useLetterheadLogo()
  const [values, setValues] = useState<Letterhead['saved'] | null>(null)
  useEffect(() => {
    if (letterhead.data && values === null) setValues(letterhead.data.saved)
  }, [letterhead.data, values])
  if (letterhead.isPending || values === null) return <Loading />
  if (letterhead.isError) return <Failed error={letterhead.error} />
  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value?.trim() || null])))
  }
  return (
    <>
      <SheetHeader title="ترويسة الطباعة" note="ما يظهر في أعلى كل ورقة يطبعها المكتب وأسفلها" />
      <div className="grid gap-8 lg:grid-cols-2">
        <form onSubmit={submit} className="space-y-4">
          {LETTERHEAD_FIELDS.map(([field, label, hint]) => (
            <Field key={field} label={label} name={`letterhead_${field}`} hint={hint || undefined} value={values[field] ?? ''} onChange={(event) => setValues({ ...values, [field]: event.target.value })} />
          ))}
          <div>
            <label htmlFor="letterhead-logo" className="block text-xs font-semibold text-ink-soft">الشعار (PNG أو JPG حتى 1 ميغابايت)</label>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <input
                id="letterhead-logo"
                type="file"
                accept="image/png,image/jpeg"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) logo.mutate(file)
                }}
                className="block text-sm text-ink file:me-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-2 file:text-sm file:font-semibold file:text-paper"
              />
              {letterhead.data.has_logo && <Button variant="ghost" size="sm" onClick={() => logo.mutate(null)}>أزل الشعار</Button>}
              {logo.isPending && <span className="text-xs text-ink-soft"><Upload className="inline size-3.5" aria-hidden="true" /> يُرفع…</span>}
            </div>
            {logo.isError && <p role="alert" className="mt-1 text-sm text-stamp">{messageOf(logo.error)}</p>}
          </div>
          <FormActions error={save.isError ? messageOf(save.error) : null}>
            {save.isSuccess && <span role="status" className="text-sm text-stamp-green">حُفظت الترويسة.</span>}
            <Button type="submit" variant="ink" disabled={save.isPending}>{save.isPending ? 'يُحفظ…' : 'احفظ'}</Button>
          </FormActions>
        </form>
        <div>
          <p className="mb-2 text-xs font-semibold text-ink-soft">معاينة</p>
          <PrintSheet kind="other" title="عنوان المستند" subtitle="سطر توضيحي" code="ABCD2345EF">
            <p className="font-doc text-lg leading-loose text-ink">هنا نص المستند. المبالغ تُكتب بالأرقام وبالحروف:</p>
            <p className="mt-2 font-doc text-ink">1,250.50 JOD — <span data-no-translate>{tafqeet(1250.5, 'JOD')}</span></p>
          </PrintSheet>
        </div>
      </div>
    </>
  )
}

/* ───────────────────────── public verification ───────────────────────── */

export const VerifyDocument = () => {
  const { code = '' } = useParams()
  const result = useQuery({ queryKey: ['verify', code], queryFn: () => fetchVerification(code), retry: false })
  const data = result.data
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-6 px-4 py-12 text-center">
      <Link to={PATHS.home} aria-label="قضيتي"><Logo /></Link>
      <h1 className="text-3xl text-ink">التحقق من مستند</h1>
      <p className="font-mono text-lg tracking-wider text-ink-soft" dir="ltr">{formatCode(code.toUpperCase())}</p>
      {result.isPending ? (
        <Loading />
      ) : result.isError ? (
        <Failed error={new Error(messageOf(result.error))} />
      ) : data?.status === 'valid' ? (
        <section className="w-full rounded-lg border border-stamp-green/40 bg-stamp-green/5 p-6">
          <CheckCircle2 className="mx-auto size-10 text-stamp-green" aria-hidden="true" />
          <p className="mt-2 text-xl font-semibold text-ink">مستند صادر عن المكتب، وساري</p>
          <dl className="mt-4 space-y-1 text-sm text-ink">
            <div><dt className="inline text-ink-soft">المكتب: </dt><dd className="inline font-semibold" data-no-translate>{data.office_name}</dd></div>
            <div><dt className="inline text-ink-soft">النوع: </dt><dd className="inline">{PRINT_KIND[data.kind]}</dd></div>
            <div><dt className="inline text-ink-soft">تاريخ الإصدار: </dt><dd className="inline">{formatDate(data.issued_at)}</dd></div>
          </dl>
          <p className="mt-4 flex items-center justify-center gap-1 text-xs text-ink-soft"><ShieldCheck className="size-3.5" aria-hidden="true" />لا تُعرض هنا محتويات المستند ولا أسماء أطرافه.</p>
        </section>
      ) : data?.status === 'revoked' ? (
        <section className="w-full rounded-lg border border-stamp/40 bg-stamp/5 p-6">
          <ShieldAlert className="mx-auto size-10 text-stamp" aria-hidden="true" />
          <p className="mt-2 text-xl font-semibold text-ink">مستند مسحوب</p>
          <p className="mt-2 text-sm text-ink">صدر عن <span data-no-translate>{data.office_name}</span> في {formatDate(data.issued_at)}، ثم سحبه المكتب في {formatDate(data.revoked_at)}. لا يُعتمد عليه.</p>
        </section>
      ) : (
        <section className="w-full rounded-lg border border-ink/20 p-6">
          <XCircle className="mx-auto size-10 text-ink-soft" aria-hidden="true" />
          <p className="mt-2 text-xl font-semibold text-ink">لم يُعثر على مستند بهذا الرمز</p>
          <p className="mt-2 text-sm text-ink-soft">تأكد من كتابة الرمز كما هو مطبوع. المستند الذي لا يُعثر على رمزه لم يصدر عن مكتب مسجّل في قضيتي.</p>
        </section>
      )}
      <Pill>قضيتي · نظام إدارة مكاتب المحاماة</Pill>
    </main>
  )
}
