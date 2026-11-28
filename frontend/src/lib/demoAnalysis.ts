/**
 * Case analysis tools in demo mode: no model is called. Each run returns a fixed, clearly marked
 * sample shaped exactly like a real result (cited points, one unverified point, redaction counts),
 * so the screens can be tried. Nothing here is legal advice.
 */
import type { Analysis, AnalysisPoint, AnalysisResult, Language, ToolKey } from './caseAnalysis'

type Helpers = {
  fail: (status: number, code: string, extra?: object) => Error
  uid: (prefix: string) => string
  caseFor: (user: never, caseId: string) => unknown
}
type DemoActor = { user_id: string; full_name: string; role: string | null }
type Ctx = { user: DemoActor; params: string[]; query: Record<string, unknown>; body: Record<string, unknown> }
type AnalysisRoute = [method: string, pattern: RegExp, roles: readonly string[], handler: (ctx: Ctx) => unknown]

const SAMPLE = 'نتيجة تجريبية مصطنعة لعرض الشاشة فقط: '
const LIMIT_PER_LAWYER = 40
const LAWYERS = 2

const SECTIONS: Record<ToolKey, string[]> = {
  argument: ['applicable_texts', 'supporting_rulings', 'opposing_rulings', 'to_prove', 'defenses_and_replies'],
  legal_question: ['applicable_texts', 'principles', 'to_prove', 'gaps'],
  gaps_defenses: ['formal_defenses', 'substantive_defenses', 'opponent_weaknesses', 'action_plan'],
  document: ['obligations', 'contradictions', 'defects', 'replies'],
  appeal_grounds: ['grounds', 'deadlines_to_check'],
  contract_review: ['unfair_terms', 'ambiguities', 'rights', 'obligations', 'suggested_edits'],
  judgment: ['panel', 'parties', 'appeal_grounds', 'court_reasoning', 'operative_part'],
  brief_check: ['missing_articles', 'missing_rulings', 'expected_defenses'],
  minutes: ['decisions', 'deadlines'],
  translate: ['terminology'],
}

const analyses: (Analysis & { case_id: string })[] = []

/** The pasted text's paragraphs, labelled as the server labels them. */
const paragraphs = (text: string) => {
  let parts = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)
  if (parts.length < 3) parts = text.split(/\n/).map((part) => part.trim()).filter(Boolean)
  return parts.slice(0, 200).map((part, index) => [`X${index + 1}`, part] as const)
}

function sampleResult(tool: ToolKey, text: string, language: Language | null): AnalysisResult {
  const pasted = paragraphs(text)
  const sources: Record<string, string> = {
    C1: 'وصف القضية كما هو مسجّل في الملف.',
    N1: 'آخر ملاحظة في ملف القضية.',
    A1: 'المادة 2 من قانون تجريبي بشأن إيجار العقارات (نص تجريبي مصطنع).',
    ...Object.fromEntries(pasted),
  }
  const cite = pasted.length ? ['X1'] : ['C1']
  const point = (text: string, ids: string[]): AnalysisPoint => ({ text, sources: ids, verified: ids.length > 0 })
  const sections = Object.fromEntries(
    SECTIONS[tool].map((section, index) => [
      section,
      index === 0
        ? [point(`${SAMPLE}بند يستند إلى ملف القضية.`, cite), point(`${SAMPLE}بند يستند إلى نص من المكتبة القانونية.`, ['A1'])]
        : index === 1
          ? [point(`${SAMPLE}استنتاج عام بلا مصدر، فيظهر غير موثّق.`, [])]
          : [point(`${SAMPLE}بند آخر من الملف.`, ['N1'])],
    ]),
  )
  return {
    summary: `${SAMPLE}هذا شكل نتيجة الأداة. في النظام الحقيقي يكتبها الذكاء الاصطناعي من ملف القضية ونصوص المكتبة، بعد حجب الأسماء والأرقام.`,
    sections,
    ...(tool === 'argument' ? { assessment: { level: 'moderate' as const, reasoning: `${SAMPLE}تقدير مبني على ما في الملف.` } } : {}),
    ...(tool === 'minutes'
      ? { actions: [
          { title: 'إعداد اللائحة الجوابية', owner: 'المحامي المسؤول', due_date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), sources: cite, verified: true },
          { title: 'طلب كشف حساب من البنك', owner: null, due_date: null, sources: [], verified: false },
        ] }
      : {}),
    ...(tool === 'translate' ? { translation: `[Sample ${language ?? 'en'} translation — demo mode]\n${text.slice(0, 400)}` } : {}),
    sources,
  }
}

export const analysisRoutes = ({ fail, uid, caseFor }: Helpers): AnalysisRoute[] => {
  const STAFF = ['admin', 'lawyer', 'assistant'] as const
  const usage = () => {
    const month = new Date().toISOString().slice(0, 7)
    const used = analyses.filter((entry) => entry.created_at.startsWith(month)).length
    return { used, limit: LIMIT_PER_LAWYER * LAWYERS, per_lawyer: LIMIT_PER_LAWYER, lawyers: LAWYERS }
  }
  return [
    ['get', /^\/cases\/([^/]+)\/analyses$/, STAFF, ({ user, params }) => {
      caseFor(user as never, params[0]!)
      return { configured: true, provider: 'anthropic', usage: usage(), analyses: analyses.filter((entry) => entry.case_id === params[0]) }
    }],
    ['post', /^\/cases\/([^/]+)\/analyses$/, STAFF, ({ user, params, body }) => {
      caseFor(user as never, params[0]!)
      const tool = body.tool as ToolKey
      if (!SECTIONS[tool]) throw fail(400, 'VALIDATION')
      if (usage().used >= usage().limit) throw fail(429, 'AI_LIMIT_REACHED')
      const text = typeof body.text === 'string' ? body.text : ''
      const language = (body.target_language as Language | undefined) ?? null
      const row: Analysis & { case_id: string } = {
        analysis_id: uid('an'),
        case_id: params[0]!,
        tool,
        question: (body.question as string) || null,
        target_language: language,
        model: 'demo',
        provider: 'anthropic',
        result: sampleResult(tool, text, language),
        redaction: { people: 2, phones: text.match(/\d{9,}/) ? 1 : 0 },
        tasks_created_at: null,
        created_at: new Date().toISOString(),
        created_by: { user_id: user.user_id, full_name: user.full_name },
      }
      analyses.unshift(row)
      return { analysis: row }
    }],
    ['post', /^\/cases\/([^/]+)\/analyses\/([^/]+)\/tasks$/, STAFF, ({ user, params, body }) => {
      caseFor(user as never, params[0]!)
      const row = analyses.find((entry) => entry.analysis_id === params[1] && entry.case_id === params[0])
      if (!row) throw fail(404, 'NOT_FOUND')
      if (row.tool !== 'minutes' || !Array.isArray(body.actions) || body.actions.length === 0) throw fail(400, 'VALIDATION')
      if (row.tasks_created_at) throw fail(409, 'TASKS_ALREADY_CREATED')
      if (body.assignee_user_id && user.role !== 'admin') throw fail(403, 'FORBIDDEN')
      row.tasks_created_at = new Date().toISOString()
      return { tasks: body.actions, private: !body.assignee_user_id }
    }],
  ]
}
