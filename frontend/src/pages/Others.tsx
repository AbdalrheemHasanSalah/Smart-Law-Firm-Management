import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { api } from '@/lib/api'
import { CASE_STATUS, CASE_TYPE, formatDate } from '@/lib/labels'
import type { CaseNote, LegalCase } from '@/lib/types'
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
      <MyPowers />
    </>
  )
}
