import { useQuery } from '@tanstack/react-query'
import { Copy, ExternalLink, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { personaOf, useAuth } from '@/auth/auth'
import { api, messageOf } from '@/lib/api'
import { CASE_TYPE, formatDate } from '@/lib/labels'
import {
  CONSULTATION_STATUS,
  pagePath,
  suggestSlug,
  useConsultations,
  useConvertConsultation,
  usePageSettings,
  useSavePageSettings,
  useUpdateConsultation,
  type Consultation,
  type ConsultationStatus,
} from '@/lib/publicPage'
import type { Client, Member } from '@/lib/types'
import { FormActions, Modal, SelectField, TextArea } from '@/ui/forms'
import { Button, cn, Field } from '@/ui/kit'
import { Empty, Failed, Loading, Pill, SheetHeader } from '@/ui/Shell'
import { NewCase } from './Workspace'

const LINK = 'text-xs font-semibold underline-offset-4 hover:underline disabled:opacity-50'

/* ───────────────────────── page settings ───────────────────────── */

/** The administrator writes the office's public page and publishes it. */
export const PublicPageSettings = () => {
  const settings = usePageSettings()
  const save = useSavePageSettings()
  const session = useAuth().session
  const [values, setValues] = useState({ slug: '', is_published: false, tagline: '', about: '', areas: '', whatsapp: '', working_hours: '', map_url: '' })
  const [logo, setLogo] = useState<File | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!settings.isSuccess) return
    const page = settings.data
    setValues(page
      ? {
          slug: page.slug, is_published: page.is_published, tagline: page.tagline ?? '', about: page.about ?? '',
          areas: page.practice_areas.join('، '), whatsapp: page.whatsapp ?? '', working_hours: page.working_hours ?? '', map_url: page.map_url ?? '',
        }
      : { slug: suggestSlug(session?.active_office?.office_name ?? ''), is_published: false, tagline: '', about: '', areas: '', whatsapp: '', working_hours: '', map_url: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.isSuccess])

  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const link = `${location.origin}${pagePath(values.slug)}`
  const slugOk = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(values.slug) && values.slug.length >= 3

  if (settings.isPending) return <Loading />
  if (settings.isError) return <Failed error={settings.error} />
  const saved = settings.data

  return (
    <>
      <SheetHeader title="صفحة المكتب العامة" note="صفحة يراها أي زائر دون تسجيل دخول، فيها تعريف المكتب وطرق التواصل، ونموذج يصل منه طلب الاستشارة إلى المكتب." />
      {saved?.is_published && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-stamp-green/40 bg-stamp-green/10 px-4 py-3 text-sm">
          <span className="font-semibold text-ink">الصفحة منشورة:</span>
          <bdi dir="ltr" className="text-ink">{`${location.origin}${pagePath(saved.slug)}`}</bdi>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(`${location.origin}${pagePath(saved.slug)}`).then(() => setCopied(true))
            }}
            className={cn(LINK, 'inline-flex items-center gap-1 text-stamp-blue')}
          >
            <Copy className="size-3.5" aria-hidden="true" />
            {copied ? 'نُسخ' : 'انسخ الرابط'}
          </button>
          <Link to={pagePath(saved.slug)} target="_blank" className={cn(LINK, 'inline-flex items-center gap-1 text-stamp-blue')}>
            <ExternalLink className="size-3.5" aria-hidden="true" />
            افتح الصفحة
          </Link>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setNotice(null)
          if (logo && (!['image/png', 'image/jpeg'].includes(logo.type) || logo.size > 2 * 1024 * 1024)) {
            setNotice('الشعار يجب أن يكون صورة PNG أو JPG حتى 2 ميغابايت.')
            return
          }
          save.mutate(
            {
              settings: {
                slug: values.slug.trim(), is_published: values.is_published, tagline: values.tagline.trim() || null, about: values.about.trim() || null,
                practice_areas: values.areas.split(/[،,\n]/).map((area) => area.trim()).filter(Boolean),
                whatsapp: values.whatsapp.trim() || null, working_hours: values.working_hours.trim() || null, map_url: values.map_url.trim() || null,
              },
              logo: logo ? { file: logo, type: logo.type } : null,
            },
            {
              onSuccess: ({ logoError }) => {
                setLogo(null)
                setNotice(logoError ? `حُفظت الصفحة، لكن تعذّر رفع الشعار: ${messageOf(logoError)}` : 'حُفظت الصفحة.')
              },
            },
          )
        }}
        className="grid max-w-3xl gap-4 sm:grid-cols-2"
      >
        <Field
          label="رابط الصفحة"
          name="slug"
          dir="ltr"
          required
          className="sm:col-span-2"
          hint={slugOk ? link : 'حروف لاتينية صغيرة وأرقام وشَرطات، من 3 أحرف على الأقل.'}
          error={values.slug && !slugOk ? 'رابط غير صالح' : undefined}
          value={values.slug}
          onChange={(event) => setValues((current) => ({ ...current, slug: event.target.value.toLowerCase() }))}
        />
        <Field label="عبارة تعريفية" name="tagline" placeholder="محاماة واستشارات قانونية منذ 2010" className="sm:col-span-2" value={values.tagline} onChange={set('tagline')} />
        <TextArea label="عن المكتب" name="about" rows={5} className="sm:col-span-2" value={values.about} onChange={set('about')} />
        <Field label="مجالات العمل" name="areas" placeholder="مدني، تجاري، أحوال شخصية…" hint="افصل بينها بفاصلة." className="sm:col-span-2" value={values.areas} onChange={set('areas')} />
        <Field label="واتساب (اختياري)" name="whatsapp" dir="ltr" placeholder="+970 599 000 000" value={values.whatsapp} onChange={set('whatsapp')} />
        <Field label="رابط الخريطة (اختياري)" name="map_url" dir="ltr" placeholder="https://maps.google.com/…" value={values.map_url} onChange={set('map_url')} />
        <TextArea label="ساعات العمل (اختياري)" name="working_hours" rows={2} placeholder="السبت–الخميس، 8:00–16:00" className="sm:col-span-2" value={values.working_hours} onChange={set('working_hours')} />
        <div className="sm:col-span-2">
          <label htmlFor="office-logo" className="block text-xs font-semibold text-ink-soft">
            {saved?.has_logo ? 'استبدال الشعار' : 'الشعار'} (PNG أو JPG، حتى 2 ميغابايت، اختياري)
          </label>
          <input id="office-logo" type="file" accept="image/png,image/jpeg" onChange={(event) => setLogo(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm text-ink file:me-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-2 file:text-sm file:font-semibold file:text-paper" />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink sm:col-span-2">
          <input type="checkbox" checked={values.is_published} onChange={(event) => setValues((current) => ({ ...current, is_published: event.target.checked }))} className="size-4 accent-stamp" />
          انشر الصفحة ليراها الزوار
        </label>
        <p className="text-xs text-ink-faint sm:col-span-2">
          تظهر في الصفحة بيانات المكتب المسجّلة (الاسم والهاتف والبريد والمدينة والعنوان). المحامون يظهرون فيها فقط إن فعّلت ذلك في سجلّ كل منهم من صفحة الفريق.
        </p>
        <div className="sm:col-span-2">
          <FormActions error={save.isError ? messageOf(save.error) : notice && notice !== 'حُفظت الصفحة.' ? notice : null}>
            {notice === 'حُفظت الصفحة.' && <span role="status" className="self-center text-sm text-stamp-green">{notice}</span>}
            <Button type="submit" variant="ink" disabled={!slugOk || save.isPending}>{save.isPending ? 'يُحفظ…' : 'احفظ'}</Button>
          </FormActions>
        </div>
      </form>
    </>
  )
}

