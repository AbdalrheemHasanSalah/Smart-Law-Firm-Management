import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Printer, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { api, messageOf } from '@/lib/api'
import { formatDate, formatTime } from '@/lib/labels'
import type { HearingPrep as Prep, HearingPrepRecord, PrepPoint } from '@/lib/types'
import { TextArea } from './forms'
import { Button, cn, Field, Stamp } from './kit'
import { Empty, Failed, Loading } from './Shell'

const SECTIONS: { key: keyof Pick<Prep, 'key_facts' | 'pending_items' | 'documents_to_bring' | 'questions_for_client' | 'risks' | 'next_steps'>; title: string }[] = [
  { key: 'key_facts', title: 'الوقائع المهمة' },
  { key: 'pending_items', title: 'ما زال معلّقاً' },
  { key: 'documents_to_bring', title: 'المستندات المطلوبة للجلسة' },
  { key: 'questions_for_client', title: 'أسئلة للموكّل' },
  { key: 'risks', title: 'المخاطر ودفوع الخصم المحتملة' },
  { key: 'next_steps', title: 'الخطوات التالية' },
]

const SOURCE_KIND: Record<string, string> = { N: 'ملاحظة', T: 'مهمة', D: 'مستند', H: 'جلسة', C: 'بيانات القضية', P: 'الأطراف', O: 'الخصوم' }

const Point = ({ point, sources }: { point: PrepPoint; sources: Prep['sources'] }) => (
  <li className="py-2">
    <p className="text-sm leading-relaxed text-ink">{point.text}</p>
    <p className="mt-1 flex flex-wrap items-center gap-1.5">
      {point.verified ? (
        point.sources.map((id) => (
          <span key={id} title={sources[id]} className="cursor-help rounded bg-stamp-blue/10 px-1.5 py-0.5 text-[0.7rem] font-semibold text-stamp-blue">
            {SOURCE_KIND[id[0]!] ?? 'بند'} <bdi>{id}</bdi>
          </span>
        ))
      ) : point.reminder ? (
        <span title="تذكير عام من قائمة التحضير، وليس معلومة من ملف القضية." className="cursor-help rounded bg-ink/8 px-1.5 py-0.5 text-[0.7rem] font-semibold text-ink-soft">
          تذكير عام
        </span>
      ) : (
        <span title="لم يستند هذا البند إلى شيء في ملف القضية: هو استنتاج من المساعد يحتاج تحققاً." className="cursor-help rounded bg-stamp/10 px-1.5 py-0.5 text-[0.7rem] font-semibold text-stamp">
          غير موثّق — تحقّق منه
        </span>
      )}
    </p>
  </li>
)

