import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ListPlus, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/auth'
import { api, messageOf } from '@/lib/api'
import {
  ASSESSMENT,
  LANGUAGE,
  MAX_QUESTION,
  MAX_TEXT,
  SOURCE_KIND,
  TOOL_ORDER,
  TOOLS,
  canRun,
  redactionNote,
  unverifiedCount,
  useAnalyses,
  useCreateTasks,
  useRunAnalysis,
  type Analysis,
  type AnalysisPoint,
  type AnalysisResult,
  type Language,
  type ToolKey,
} from '@/lib/caseAnalysis'
import { formatDate, formatTime } from '@/lib/labels'
import { rulingCitation, useLibrarySearch } from '@/lib/legalLibrary'
import type { CaseRelationships } from '@/lib/types'
import { FormActions, SelectField, TextArea } from '@/ui/forms'
import { Button, cn, Field } from '@/ui/kit'
import { Empty, Failed, Loading, Pill } from '@/ui/Shell'
import { PrintButton, PrintSheet, usePrintWithCode } from '@/ui/PrintSheet'

/* ───────────────────────── a result ───────────────────────── */

const SourceChip = ({ id, sources }: { id: string; sources: AnalysisResult['sources'] }) => (
  <span title={sources[id]} className="cursor-help rounded bg-stamp-blue/10 px-1.5 py-0.5 text-[0.7rem] font-semibold text-stamp-blue">
    {SOURCE_KIND[id[0]!] ?? 'بند'} <bdi>{id}</bdi>
  </span>
)

const Unverified = () => (
  <span title="لم يستند هذا البند إلى شيء مما أُرسل: هو استنتاج من المساعد يحتاج تحققاً." className="cursor-help rounded bg-stamp/10 px-1.5 py-0.5 text-[0.7rem] font-semibold text-stamp">
    غير موثّق — تحقّق منه
  </span>
)

const Point = ({ point, sources }: { point: AnalysisPoint; sources: AnalysisResult['sources'] }) => (
  <li className="py-2">
    <p className="text-sm leading-relaxed text-ink">{point.text}</p>
    <p className="mt-1 flex flex-wrap items-center gap-1.5">
      {point.verified ? point.sources.map((id) => <SourceChip key={id} id={id} sources={sources} />) : <Unverified />}
    </p>
  </li>
)