/* ───────────────────────── consultation requests ───────────────────────── */

const ConvertRequest = ({ request, onClose, onConverted }: { request: Consultation | null; onClose: () => void; onConverted: (client: Pick<Client, 'client_id' | 'full_name_or_org'>) => void }) => {
  const convert = useConvertConsultation()
  const [type, setType] = useState<'individual' | 'organization'>('individual')
  useEffect(() => {
    if (request) {
      convert.reset()
      setType('individual')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.request_id])
  return (
    <Modal open={request !== null} onClose={onClose} title="تحويله إلى موكّل">
      {request && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            convert.mutate({ requestId: request.request_id, clientType: type }, { onSuccess: onConverted })
          }}
          className="space-y-4"
        >
          <p className="text-sm text-ink">يُضاف <span className="font-semibold">{request.full_name}</span> إلى الموكّلين بالهاتف{request.email ? ' والبريد' : ''} اللذين تركهما، ثم يمكنك فتح قضية له.</p>
          <SelectField label="نوع الموكّل" name="client_type" value={type} onChange={(event) => setType(event.target.value as 'individual' | 'organization')} options={[['individual', 'فرد'], ['organization', 'شركة أو جهة']]} />
          <FormActions error={convert.isError ? messageOf(convert.error) : null}>
            <Button variant="line" onClick={onClose}>إلغاء</Button>
            <Button type="submit" variant="ink" disabled={convert.isPending}>{convert.isPending ? 'يُحوَّل…' : 'أضفه موكّلاً'}</Button>
          </FormActions>
        </form>
      )}
    </Modal>
  )
}

