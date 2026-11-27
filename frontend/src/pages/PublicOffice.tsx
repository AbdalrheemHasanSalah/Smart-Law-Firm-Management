import { Clock, Mail, MapPin, MessageCircle, Phone, Scale, Send, UserRound } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { messageOf } from '@/lib/api'
import { CASE_TYPE } from '@/lib/labels'
import { logoUrl, usePublishedPage, useSendConsultation, whatsappLink } from '@/lib/publicPage'
import { FormActions, SelectField, TextArea } from '@/ui/forms'
import { Button, Field, Logo } from '@/ui/kit'
import { Loading } from '@/ui/Shell'

/** A visitor's consultation request. The hidden "website" field and the opening time keep bots out. */
const ConsultationForm = ({ slug }: { slug: string }) => {
  const openedAt = useRef(Date.now())
  const send = useSendConsultation(slug)
  const [values, setValues] = useState({ full_name: '', phone: '', email: '', case_type: '', message: '', preferred_time: '', website: '' })
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  if (send.isSuccess) {
    return (
      <div role="status" className="rounded-md border border-stamp-green/40 bg-stamp-green/10 p-5 text-ink">
        <p className="text-lg font-semibold">وصل طلبك</p>
        <p className="mt-1 text-sm text-ink-soft">سيتواصل معك المكتب على الرقم الذي تركته في أقرب وقت.</p>
      </div>
    )
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        send.mutate({
          full_name: values.full_name.trim(),
          phone: values.phone.trim(),
          message: values.message.trim(),
          ...(values.email.trim() ? { email: values.email.trim() } : {}),
          ...(values.case_type ? { case_type: values.case_type } : {}),
          ...(values.preferred_time.trim() ? { preferred_time: values.preferred_time.trim() } : {}),
          website: values.website,
          opened_at: openedAt.current,
        })
      }}
      className="grid gap-4 sm:grid-cols-2"
    >
      <Field label="الاسم" name="full_name" required autoComplete="name" value={values.full_name} onChange={set('full_name')} />
      <Field label="رقم الهاتف" name="phone" type="tel" dir="ltr" required autoComplete="tel" value={values.phone} onChange={set('phone')} />
      <Field label="البريد الإلكتروني (اختياري)" name="email" type="email" dir="ltr" autoComplete="email" value={values.email} onChange={set('email')} />
      <SelectField label="نوع القضية (اختياري)" name="case_type" value={values.case_type} onChange={set('case_type')} options={[['', 'لا أعرف بعد'], ...Object.entries(CASE_TYPE)]} />
      <TextArea label="ما الذي تحتاج المساعدة فيه؟" name="message" required rows={4} className="sm:col-span-2" value={values.message} onChange={set('message')} />
      <Field label="الوقت المناسب للتواصل (اختياري)" name="preferred_time" placeholder="صباحاً، بعد الخامسة…" className="sm:col-span-2" value={values.preferred_time} onChange={set('preferred_time')} />
      {/* Hidden from people (and from screen readers); bots that fill every field give themselves away. */}
      <div aria-hidden="true" className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" value={values.website} onChange={set('website')} />
      </div>
      <div className="sm:col-span-2">
        <p className="text-xs text-ink-faint">يصل طلبك إلى المكتب وحده، ولا يُستعمل لغير التواصل معك بشأنه.</p>
        <FormActions error={send.isError ? messageOf(send.error) : null}>
          <Button type="submit" variant="stamp" disabled={!values.full_name.trim() || !values.phone.trim() || !values.message.trim() || send.isPending}>
            <Send className="size-4" aria-hidden="true" />
            {send.isPending ? 'يُرسل…' : 'أرسل الطلب'}
          </Button>
        </FormActions>
      </div>
    </form>
  )
}

