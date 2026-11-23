import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BadgeCheck, Building2, ChevronLeft, Mail, MapPin, Phone, Search, ScrollText, UserRound, X, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { PATHS } from '@/auth/auth'
import { api, messageOf } from '@/lib/api'
import { useParam } from '@/lib/useParam'
import { formatDate, OFFICE_STATUS } from '@/lib/labels'
import type { OfficeStatus, PlatformOffice } from '@/lib/types'
import { TextArea } from '@/ui/forms'
import { timeAgo } from '@/ui/Inbox'
import { Button, cn } from '@/ui/kit'
import { Empty, Failed, Loading, Pill, SheetHeader } from '@/ui/Shell'
import { normalizeName } from './Messages'

type Tab = 'pending' | 'active' | 'closed' | 'all'
const TABS: [Tab, string][] = [
  ['pending', 'طلبات جديدة'],
  ['active', 'معتمدة'],
  ['closed', 'مرفوضة وموقوفة'],
  ['all', 'الكل'],
]
const inTab = (tab: Tab, status: OfficeStatus) =>
  tab === 'all' || (tab === 'closed' ? status === 'rejected' || status === 'suspended' : status === tab)

/* ───────────────────────── details ───────────────────────── */

const Detail = ({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) => (
  <div className="flex items-start gap-3 py-3">
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-paper-shade text-ink-soft">
      <Icon className="size-4" aria-hidden="true" />
    </span>
    <div className="min-w-0">
      <p className="text-xs text-ink-faint">{label}</p>
      <div className="mt-0.5 font-semibold break-words text-ink">{children ?? <span className="font-normal text-ink-faint">غير مذكور</span>}</div>
    </div>
  </div>
)

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="rounded-xl border border-ink/10 px-4">
    <h3 className="border-b border-ink/8 py-3 text-lg text-ink">{title}</h3>
    <div className="divide-y divide-ink/8">{children}</div>
  </section>
)

type Decision = 'active' | 'rejected' | 'suspended'