/** The sheet as a document the lawyer can read before the hearing, or print. */
const Sheet = ({ record }: { record: HearingPrepRecord }) => {
  const { prep } = record
  const basic = prep.mode === 'basic' || record.model === 'basic'
  return (
    <article className="print-sheet paper rounded-md p-6">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-ink pb-3">
        <div>
          <h3 className="text-2xl text-ink">ورقة تحضير الجلسة</h3>
          <p className="mt-0.5 text-xs text-ink-soft">
            {prep.hearing_date ? `للجلسة بتاريخ ${formatDate(`${prep.hearing_date}T12:00:00`)} · ` : ''}
            أُعدّت {formatDate(record.created_at)} {formatTime(record.created_at)}
            {record.user_name ? ` بطلب من ${record.user_name}` : ''}
          </p>
          {prep.focus && <p className="mt-1 text-xs text-ink-soft">التركيز المطلوب: {prep.focus}</p>}
        </div>
        <Stamp slam="none" tone={basic ? 'green' : 'blue'} className="text-sm">
          {basic ? 'ورقة أساسية — من بيانات الملف' : 'استرشادي — يراجعه المحامي'}
        </Stamp>
      </header>
      <section className="mt-4">
        <p className="leading-relaxed text-ink">{prep.summary}</p>
        {prep.hearing_focus && (
          <p className="mt-2 border-s-4 border-stamp bg-stamp/5 p-3 text-sm leading-relaxed text-ink">
            <span className="font-semibold">محور الجلسة: </span>
            {prep.hearing_focus}
          </p>
        )}
      </section>
      <div className="mt-5 grid gap-x-8 gap-y-5 md:grid-cols-2">
        {SECTIONS.filter((section) => prep[section.key].length > 0).map((section) => (
          <section key={section.key}>
            <h4 className="border-b border-rule pb-1 text-lg text-ink">{section.title}</h4>
            <ul className="divide-y divide-rule/60">
              {prep[section.key].map((point, index) => (
                <Point key={index} point={point} sources={prep.sources} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <footer className="mt-6 border-t border-rule pt-3 text-xs leading-relaxed text-ink-faint">
        {basic
          ? 'رتّب النظام هذه الورقة آلياً من بيانات ملف القضية، دون ذكاء اصطناعي ودون إرسال أي بيانات خارج المكتب. البنود الموسومة «تذكير عام» قائمة تحضير ثابتة. الورقة لا تُعرض على الموكّل.'
          : `أعدّ هذه الورقة مساعد ذكي (${record.model}) من بيانات ملف القضية فقط. البنود الموسومة «غير موثّق» استنتاجات لا تستند إلى الملف. الورقة أداة مساعدة لا تغني عن مراجعة المحامي، ولا تُعرض على الموكّل.`}
      </footer>
    </article>
  )
}

/** Case-file tab: prepare a sheet for the next hearing, and read earlier ones. */
export const HearingPrepTab = ({ caseId }: { caseId: string }) => {
  const queryClient = useQueryClient()
  const list = useQuery({
    queryKey: ['hearing-prep', caseId],
    queryFn: async () =>
      (await api.get<{ configured: boolean; provider: 'anthropic' | 'gemini' | null; preps: HearingPrepRecord[] }>(`/cases/${caseId}/hearing-prep`)).data,
  })
  const [hearingDate, setHearingDate] = useState('')
  const [focus, setFocus] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const generate = useMutation({
    mutationFn: async (mode: 'basic' | 'ai') =>
      (
        await api.post<HearingPrepRecord>(`/cases/${caseId}/hearing-prep`, {
          mode,
          ...(hearingDate ? { hearing_date: hearingDate } : {}),
          ...(focus.trim() ? { focus: focus.trim() } : {}),
        })
      ).data,
    onSuccess: (record) => {
      setSelected(record.interaction_id)
      void queryClient.invalidateQueries({ queryKey: ['hearing-prep', caseId] })
    },
  })

  if (list.isPending) return <Loading />
  if (list.isError) return <Failed error={list.error} />
  const { configured, preps } = list.data
  const shown = preps.find((record) => record.interaction_id === selected) ?? preps[0]

  return (
    <div className="space-y-6">
      <form onSubmit={(event) => event.preventDefault()} className="no-print grid gap-4 rounded-md border border-ink/15 p-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-end">
        <Field label="موعد الجلسة القادمة (اختياري)" name="hearing_date" type="date" dir="ltr" value={hearingDate} onChange={(event) => setHearingDate(event.target.value)} />
        <TextArea label="على ماذا تركّز؟ (اختياري)" name="focus" rows={1} maxLength={1000} placeholder="مثلاً: سماع شاهد المدعي، أو الرد على دفع التقادم" value={focus} onChange={(event) => setFocus(event.target.value)} />
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button variant="ink" disabled={generate.isPending} onClick={() => generate.mutate('basic')}>
            <FileText className="size-4" aria-hidden="true" />
            {generate.isPending && generate.variables === 'basic' ? 'تُرتَّب الورقة…' : 'جهّز ورقة أساسية (مجانية)'}
          </Button>
          {configured && (
            <Button variant="stamp" disabled={generate.isPending} onClick={() => generate.mutate('ai')}>
              <Sparkles className="size-4" aria-hidden="true" />
              {generate.isPending && generate.variables === 'ai' ? 'يُحضّر المساعد الورقة…' : 'جهّزها بالذكاء الاصطناعي'}
            </Button>
          )}
        </div>
        {generate.isError && (
          <p role="alert" className="text-sm text-stamp sm:col-span-2">
            {(generate.error as { response?: { status?: number } })?.response?.status === 503 ? 'المساعد الذكي غير متاح الآن: تحقّق من مفتاح الذكاء الاصطناعي في إعدادات الخادم.' : messageOf(generate.error)}
          </p>
        )}
      </form>

      {generate.isPending && generate.variables === 'ai' && (
        <p className="animate-pulse text-sm text-ink-soft">يقرأ المساعد ملف القضية ويُعدّ الورقة…</p>
      )}

      {shown ? (
        <>
          <div className="no-print flex flex-wrap items-center justify-between gap-3">
            {preps.length > 1 ? (
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                أوراق سابقة:
                <select value={shown.interaction_id} onChange={(event) => setSelected(event.target.value)} className="rounded-md border border-ink/25 bg-white/60 px-2 py-1 text-sm text-ink">
                  {preps.map((record) => (
                    <option key={record.interaction_id} value={record.interaction_id}>
                      {formatDate(record.created_at)} {formatTime(record.created_at)}
                      {record.user_name ? ` — ${record.user_name}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span />
            )}
            <Button variant="line" size="sm" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden="true" />
              اطبع الورقة
            </Button>
          </div>
          <div className={cn(generate.isPending && 'opacity-60')}>
            <Sheet record={shown} />
          </div>
        </>
      ) : (
        !generate.isPending && <Empty>لم تُعدّ ورقة تحضير لهذه القضية بعد.</Empty>
      )}
    </div>
  )
}