/** An office's public page: who they are, what they do, how to reach them, and a request form. */
export const PublicOffice = () => {
  const { slug = '' } = useParams()
  const page = usePublishedPage(slug)

  if (page.isPending) return <div className="min-h-dvh bg-desk-deep pt-24"><Loading /></div>
  if (page.isError) {
    return (
      <div className="grid min-h-dvh place-items-center bg-desk-deep p-6 text-center">
        <div className="max-w-md rounded-lg bg-paper p-8">
          <p className="text-2xl text-ink">الصفحة غير موجودة</p>
          <p className="mt-2 text-sm text-ink-soft">قد يكون الرابط غير صحيح، أو أن المكتب لم ينشر صفحته بعد.</p>
          <Link to="/" className="mt-4 inline-block text-sm font-semibold text-stamp-blue underline-offset-4 hover:underline">الصفحة الرئيسية</Link>
        </div>
      </div>
    )
  }
  const { office, lawyers } = page.data
  const contact = [
    office.phone && { icon: Phone, label: office.phone, href: `tel:${office.phone.replace(/\s/g, '')}`, ltr: true },
    page.data.whatsapp && { icon: MessageCircle, label: 'واتساب', href: whatsappLink(page.data.whatsapp), ltr: false },
    office.email && { icon: Mail, label: office.email, href: `mailto:${office.email}`, ltr: true },
  ].filter(Boolean) as { icon: typeof Phone; label: string; href: string; ltr: boolean }[]

  return (
    <div className="min-h-dvh bg-desk-deep px-4 py-8 sm:py-12">
      <main className="mx-auto max-w-4xl space-y-5">
        <header className="flex flex-col items-start gap-5 rounded-lg bg-paper p-6 sm:flex-row sm:items-center sm:p-8">
          {page.data.has_logo ? (
            <img src={logoUrl(slug)} alt="" className="size-20 shrink-0 rounded-md border border-ink/10 bg-white object-contain p-1" />
          ) : (
            <span className="grid size-20 shrink-0 place-items-center rounded-md bg-stamp text-paper"><Scale className="size-9" aria-hidden="true" /></span>
          )}
          <div className="min-w-0">
            <h1 className="text-3xl text-ink sm:text-4xl">{office.name}</h1>
            {page.data.tagline && <p className="mt-1 text-lg text-ink-soft">{page.data.tagline}</p>}
            {office.city && <p className="mt-2 inline-flex items-center gap-1 text-sm text-ink-faint"><MapPin className="size-4" aria-hidden="true" />{office.city}</p>}
          </div>
        </header>

        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-5">
            {page.data.about && (
              <section className="rounded-lg bg-paper p-6">
                <h2 className="mb-2 text-xl text-ink">عن المكتب</h2>
                <p className="whitespace-pre-line leading-relaxed text-ink">{page.data.about}</p>
              </section>
            )}
            {page.data.practice_areas.length > 0 && (
              <section className="rounded-lg bg-paper p-6">
                <h2 className="mb-3 text-xl text-ink">مجالات العمل</h2>
                <ul className="flex flex-wrap gap-2">
                  {page.data.practice_areas.map((area) => (
                    <li key={area} className="rounded-full border border-ink/15 bg-paper-shade px-3 py-1 text-sm text-ink">{area}</li>
                  ))}
                </ul>
              </section>
            )}
            {lawyers.length > 0 && (
              <section className="rounded-lg bg-paper p-6">
                <h2 className="mb-3 text-xl text-ink">فريق المكتب</h2>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {lawyers.map((lawyer) => (
                    <li key={lawyer.full_name} className="flex items-center gap-3">
                      <span className="grid size-10 place-items-center rounded-full bg-ink/8 text-ink-soft"><UserRound className="size-5" aria-hidden="true" /></span>
                      <span>
                        <span className="block font-semibold text-ink">{lawyer.full_name}</span>
                        {lawyer.job_title && <span className="block text-xs text-ink-soft">{lawyer.job_title}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section id="request" className="relative rounded-lg border-t-4 border-stamp bg-paper p-6">
              <h2 className="mb-1 text-xl text-ink">اطلب استشارة</h2>
              <p className="mb-4 text-sm text-ink-soft">اترك بياناتك وما تحتاجه، ويتواصل معك المكتب.</p>
              <ConsultationForm slug={slug} />
            </section>
          </div>

          <aside className="space-y-5">
            {contact.length > 0 && (
              <section className="rounded-lg bg-paper p-5">
                <h2 className="mb-3 text-lg text-ink">التواصل</h2>
                <ul className="space-y-2">
                  {contact.map(({ icon: Icon, label, href, ltr }) => (
                    <li key={href}>
                      <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-stamp-blue underline-offset-4 hover:underline">
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        <span dir={ltr ? 'ltr' : undefined}>{label}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {(office.address || page.data.map_url) && (
              <section className="rounded-lg bg-paper p-5">
                <h2 className="mb-2 text-lg text-ink">العنوان</h2>
                {office.address && <p className="text-sm text-ink">{office.address}</p>}
                {page.data.map_url && (
                  <a href={page.data.map_url} target="_blank" rel="noreferrer noopener" className="mt-2 inline-flex items-center gap-1 text-sm text-stamp-blue underline-offset-4 hover:underline">
                    <MapPin className="size-4" aria-hidden="true" />
                    افتح على الخريطة
                  </a>
                )}
              </section>
            )}
            {page.data.working_hours && (
              <section className="rounded-lg bg-paper p-5">
                <h2 className="mb-2 inline-flex items-center gap-1 text-lg text-ink"><Clock className="size-4" aria-hidden="true" />ساعات العمل</h2>
                <p className="whitespace-pre-line text-sm text-ink">{page.data.working_hours}</p>
              </section>
            )}
          </aside>
        </div>

        <footer className="flex items-center justify-center gap-2 pt-4 text-xs text-paper/60">
          <span>صفحة المكتب على</span>
          <Link to="/" aria-label="قضيتي"><Logo onDesk className="scale-75" /></Link>
        </footer>
      </main>
    </div>
  )
}
