import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { CalendarClock, Download, FileText } from 'lucide-react'
import { api, DEMO } from '@/lib/api'
import { daysUntil, documentDownloadUrl, useMyHearings, useSharedDocuments, type UpcomingHearing } from '@/lib/portal'
import { CASE_STATUS, CASE_TYPE, formatDate, formatDay, formatTime } from '@/lib/labels'
import type { CaseNote, DocumentRecord, LegalCase } from '@/lib/types'
import { cn, Stamp } from '@/ui/kit'
import { Empty, Failed, Loading, SheetHeader } from '@/ui/Shell'
import { MyPowers } from './PowersOfAttorney'

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

const whenText = (at: string) => {
  const days = daysUntil(at)
  if (days === 0) return 'اليوم'
  if (days === 1) return 'غداً'
  if (days === 2) return 'بعد يومين'
  return days <= 10 ? `بعد ${days} أيام` : `بعد ${days} يوماً`
}

/** The next hearings of the client's cases: when, what kind, and where. */
const UpcomingHearings = ({ hearings }: { hearings: UpcomingHearing[] }) => (
  <section className="mb-8 rounded-md border-t-4 border-stamp bg-paper p-5">
    <h2 className="mb-3 inline-flex items-center gap-2 text-xl text-ink"><CalendarClock className="size-5 text-stamp" aria-hidden="true" />جلساتك القادمة</h2>
    <ul className="divide-y divide-rule">
      {hearings.slice(0, 5).map((hearing) => (
        <li key={hearing.hearing_id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
          <span>
            <span className="font-semibold text-ink">جلسة {hearing.hearing_type}</span>
            <span className="text-sm text-ink-soft"> · قضية <bdi dir="ltr">{hearing.case_number}</bdi></span>
            {(hearing.court_name || hearing.court_room) && (
              <span className="block text-xs text-ink-faint">{[hearing.court_name && `محكمة ${hearing.court_name}`, hearing.court_room && `قاعة ${hearing.court_room}`].filter(Boolean).join(' · ')}</span>
            )}
          </span>
          <span className="text-sm text-ink">
            <bdi>{formatDay(hearing.hearing_at)} {formatTime(hearing.hearing_at)}</bdi>
            <span className="ms-2 rounded-full bg-stamp/10 px-2 py-0.5 text-xs font-semibold text-stamp">{whenText(hearing.hearing_at)}</span>
          </span>
        </li>
      ))}
    </ul>
  </section>
)

/** Documents the office shared with the client in one case. */
const SharedDocuments = ({ documents }: { documents: DocumentRecord[] }) => (
  <div className="mt-4">
    <p className="mb-2 text-xs font-semibold text-ink/70">مستندات شاركها مكتبك معك</p>
    <ul className="space-y-1.5">
      {documents.map((document) => (
        <li key={document.document_id} className="flex items-center justify-between gap-3 text-sm">
          <span className="inline-flex min-w-0 items-center gap-2 text-ink">
            <FileText className="size-4 shrink-0 text-ink-soft" aria-hidden="true" />
            <span className="truncate">{document.document_type}</span>
            <span className="shrink-0 text-xs text-ink-faint">{formatDate(document.document_date ?? document.created_at)}</span>
          </span>
          {DEMO ? (
            <span className="text-xs text-ink-faint">تجريبي</span>
          ) : (
            <a href={documentDownloadUrl(document.document_id)} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-stamp-blue underline-offset-4 hover:underline">
              <Download className="size-4" aria-hidden="true" />
              تنزيل
            </a>
          )}
        </li>
      ))}
    </ul>
  </div>
)

/** The client's own cases, each as an open file with the lawyer's latest note on top. */
export const Portal = () => {
  const cases = useQuery({
    queryKey: ['cases', ''],
    queryFn: async () => (await api.get<{ cases: LegalCase[] }>('/cases', { params: { pageSize: 50 } })).data.cases,
  })
  const hearings = useMyHearings()
  const documents = useSharedDocuments()
  const nextHearing = (caseId: string) => hearings.data?.find((hearing) => hearing.case_id === caseId)
  // A notification about one case links to "#case-<id>": scroll to that case once the list is in.
  const { hash } = useLocation()
  const target = hash.startsWith('#case-') ? hash.slice('#case-'.length) : null
  useEffect(() => {
    if (!target || !cases.data) return
    document.getElementById(`case-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [target, cases.data])
  return (
    <>
      <SheetHeader title="قضاياي" note="ما يشاركه مكتبك معك يظهر هنا." />
      {hearings.data && hearings.data.length > 0 && <UpcomingHearings hearings={hearings.data} />}
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
              id={`case-${row.case_id}`}
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 100, damping: 15, delay: index * 0.1 }}
              className={cn('relative scroll-mt-24 pt-7', target === row.case_id && 'rounded-md ring-2 ring-stamp/60 ring-offset-4 ring-offset-paper')}
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
                  {nextHearing(row.case_id) && (
                    <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-stamp/8 px-2.5 py-1 text-sm text-ink">
                      <CalendarClock className="size-4 text-stamp" aria-hidden="true" />
                      الجلسة القادمة: <bdi>{formatDay(nextHearing(row.case_id)!.hearing_at)} {formatTime(nextHearing(row.case_id)!.hearing_at)}</bdi>
                    </p>
                  )}
                  {(documents.data ?? []).some((document) => document.case_id === row.case_id) && (
                    <SharedDocuments documents={(documents.data ?? []).filter((document) => document.case_id === row.case_id)} />
                  )}
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
      <MyPowers />
    </>
  )
}