/** The minutes' actions, with a way to turn the chosen ones into tasks. */
const MinutesActions = ({ analysis, caseId }: { analysis: Analysis; caseId: string }) => {
  const actions = analysis.result.actions ?? []
  const admin = useAuth().session?.active_office?.role === 'admin'
  const [chosen, setChosen] = useState<number[]>(() => actions.map((_, index) => index))
  const [assignee, setAssignee] = useState('')
  const create = useCreateTasks(caseId)
  const team = useQuery({
    queryKey: ['relationships', caseId],
    enabled: admin,
    queryFn: async () => (await api.get<{ relationships: CaseRelationships }>(`/cases/${caseId}/relationships`)).data.relationships,
  })
  const members = (team.data?.assigned_staff ?? []).filter((member) => member.user_id && member.role !== 'admin')
  if (actions.length === 0) return null
  const done = analysis.tasks_created_at !== null || create.isSuccess
  return (
    <section className="mt-4">
      <h4 className="mb-1 text-lg text-ink">المهام المستخرجة</h4>
      <ul className="divide-y divide-rule">
        {actions.map((action, index) => (
          <li key={`${action.title}-${index}`} className="flex items-start gap-3 py-2">
            {!done && (
              <input
                type="checkbox"
                aria-label={`اختر: ${action.title}`}
                className="mt-1 size-4 accent-stamp"
                checked={chosen.includes(index)}
                onChange={(event) => setChosen((current) => (event.target.checked ? [...current, index] : current.filter((entry) => entry !== index)))}
              />
            )}
            <div>
              <p className="text-sm text-ink">{action.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                {action.owner && <span>المسؤول: {action.owner}</span>}
                {action.due_date && <span>الموعد: {formatDate(`${action.due_date}T12:00:00`)}</span>}
                {action.verified ? action.sources.map((id) => <SourceChip key={id} id={id} sources={analysis.result.sources} />) : <Unverified />}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {done ? (
        <p role="status" className="mt-2 text-sm font-semibold text-stamp-green">
          {create.data?.private === false ? 'أُنشئت المهام في القضية.' : 'أُنشئت المهام.'} تجدها في صفحة المهام.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          {admin && (
            <SelectField
              label="أسندها إلى"
              name={`assignee-${analysis.analysis_id}`}
              className="w-60"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              options={[['', 'مهامي الخاصة'], ...members.map((member) => [member.user_id!, member.full_name] as const)]}
            />
          )}
          <Button
            variant="ink"
            size="sm"
            disabled={chosen.length === 0 || create.isPending}
            onClick={() => create.mutate({ analysisId: analysis.analysis_id, actions: [...chosen].sort((a, b) => a - b), assigneeUserId: assignee || undefined })}
          >
            <ListPlus className="size-4" aria-hidden="true" />
            {create.isPending ? 'تُنشأ…' : `أنشئ ${chosen.length === 1 ? 'مهمة' : 'المهام'}`}
          </Button>
          {!admin && <p className="text-xs text-ink-faint">تُنشأ في مهامك الخاصة، وفي وصف كل منها رقم القضية.</p>}
        </div>
      )}
      {create.isError && <p role="alert" className="mt-2 text-sm text-stamp">{messageOf(create.error)}</p>}
    </section>
  )
}

const ResultView = ({ analysis, caseId }: { analysis: Analysis; caseId: string }) => {
  const spec = TOOLS[analysis.tool]
  const { result } = analysis
  const unverified = unverifiedCount(result)
  const redaction = redactionNote(analysis.redaction)
  const printing = usePrintWithCode('analysis')
  const { reset } = printing
  useEffect(() => reset(), [analysis.analysis_id, reset])
  return (
    <div className="space-y-3">
    <div className="no-print flex justify-end">
      <PrintButton onPrint={() => void printing.print()} busy={printing.busy} error={printing.error} label="اطبع" />
    </div>
    <PrintSheet
      kind="analysis"
      title={spec.title}
      sheetRef={printing.sheetRef}
      code={printing.code}
      subtitle={
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mt-0.5 text-xs text-ink-soft">
            {formatDate(analysis.created_at)} {formatTime(analysis.created_at)}
            {analysis.created_by.full_name ? ` · ${analysis.created_by.full_name}` : ''}
            {analysis.target_language ? ` · إلى ${LANGUAGE[analysis.target_language]}` : ''}
          </p>
          {analysis.question && <p className="mt-1 text-xs text-ink-soft">السؤال أو التركيز: {analysis.question}</p>}
          {result.ruling && <p className="mt-1 text-xs text-ink-soft">الحكم من المكتبة: {result.ruling.subject ?? result.ruling.case_number}</p>}
        </div>
        {result.assessment && <Pill tone={ASSESSMENT[result.assessment.level].tone}>{ASSESSMENT[result.assessment.level].text}</Pill>}
      </div>
      }
    >
      {result.summary && <p className="leading-relaxed text-ink">{result.summary}</p>}
      {result.assessment?.reasoning && <p className="mt-2 text-sm leading-relaxed text-ink-soft">{result.assessment.reasoning}</p>}
      {result.translation !== undefined && (
        <section className="mt-4 rounded-md border border-rule bg-paper p-4">
          <h4 className="mb-2 text-sm font-semibold text-ink-soft">الترجمة</h4>
          <p data-no-translate dir={analysis.target_language === 'he' ? 'rtl' : 'ltr'} className="leading-relaxed whitespace-pre-line text-ink">{result.translation}</p>
        </section>
      )}
      {spec.sections.map(([key, title]) =>
        (result.sections[key] ?? []).length === 0 ? null : (
          <section key={key} className="mt-4">
            <h4 className="text-lg text-ink">{title}</h4>
            <ul className="divide-y divide-rule">
              {(result.sections[key] ?? []).map((point, index) => <Point key={`${key}-${index}`} point={point} sources={result.sources} />)}
            </ul>
          </section>
        ),
      )}
      {analysis.tool === 'minutes' && <MinutesActions analysis={analysis} caseId={caseId} />}
      <div className="mt-5 space-y-1 border-t border-rule pt-3 text-xs text-ink-faint">
        {unverified > 0 && (
          <p className="font-semibold text-stamp">
            {unverified === 1 ? 'بند واحد غير موثّق: تحقّق منه قبل الاعتماد عليه.' : `${unverified} بنود غير موثّقة: تحقّق منها قبل الاعتماد عليها.`}
          </p>
        )}
        {redaction && <p className="flex items-center gap-1"><ShieldCheck className="size-3.5 text-stamp-green" aria-hidden="true" />{redaction}</p>}
        <p>ورقة عمل يراجعها المحامي، لا تظهر للموكّل. مرّر المؤشر على أي مرجع لترى نصه.</p>
      </div>
    </PrintSheet>
    </div>
  )
}

/* ───────────────────────── the form ───────────────────────── */

/** Picks a ruling from the legal library instead of pasting the judgment. */
const RulingPicker = ({ value, onChange }: { value: { id: string; label: string } | null; onChange: (next: { id: string; label: string } | null) => void }) => {
  const [search, setSearch] = useState('')
  const [submitted, setSubmitted] = useState('')
  const results = useLibrarySearch(submitted.length >= 2 ? { q: submitted, type: 'rulings' } : null)
  if (value) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
        الحكم من المكتبة: <span className="font-semibold" data-no-translate>{value.label}</span>
        <button type="button" onClick={() => onChange(null)} className="text-xs font-semibold text-stamp underline-offset-4 hover:underline">إلغاء الاختيار</button>
      </p>
    )
  }
  return (
    <div className="rounded-md border border-dashed border-ink/20 p-3">
      <div className="flex items-end gap-2">
        <Field label="أو اختر حكماً من المكتبة القانونية" name="ruling_search" className="flex-1" placeholder="موضوع الحكم أو رقمه" value={search} onChange={(event) => setSearch(event.target.value)} />
        <Button variant="line" size="sm" disabled={search.trim().length < 2} onClick={() => setSubmitted(search.trim())}>ابحث</Button>
      </div>
      {results.data && (
        results.data.rulings.length === 0 ? (
          <p className="mt-2 text-xs text-ink-faint">لا أحكام مطابقة في المكتبة.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {results.data.rulings.slice(0, 6).map((ruling) => (
              <li key={ruling.ruling_id}>
                <button type="button" onClick={() => onChange({ id: ruling.ruling_id, label: ruling.subject ?? rulingCitation(ruling) })} className="text-start text-sm text-stamp-blue underline-offset-4 hover:underline">
                  <span data-no-translate>{ruling.subject ?? rulingCitation(ruling)}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}

const RunForm = ({ caseId, tool, onDone }: { caseId: string; tool: ToolKey; onDone: (analysis: Analysis) => void }) => {
  const spec = TOOLS[tool]
  const run = useRunAnalysis(caseId)
  const [question, setQuestion] = useState('')
  const [text, setText] = useState('')
  const [ruling, setRuling] = useState<{ id: string; label: string } | null>(null)
  const [language, setLanguage] = useState<Language | ''>('')
  useEffect(() => {
    run.reset()
    setRuling(null)
    // A new tool keeps the pasted text and question: switching tools on the same text is common.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])
  const ready = canRun(tool, { question, text, rulingId: ruling?.id ?? null, language })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    run.mutate(
      {
        tool,
        ...(spec.question !== 'none' && question.trim() ? { question: question.trim() } : {}),
        ...(spec.text !== 'none' && text.trim() ? { text: text.trim() } : {}),
        ...(spec.ruling && ruling && !text.trim() ? { ruling_id: ruling.id } : {}),
        ...(spec.language && language ? { target_language: language } : {}),
      },
      { onSuccess: onDone },
    )
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-ink-soft">{spec.note}</p>
      {spec.question !== 'none' && (
        <TextArea label={spec.questionLabel ?? 'السؤال'} name="analysis_question" rows={2} maxLength={MAX_QUESTION} required={spec.question === 'required'} value={question} onChange={(event) => setQuestion(event.target.value)} />
      )}
      {spec.text !== 'none' && (
        <div>
          <TextArea label={spec.textLabel ?? 'النص'} name="analysis_text" rows={8} required={spec.text === 'required' && !ruling} disabled={Boolean(ruling)} value={text} onChange={(event) => setText(event.target.value)} />
          <p className={cn('mt-1 text-xs', text.length > MAX_TEXT ? 'text-stamp' : 'text-ink-faint')}>
            {text.length.toLocaleString('en')} / {MAX_TEXT.toLocaleString('en')} حرف. تُحجب الأسماء وأرقام الهويات والهواتف والبريد قبل الإرسال.
          </p>
        </div>
      )}
      {spec.ruling && !text.trim() && <RulingPicker value={ruling} onChange={setRuling} />}
      {spec.language && (
        <SelectField label="الترجمة إلى" name="analysis_language" className="w-48" required value={language} onChange={(event) => setLanguage(event.target.value as Language | '')} options={[['', 'اختر اللغة'], ...(Object.entries(LANGUAGE) as [Language, string][])]} />
      )}
      <FormActions error={run.isError ? messageOf(run.error) : null}>
        <Button type="submit" variant="stamp" disabled={!ready || run.isPending}>
          <Sparkles className="size-4" aria-hidden="true" />
          {run.isPending ? 'يُحلَّل… قد يستغرق دقيقة' : 'حلّل'}
        </Button>
      </FormActions>
    </form>
  )
}

/* ───────────────────────── the tab ───────────────────────── */

const PROVIDER_NAME = { anthropic: 'Claude من Anthropic', gemini: 'Gemini من Google' } as const

export const CaseAnalysis = ({ caseId }: { caseId: string }) => {
  const page = useAnalyses(caseId)
  const [tool, setTool] = useState<ToolKey>('argument')
  const [shown, setShown] = useState<string | null>(null)
  if (page.isPending) return <Loading />
  if (page.isError) return <Failed error={new Error(messageOf(page.error))} />
  const { configured, provider, usage, analyses } = page.data
  const latest = analyses.find((entry) => entry.analysis_id === shown) ?? null
  const used = usage.used >= usage.limit

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-soft">
          أدوات تحليل بالذكاء الاصطناعي على ملف القضية ونصوص المكتبة القانونية. كل بند يستشهد بمصدره، وما لا مصدر له يظهر «غير موثّق».
          {provider && ` تُرسل البيانات إلى ${PROVIDER_NAME[provider]} بعد حجب الأسماء والأرقام.`}
        </p>
        <p className={cn('text-sm tabular-nums', used ? 'font-semibold text-stamp' : 'text-ink-soft')}>
          {`استُعمل هذا الشهر ${usage.used} من ${usage.limit}`}
        </p>
      </div>

      {!configured ? (
        <Empty>المساعد الذكي غير مفعّل على هذا الخادم: يحتاج مفتاح Claude أو Gemini في إعدادات الخادم.</Empty>
      ) : used ? (
        <p role="status" className="rounded-md border border-stamp/40 bg-stamp/5 px-4 py-3 text-sm text-ink">انتهى رصيد التحليلات لهذا الشهر. يتجدد الرصيد أول الشهر القادم.</p>
      ) : (
        <section className="rounded-lg border border-rule bg-paper p-5">
          <div role="tablist" aria-label="أدوات التحليل" className="mb-4 flex flex-wrap gap-2">
            {TOOL_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tool === key}
                onClick={() => setTool(key)}
                className={cn('rounded-full px-3 py-1.5 text-sm transition-colors', tool === key ? 'bg-ink text-paper' : 'border border-ink/20 text-ink hover:border-ink hover:bg-ink/5')}
              >
                {TOOLS[key].title}
              </button>
            ))}
          </div>
          <RunForm caseId={caseId} tool={tool} onDone={(analysis) => setShown(analysis.analysis_id)} />
        </section>
      )}

      {latest && <ResultView analysis={latest} caseId={caseId} />}

      <section>
        <h3 className="mb-2 text-xl text-ink">تحليلات سابقة</h3>
        {analyses.length === 0 ? (
          <Empty>لم يُجرَ أي تحليل على هذه القضية بعد.</Empty>
        ) : (
          <ul className="divide-y divide-rule rounded-lg border border-rule bg-paper">
            {analyses.map((analysis) => (
              <li key={analysis.analysis_id}>
                <button
                  type="button"
                  aria-expanded={shown === analysis.analysis_id}
                  onClick={() => setShown(shown === analysis.analysis_id ? null : analysis.analysis_id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-marker/20"
                >
                  <span>
                    <span className="block text-sm font-semibold text-ink">{TOOLS[analysis.tool].title}</span>
                    <span className="text-xs text-ink-soft">
                      {formatDate(analysis.created_at)} {formatTime(analysis.created_at)}
                      {analysis.created_by.full_name ? ` · ${analysis.created_by.full_name}` : ''}
                      {analysis.question ? ` · ${analysis.question.slice(0, 60)}` : ''}
                    </span>
                  </span>
                  <ChevronDown className={cn('size-4 shrink-0 text-ink-soft transition-transform', shown === analysis.analysis_id && 'rotate-180')} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