const RequestCard = ({ request, owner, staff, onConvert }: { request: Consultation; owner: boolean; staff: Member[]; onConvert: (request: Consultation) => void }) => {
  const update = useUpdateConsultation()
  const [notes, setNotes] = useState(request.notes ?? '')
  const label = CONSULTATION_STATUS[request.status]
  const closed = request.status === 'converted'
  return (
    <li className="rounded-md border border-ink/15 bg-paper/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-ink">{request.full_name}</p>
          <p className="text-sm text-ink-soft">
            <a href={`tel:${request.phone.replace(/\s/g, '')}`} className="text-stamp-blue underline-offset-4 hover:underline" dir="ltr">{request.phone}</a>
            {request.email && <> · <a href={`mailto:${request.email}`} className="text-stamp-blue underline-offset-4 hover:underline" dir="ltr">{request.email}</a></>}
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {formatDate(request.created_at)}
            {request.case_type && ` · ${CASE_TYPE[request.case_type] ?? request.case_type}`}
            {request.preferred_time && ` · يفضّل: ${request.preferred_time}`}
          </p>
        </div>
        <Pill tone={label.tone}>{label.text}</Pill>
      </div>
      <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink">{request.message}</p>
      {closed ? (
        <p className="mt-3 text-sm text-stamp-green">أصبح موكّلاً: {request.client_name}</p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <SelectField
            label="الحالة"
            name={`status-${request.request_id}`}
            value={request.status}
            disabled={update.isPending}
            onChange={(event) => update.mutate({ requestId: request.request_id, patch: { status: event.target.value as 'new' | 'contacted' | 'rejected' } })}
            options={[['new', 'جديد'], ['contacted', 'تواصلنا معه'], ['rejected', 'مُستبعَد']]}
          />
          {owner ? (
            <SelectField
              label="مسند إلى"
              name={`assignee-${request.request_id}`}
              value={request.assigned_to_user_id ?? ''}
              disabled={update.isPending}
              onChange={(event) => update.mutate({ requestId: request.request_id, patch: { assigned_to_user_id: event.target.value || null } })}
              options={[['', 'لا أحد'], ...staff.map((member) => [member.user_id, member.full_name] as const)]}
            />
          ) : (
            <p className="self-end text-xs text-ink-faint">مسند إليك</p>
          )}
          <TextArea label="ملاحظات داخلية" name={`notes-${request.request_id}`} rows={2} className="sm:col-span-2" value={notes} onChange={(event) => setNotes(event.target.value)} />
          <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
            <button type="button" disabled={update.isPending || notes === (request.notes ?? '')} onClick={() => update.mutate({ requestId: request.request_id, patch: { notes: notes.trim() || null } })} className={cn(LINK, 'text-stamp-blue')}>
              احفظ الملاحظات
            </button>
            {owner && (
              <Button variant="ink" size="sm" onClick={() => onConvert(request)}>
                <UserPlus className="size-4" aria-hidden="true" />
                تحويله إلى موكّل
              </Button>
            )}
          </div>
          {update.isError && <p role="alert" className="text-sm text-stamp sm:col-span-2">{messageOf(update.error)}</p>}
        </div>
      )}
    </li>
  )
}

/** The office's consultation requests: all of them for the administrator, the assigned ones otherwise. */
export const Consultations = () => {
  const owner = personaOf(useAuth().session) === 'owner'
  const [status, setStatus] = useState<ConsultationStatus | ''>('')
  const requests = useConsultations(status || undefined)
  const staff = useQuery({
    queryKey: ['members'],
    enabled: owner,
    queryFn: async () => (await api.get<{ users: Member[] }>('/users', { params: { pageSize: 50 } })).data.users,
    select: (members) => members.filter((member) => member.role !== 'client' && member.status === 'active'),
  })
  const [converting, setConverting] = useState<Consultation | null>(null)
  const [newCaseFor, setNewCaseFor] = useState<Client | null>(null)
  const fresh = (requests.data ?? []).filter((request) => request.status === 'new').length

  return (
    <>
      <SheetHeader
        title="طلبات الاستشارة"
        note={owner ? 'ما يصل من نموذج صفحة المكتب العامة. أسند الطلب إلى محامٍ، وحوّله إلى موكّل حين يصبح كذلك.' : 'طلبات الاستشارة التي أسندها إليك مدير المكتب.'}
        action={owner ? <Link to="/office/public-page" className={cn(LINK, 'text-stamp-blue')}>إعدادات الصفحة العامة</Link> : undefined}
      />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <SelectField label="الحالة" name="request_status" className="w-48" value={status} onChange={(event) => setStatus(event.target.value as ConsultationStatus | '')} options={[['', 'كل الطلبات'], ...Object.entries(CONSULTATION_STATUS).map(([key, label]) => [key, label.text] as const)]} />
        {fresh > 0 && <p className="text-sm font-semibold text-stamp">{fresh === 1 ? 'طلب جديد واحد.' : `${fresh} طلبات جديدة.`}</p>}
      </div>
      {requests.isPending ? <Loading /> : requests.isError ? <Failed error={requests.error} /> : requests.data.length === 0 ? (
        <Empty>{owner ? 'لا طلبات بعد. انشر صفحة المكتب العامة وشارك رابطها ليصلك منها طلبات.' : 'لا طلبات مسندة إليك.'}</Empty>
      ) : (
        <ul className="space-y-3">
          {requests.data.map((request) => (
            <RequestCard key={`${request.request_id}-${request.status}-${request.assigned_to_user_id}`} request={request} owner={owner} staff={staff.data ?? []} onConvert={setConverting} />
          ))}
        </ul>
      )}
      <ConvertRequest
        request={converting}
        onClose={() => setConverting(null)}
        onConverted={(client) => {
          setConverting(null)
          setNewCaseFor({ client_id: client.client_id, full_name_or_org: client.full_name_or_org } as Client)
        }}
      />
      {owner && <NewCase open={newCaseFor !== null} client={newCaseFor} onClose={() => setNewCaseFor(null)} />}
    </>
  )
}