/** The decision buttons. Rejecting or suspending asks for a note and a second click. */
const Decide = ({ office }: { office: PlatformOffice }) => {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<Exclude<Decision, 'active'> | null>(null)
  const [note, setNote] = useState('')
  useEffect(() => {
    setConfirming(null)
    setNote('')
  }, [office.office_id])
  const review = useMutation({
    mutationFn: (status: Decision) => api.patch(`/platform/offices/${office.office_id}`, { status, ...(note.trim() ? { review_note: note.trim() } : {}) }),
    onSuccess: () => {
      setConfirming(null)
      setNote('')
      void queryClient.invalidateQueries({ queryKey: ['platform-offices'] })
      void queryClient.invalidateQueries({ queryKey: ['platform-subscriptions'] })
    },
  })

  if (confirming) {
    return (
      <div className="rounded-xl border border-stamp/30 bg-stamp/5 p-4">
        <p className="font-semibold text-ink">{confirming === 'rejected' ? 'رفض طلب هذا المكتب؟' : 'إيقاف هذا المكتب؟'}</p>
        <p className="mt-1 text-sm text-ink-soft">
          {confirming === 'rejected' ? 'يصل صاحب الطلب بريد بأن الطلب لم يُعتمد، ويمكنه التقديم من جديد.' : 'يُمنع كل أعضاء المكتب وموكّليه من الدخول حتى تعيد تفعيله.'}
        </p>
        <TextArea label="السبب (يظهر لإدارة المنصّة فقط، اختياري)" name="review_note" value={note} onChange={(event) => setNote(event.target.value)} className="mt-3" />
        {review.isError && <p role="alert" className="mt-2 text-sm text-stamp">{messageOf(review.error)}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="stamp" disabled={review.isPending} onClick={() => review.mutate(confirming)}>
            {review.isPending ? 'يُحفظ…' : confirming === 'rejected' ? 'نعم، ارفض الطلب' : 'نعم، أوقف المكتب'}
          </Button>
          <Button variant="line" onClick={() => setConfirming(null)}>
            تراجع
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {office.status !== 'active' && (
        <Button variant="ink" size="lg" disabled={review.isPending} onClick={() => review.mutate('active')}>
          <BadgeCheck className="size-5" aria-hidden="true" />
          {review.isPending ? 'يُحفظ…' : office.status === 'pending' ? 'اعتمد المكتب' : 'أعد تفعيل المكتب'}
        </Button>
      )}
      {office.status === 'pending' && (
        <Button variant="line" size="lg" onClick={() => setConfirming('rejected')}>
          ارفض الطلب
        </Button>
      )}
      {office.status === 'active' && (
        <Button variant="line" size="lg" onClick={() => setConfirming('suspended')}>
          أوقف المكتب
        </Button>
      )}
      {review.isError && <p role="alert" className="w-full text-sm text-stamp">{messageOf(review.error)}</p>}
    </div>
  )
}

const useOffices = () =>
  useQuery({
    queryKey: ['platform-offices'],
    queryFn: async () => (await api.get<{ offices: PlatformOffice[] }>('/platform/offices')).data.offices,
  })

export const officeRequestPath = (officeId: string) => `${PATHS.platform}/offices/${encodeURIComponent(officeId)}`

/* ───────────────────────── the list ───────────────────────── */

/** Office requests: one row per office across the page; a name opens that office's own page. */
export const Platform = () => {
  const offices = useOffices()
  const all = offices.data ?? []
  const pendingCount = all.filter((office) => office.status === 'pending').length
  const [tabParam, setTab] = useParam('tab')
  const [filter, setFilter] = useState('')
  // Open on the new requests when there are any.
  const activeTab: Tab = TABS.some(([key]) => key === tabParam) ? (tabParam as Tab) : pendingCount > 0 ? 'pending' : 'all'
  const needle = normalizeName(filter)
  const shown = all
    .filter((office) => inTab(activeTab, office.status))
    .filter((office) => !needle || [office.name, office.owner_name, office.city ?? ''].some((value) => normalizeName(value).includes(needle)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  return (
    <>
      <SheetHeader
        title="طلبات المكاتب"
        note={
          offices.data
            ? pendingCount
              ? `${pendingCount === 1 ? 'طلب جديد واحد' : pendingCount === 2 ? 'طلبان جديدان' : `${pendingCount} طلبات جديدة`} بانتظار قرارك`
              : 'لا طلبات جديدة الآن'
            : undefined
        }
      />
      {offices.isPending ? (
        <Loading />
      ) : offices.isError ? (
        <Failed error={offices.error} />
      ) : all.length === 0 ? (
        <Empty>لم يسجّل أي مكتب بعد.</Empty>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="نوع الطلبات">
              {TABS.map(([key, label]) => {
                const count = all.filter((office) => inTab(key, office.status)).length
                const on = activeTab === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    aria-pressed={on}
                    className={cn('flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors', on ? 'bg-ink text-paper' : 'bg-ink/6 text-ink-soft hover:text-ink')}
                  >
                    {label}
                    <span className={cn('rounded-full px-1.5 text-xs', on ? 'bg-paper/20' : key === 'pending' && count ? 'bg-stamp text-paper' : 'bg-ink/10')}>{count}</span>
                  </button>
                )
              })}
            </div>
            <label className="flex w-full items-center gap-2 rounded-full border border-ink/15 bg-paper-shade px-3 focus-within:border-stamp-blue focus-within:bg-white sm:w-72">
              <Search className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
              <input
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="ابحث باسم المكتب أو المدير أو المدينة"
                aria-label="البحث في المكاتب"
                className="h-10 min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {filter && (
                <button type="button" onClick={() => setFilter('')} aria-label="مسح البحث" className="grid size-6 place-items-center rounded-full text-ink-faint hover:bg-ink/10">
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </label>
          </div>

          {shown.length === 0 ? (
            <Empty>{filter ? 'لا مكتب بهذا الاسم.' : 'لا شيء في هذا التبويب.'}</Empty>
          ) : (
            <ul className="divide-y divide-ink/8 overflow-hidden rounded-xl border border-ink/10" aria-label="المكاتب">
              {shown.map((office, index) => {
                const isNew = office.status === 'pending'
                const status = OFFICE_STATUS[office.status]!
                return (
                  <motion.li key={office.office_id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
                    <Link to={officeRequestPath(office.office_id)} className="group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-paper-shade sm:px-5">
                      <span className={cn('relative grid size-12 shrink-0 place-items-center rounded-xl', isNew ? 'bg-stamp text-paper' : 'bg-ink/8 text-ink-soft')}>
                        <Building2 className="size-5" aria-hidden="true" />
                        {isNew && <span aria-hidden="true" className="absolute -top-1 -left-1 size-3 rounded-full border-2 border-white bg-stamp" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-lg font-semibold text-ink group-hover:text-stamp">{office.name}</span>
                        <span className="mt-0.5 block truncate text-sm text-ink-soft">
                          {office.owner_name}
                          {office.city && ` · ${office.city}`}
                        </span>
                      </span>
                      <span className="hidden shrink-0 text-sm text-ink-faint sm:block">{isNew ? `قدّم الطلب ${timeAgo(office.created_at)}` : formatDate(office.created_at)}</span>
                      <span className="hidden shrink-0 sm:block">
                        <Pill tone={status.tone}>{isNew ? 'طلب جديد' : status.text}</Pill>
                      </span>
                      <ChevronLeft className="size-5 shrink-0 text-ink-faint transition-transform group-hover:-translate-x-1" aria-hidden="true" />
                    </Link>
                  </motion.li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </>
  )
}

/* ───────────────────────── one office ───────────────────────── */

/** The page of one office: everything it registered with, and the decision on it. */
export const OfficeRequest = () => {
  const { officeId = '' } = useParams()
  const offices = useOffices()
  const office = offices.data?.find((entry) => entry.office_id === officeId)

  const back = (
    <Link to={PATHS.platform} className="mb-5 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
      <ArrowRight className="size-4" aria-hidden="true" />
      كل الطلبات
    </Link>
  )
  if (offices.isPending) return <Loading />
  if (offices.isError) return <Failed error={offices.error} />
  if (!office) {
    return (
      <>
        {back}
        <Empty>هذا المكتب غير موجود.</Empty>
      </>
    )
  }
  const status = OFFICE_STATUS[office.status]!
  const isNew = office.status === 'pending'

  return (
    <>
      {back}
      <div className="flex flex-wrap items-start gap-4 border-b border-ink/10 pb-6">
        <span className={cn('grid size-14 shrink-0 place-items-center rounded-2xl', isNew ? 'bg-stamp text-paper' : 'bg-ink/8 text-ink-soft')}>
          <Building2 className="size-7" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl text-ink">{office.name}</h1>
            <Pill tone={status.tone}>{isNew ? 'طلب جديد' : status.text}</Pill>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            {isNew ? 'يطلب الاشتراك في قضيتي' : 'مكتب مسجّل في قضيتي'} · قدّم الطلب في {formatDate(office.created_at)}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Section title="بيانات المكتب">
          <Detail icon={MapPin} label="المدينة والعنوان">
            {office.city}
            {office.address && <span className="block text-sm font-normal text-ink-soft">{office.address}</span>}
          </Detail>
          <Detail icon={Phone} label="هاتف المكتب">
            {office.phone && (
              <a href={`tel:${office.phone.replace(/\s/g, '')}`} dir="ltr" className="hover:text-stamp">
                {office.phone}
              </a>
            )}
          </Detail>
          <Detail icon={Mail} label="بريد المكتب">
            {office.email && (
              <a href={`mailto:${office.email}`} dir="ltr" className="hover:text-stamp">
                {office.email}
              </a>
            )}
          </Detail>
          <Detail icon={ScrollText} label="رقم ترخيص المكتب">
            {office.license_number && <bdi>{office.license_number}</bdi>}
          </Detail>
        </Section>

        <Section title="مدير المكتب (صاحب الطلب)">
          <Detail icon={UserRound} label="الاسم">
            {office.owner_name}
          </Detail>
          <Detail icon={Mail} label="البريد الإلكتروني">
            <a href={`mailto:${office.owner_email}`} dir="ltr" className="hover:text-stamp">
              {office.owner_email}
            </a>
          </Detail>
          <Detail icon={BadgeCheck} label="رقم العضوية في نقابة المحامين">
            {office.owner_bar_number && <bdi>{office.owner_bar_number}</bdi>}
          </Detail>
          <Detail icon={UserRound} label="حالة حسابه">
            {office.owner_account_status === 'active' ? 'فعّال' : 'موقوف'}
          </Detail>
        </Section>
      </div>

      {(office.review_note || office.reviewed_at) && (
        <p className="mt-5 rounded-xl bg-paper-shade px-4 py-3 text-sm text-ink-soft">
          {office.reviewed_at && <>آخر قرار في {formatDate(office.reviewed_at)}. </>}
          {office.review_note && <>ملاحظة: {office.review_note}</>}
        </p>
      )}

      <section className={cn('mt-6 rounded-xl p-5', isNew ? 'border border-stamp/25 bg-stamp/4' : 'border border-ink/10')}>
        <h2 className="text-xl text-ink">القرار</h2>
        <p className="mt-1 mb-4 text-sm text-ink-soft">
          {isNew
            ? 'راجع البيانات ورقم النقابة، ثم اعتمد المكتب أو ارفض الطلب. يصل صاحب الطلب بريد بالقرار.'
            : office.status === 'active'
              ? 'المكتب يعمل الآن. يمكنك إيقافه إن خالف شروط المنصّة.'
              : 'المكتب لا يعمل الآن. يمكنك إعادة تفعيله.'}
        </p>
        <Decide office={office} />
      </section>
    </>
  )
}
