import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { api, messageOf } from '@/lib/api'
import { CASE_STATUS, CASE_TYPE, formatDate, OFFICE_STATUS } from '@/lib/labels'
import type { CaseNote, LegalCase, PlatformOffice } from '@/lib/types'
import { Button, cn, PaperClip, Stamp } from '@/ui/kit'
import { Empty, Failed, Loading, SheetHeader } from '@/ui/Shell'

/* ───────────────────────── platform admin: office requests ───────────────────────── */

const Line = ({ label, value }: { label: string; value: string | null }) => (
  <p className="flex gap-2 border-b border-dotted border-ink/25 py-1.5 text-sm">
    <span className="shrink-0 text-ink-faint">{label}</span>
    <bdi className="font-semibold text-ink">{value ?? '—'}</bdi>
  </p>
)

/** One registration form. Approving or rejecting brings the stamp down on it. */
const OfficeForm = ({ office, index }: { office: PlatformOffice; index: number }) => {
  const queryClient = useQueryClient()
  const review = useMutation({
    mutationFn: (status: 'active' | 'rejected' | 'suspended') => api.patch(`/platform/offices/${office.office_id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform-offices'] }),
  })
  const status = OFFICE_STATUS[office.status]!
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 100, damping: 14, delay: index * 0.08 }}
      className="relative border border-ink/15 bg-paper-shade p-5 shadow-paper"
    >
      {office.status === 'pending' && <PaperClip className="absolute -top-4 left-6 h-12" />}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-ink-faint">طلب بتاريخ {formatDate(office.created_at)}</p>
          <h2 className="mt-0.5 text-2xl text-ink">{office.name}</h2>
        </div>
        <Stamp key={office.status} slam="mount" tone={status.tone} className="shrink-0 text-lg">
          {status.text}
        </Stamp>
      </div>
      <div className="mt-3 grid gap-x-8 sm:grid-cols-2">
        <Line label="صاحب المكتب:" value={office.owner_name} />
        <Line label="رقم النقابة:" value={office.owner_bar_number} />
        <Line label="المدينة:" value={office.city} />
        <Line label="الهاتف:" value={office.phone} />
        <Line label="البريد:" value={office.owner_email} />
        <Line label="رقم الترخيص:" value={office.license_number} />
      </div>
      {office.review_note && <p className="mt-3 text-sm text-ink-soft">ملاحظة المراجعة: {office.review_note}</p>}
      {review.isError && <p role="alert" className="mt-3 text-sm text-stamp">{messageOf(review.error)}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {office.status !== 'active' && (
          <Button variant="ink" size="sm" disabled={review.isPending} onClick={() => review.mutate('active')}>
            {office.status === 'pending' ? 'اعتمد المكتب' : 'أعد التفعيل'}
          </Button>
        )}
        {office.status === 'pending' && (
          <Button variant="line" size="sm" disabled={review.isPending} onClick={() => review.mutate('rejected')}>
            ارفض الطلب
          </Button>
        )}
        {office.status === 'active' && (
          <Button variant="line" size="sm" disabled={review.isPending} onClick={() => review.mutate('suspended')}>
            أوقف المكتب
          </Button>
        )}
      </div>
    </motion.li>
  )
}

export const Platform = () => {
  const offices = useQuery({
    queryKey: ['platform-offices'],
    queryFn: async () => (await api.get<{ offices: PlatformOffice[] }>('/platform/offices')).data.offices,
  })
  const pending = offices.data?.filter((office) => office.status === 'pending').length ?? 0
  const sorted = [...(offices.data ?? [])].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'))
  return (
    <>
      <SheetHeader title="طلبات المكاتب" note={offices.data ? `${pending} طلب بانتظار قرارك من أصل ${offices.data.length} مكتب` : undefined} />
      {offices.isPending ? (
        <Loading />
      ) : offices.isError ? (
        <Failed error={offices.error} />
      ) : sorted.length === 0 ? (
        <Empty>لا طلبات بعد.</Empty>
      ) : (
        <ul className="grid gap-6 lg:grid-cols-2">
          {sorted.map((office, index) => (
            <OfficeForm key={office.office_id} office={office} index={index} />
          ))}
        </ul>
      )}
    </>
  )
}

/* ───────────────────────── client portal ───────────────────────── */

const LatestUpdate = ({ caseId }: { caseId: string }) => {
  const notes = useQuery({
    queryKey: ['notes', caseId],
    queryFn: async () => (await api.get<{ notes: CaseNote[] }>(`/cases/${caseId}/notes`, { params: { pageSize: 50 } })).data.notes,
  })
  const latest = notes.data?.[0]
  if (!latest) return <p className="text-sm text-ink-faint">{notes.isPending ? '…' : 'لم يكتب محاميك تحديثاً بعد.'}</p>
  return (
    <div className="border-s-4 border-stamp bg-paper p-3">
      <p className="text-sm leading-relaxed text-ink">{latest.body}</p>
      <p className="mt-1 text-xs text-ink-soft">{formatDate(latest.created_at)}</p>
    </div>
  )
}

/** The client's own cases, each as an open file with the lawyer's latest note on top. */
export const Portal = () => {
  const cases = useQuery({
    queryKey: ['cases', ''],
    queryFn: async () => (await api.get<{ cases: LegalCase[] }>('/cases', { params: { pageSize: 50 } })).data.cases,
  })
  return (
    <>
      <SheetHeader title="قضاياي" note="ما يشاركه مكتبك معك يظهر هنا." />
      {cases.isPending ? (
        <Loading />
      ) : cases.isError ? (
        <Failed error={cases.error} />
      ) : cases.data.length === 0 ? (
        <Empty>لا قضايا مرتبطة بحسابك بعد.</Empty>
      ) : (
        <ul className="space-y-8">
          {cases.data.map((row, index) => (
            <motion.li
              key={row.case_id}
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 100, damping: 15, delay: index * 0.1 }}
              className="relative pt-7"
            >
              <span className={cn('tab-cut absolute top-0 right-6 flex h-8 w-36 items-center justify-center rounded-t-md bg-stamp-green text-sm font-semibold text-paper')} dir="ltr">
                {row.case_number}
              </span>
              <div className="manila grid gap-5 rounded-md p-5 md:grid-cols-[minmax(0,1fr)_17rem]">
                <div className="paper p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-2xl text-ink">{row.title}</h2>
                    <Stamp slam="mount" delay={0.4 + index * 0.1} tone={CASE_STATUS[row.status]?.tone} className="shrink-0 text-base">
                      {CASE_STATUS[row.status]?.text}
                    </Stamp>
                  </div>
                  <p className="mt-1 text-sm text-ink-faint">
                    {CASE_TYPE[row.case_type] ?? row.case_type} · فُتحت {formatDate(row.opened_at)}
                  </p>
                  {row.description && <p className="mt-3 leading-relaxed text-ink-soft">{row.description}</p>}
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold text-ink/70">آخر تحديث من محاميك</p>
                  <LatestUpdate caseId={row.case_id} />
                </div>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </>
  )
}
