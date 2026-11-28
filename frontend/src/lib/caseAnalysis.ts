/**
 * Case analysis tools (تحليل القضية): types, wording, API calls and query hooks.
 *
 * Kept apart from the screens and free of DOM code, so a React Native client can reuse it as is.
 * The server does the work: it redacts names and numbers before calling the AI model, restores
 * them in the answer, and marks every point without a real citation as unverified.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export type ToolKey =
  | 'argument'
  | 'legal_question'
  | 'gaps_defenses'
  | 'document'
  | 'appeal_grounds'
  | 'contract_review'
  | 'judgment'
  | 'brief_check'
  | 'minutes'
  | 'translate'

export type Language = 'en' | 'he' | 'fr'
export type AssessmentLevel = 'strong' | 'moderate' | 'weak' | 'unclear'

export type AnalysisPoint = { text: string; sources: string[]; verified: boolean }
export type MinutesAction = { title: string; owner: string | null; due_date: string | null; sources: string[]; verified: boolean }

export type AnalysisResult = {
  summary: string
  sections: Record<string, AnalysisPoint[]>
  assessment?: { level: AssessmentLevel; reasoning: string }
  actions?: MinutesAction[]
  translation?: string
  /** What each cited label stood for: case-file items, library texts, pasted paragraphs. */
  sources: Record<string, string>
  ruling?: { ruling_id: string; subject: string | null; case_number: string | null }
}

export type Analysis = {
  analysis_id: string
  tool: ToolKey
  question: string | null
  target_language: Language | null
  model: string | null
  provider: 'anthropic' | 'gemini' | null
  result: AnalysisResult
  /** How many of each were replaced before the text was sent. */
  redaction: { people?: number; ids?: number; phones?: number; emails?: number }
  tasks_created_at: string | null
  created_at: string
  created_by: { user_id: string; full_name: string | null }
}

export type Usage = { used: number; limit: number; per_lawyer: number; lawyers: number }
export type AnalysesPage = { configured: boolean; provider: 'anthropic' | 'gemini' | null; usage: Usage; analyses: Analysis[] }

export type AnalysisInput = { tool: ToolKey; question?: string; text?: string; ruling_id?: string; target_language?: Language }

/* ───────────── the tools ───────────── */

type ToolSpec = {
  title: string
  note: string
  /** Whether the tool takes pasted text, and what the box is called. */
  text: 'none' | 'optional' | 'required'
  textLabel?: string
  /** A ruling from the library can stand in for the pasted text. */
  ruling?: boolean
  question: 'none' | 'optional' | 'required'
  questionLabel?: string
  language?: boolean
  sections: [key: string, title: string][]
}

export const TOOLS: Record<ToolKey, ToolSpec> = {
  argument: {
    title: 'بناء الحجة',
    note: 'المسألة، والنصوص المنطبقة، والأحكام المؤيدة والمعارضة، وما يلزم إثباته، والدفوع وردودها، وتقدير قوة الموقف.',
    text: 'none',
    question: 'optional',
    questionLabel: 'على ماذا تركّز؟ (اختياري)',
    sections: [['applicable_texts', 'النصوص المنطبقة'], ['supporting_rulings', 'أحكام مؤيدة'], ['opposing_rulings', 'أحكام معارضة'], ['to_prove', 'ما يلزم إثباته'], ['defenses_and_replies', 'الدفوع المتوقعة وردودها']],
  },
  legal_question: {
    title: 'السؤال القانوني',
    note: 'جواب مؤصّل بالمواد: النصوص المنطبقة، والمبادئ القضائية، وما يلزم إثباته، والثغرات.',
    text: 'none',
    question: 'required',
    questionLabel: 'السؤال القانوني',
    sections: [['applicable_texts', 'النصوص المنطبقة'], ['principles', 'المبادئ القضائية'], ['to_prove', 'ما يلزم إثباته'], ['gaps', 'الثغرات']],
  },
  gaps_defenses: {
    title: 'الثغرات والدفوع',
    note: 'الدفوع الشكلية والموضوعية، وثغرات الخصم، وخطة قابلة للتنفيذ.',
    text: 'optional',
    textLabel: 'لائحة الخصم أو مذكرته (اختياري)',
    question: 'optional',
    questionLabel: 'على ماذا تركّز؟ (اختياري)',
    sections: [['formal_defenses', 'الدفوع الشكلية'], ['substantive_defenses', 'الدفوع الموضوعية'], ['opponent_weaknesses', 'ثغرات الخصم'], ['action_plan', 'خطة العمل']],
  },
  document: {
    title: 'تحليل مستند أو مذكرة خصم',
    note: 'الالتزامات والتناقضات والعيوب في المستند، وكيف يُرد عليها.',
    text: 'required',
    textLabel: 'نص المستند أو المذكرة',
    question: 'optional',
    questionLabel: 'على ماذا تركّز؟ (اختياري)',
    sections: [['obligations', 'الالتزامات'], ['contradictions', 'التناقضات'], ['defects', 'العيوب'], ['replies', 'الردود المقترحة']],
  },
  appeal_grounds: {
    title: 'أسباب الطعن',
    note: 'أسباب الطعن المحتملة في الحكم مرتبة بقوتها، والمهل الواجب التحقق منها.',
    text: 'required',
    textLabel: 'نص الحكم',
    ruling: true,
    question: 'optional',
    questionLabel: 'على ماذا تركّز؟ (اختياري)',
    sections: [['grounds', 'أسباب الطعن (الأقوى أولاً)'], ['deadlines_to_check', 'مهل يجب التحقق منها']],
  },
  contract_review: {
    title: 'مراجعة عقد',
    note: 'الشروط المجحفة والغموض والحقوق والالتزامات، وتعديلات مقترحة.',
    text: 'required',
    textLabel: 'نص العقد',
    question: 'optional',
    questionLabel: 'لمصلحة من تُراجَع؟ أو ما الذي يهمك؟ (اختياري)',
    sections: [['unfair_terms', 'شروط مجحفة'], ['ambiguities', 'غموض'], ['rights', 'الحقوق'], ['obligations', 'الالتزامات'], ['suggested_edits', 'تعديلات مقترحة']],
  },
  judgment: {
    title: 'تشريح حكم',
    note: 'الهيئة، والأطراف، وأسباب الطعن، وأسباب المحكمة، والمنطوق.',
    text: 'required',
    textLabel: 'نص الحكم',
    ruling: true,
    question: 'none',
    sections: [['panel', 'الهيئة'], ['parties', 'الأطراف'], ['appeal_grounds', 'الأسباب المثارة'], ['court_reasoning', 'أسباب المحكمة'], ['operative_part', 'المنطوق']],
  },
  brief_check: {
    title: 'ما فاتك في المذكرة',
    note: 'يقارن مذكرتك بنصوص المكتبة وأحكامها: المواد والأحكام التي لم تذكرها، والدفوع المتوقعة.',
    text: 'required',
    textLabel: 'نص مذكرتك',
    question: 'none',
    sections: [['missing_articles', 'مواد لم تُذكر'], ['missing_rulings', 'أحكام لم تُذكر'], ['expected_defenses', 'دفوع متوقعة لم تُرد عليها']],
  },
  minutes: {
    title: 'محضر اجتماع',
    note: 'القرارات والمسؤوليات والمواعيد من تفريغ الاجتماع، ثم مهام بعد تأكيدك.',
    text: 'required',
    textLabel: 'تفريغ الاجتماع',
    question: 'none',
    sections: [['decisions', 'القرارات'], ['deadlines', 'المواعيد']],
  },
  translate: {
    title: 'الترجمة القانونية',
    note: 'إلى الإنجليزية أو العبرية أو الفرنسية، مع حفظ الترقيم والمصطلحات.',
    text: 'required',
    textLabel: 'النص المراد ترجمته',
    question: 'none',
    language: true,
    sections: [['terminology', 'مصطلحات تحتاج انتباهك']],
  },
}

export const TOOL_ORDER: ToolKey[] = ['argument', 'legal_question', 'gaps_defenses', 'document', 'contract_review', 'appeal_grounds', 'judgment', 'brief_check', 'minutes', 'translate']

export const LANGUAGE: Record<Language, string> = { en: 'الإنجليزية', he: 'العبرية', fr: 'الفرنسية' }

export const ASSESSMENT: Record<AssessmentLevel, { text: string; tone: 'green' | 'blue' | 'red' | 'ink' }> = {
  strong: { text: 'موقف قوي', tone: 'green' },
  moderate: { text: 'موقف متوسط', tone: 'blue' },
  weak: { text: 'موقف ضعيف', tone: 'red' },
  unclear: { text: 'غير واضح من الملف', tone: 'ink' },
}

/** What a cited label points to: "مادة" for A1, "فقرة" for X3… */
export const SOURCE_KIND: Record<string, string> = {
  N: 'ملاحظة', T: 'مهمة', D: 'مستند', H: 'جلسة', C: 'بيانات القضية', P: 'الأطراف', O: 'الخصوم', A: 'مادة', R: 'حكم', X: 'فقرة',
}

export const MAX_TEXT = 60_000
export const MAX_QUESTION = 2000

/** Whether the form has what the tool needs. */
export const canRun = (tool: ToolKey, input: { question: string; text: string; rulingId: string | null; language: Language | '' }) => {
  const spec = TOOLS[tool]
  if (spec.question === 'required' && !input.question.trim()) return false
  if (spec.text === 'required' && !input.text.trim() && !(spec.ruling && input.rulingId)) return false
  if (spec.language && !input.language) return false
  return input.text.length <= MAX_TEXT && input.question.length <= MAX_QUESTION
}

/** "حُجب قبل الإرسال: اسمان، هاتف واحد" — or null when nothing was replaced. */
export const redactionNote = (redaction: Analysis['redaction']) => {
  const count = (value: number | undefined, one: string, two: string, few: string, many: string) =>
    !value ? null : value === 1 ? one : value === 2 ? two : value <= 10 ? `${value} ${few}` : `${value} ${many}`
  const parts = [
    count(redaction.people, 'اسم واحد', 'اسمان', 'أسماء', 'اسماً'),
    count(redaction.ids, 'رقم هوية واحد', 'رقما هوية', 'أرقام هويات', 'رقم هوية'),
    count(redaction.phones, 'هاتف واحد', 'هاتفان', 'هواتف', 'هاتفاً'),
    count(redaction.emails, 'بريد واحد', 'بريدان', 'عناوين بريد', 'عنوان بريد'),
  ].filter(Boolean)
  return parts.length ? `حُجب قبل الإرسال: ${parts.join('، ')}.` : null
}

/** Points of all sections that rest on nothing sent: the share the lawyer must check. */
export const unverifiedCount = (result: AnalysisResult) =>
  Object.values(result.sections).flat().filter((point) => !point.verified).length

/* ───────────── API and hooks ───────────── */

const key = (caseId: string) => ['case-analyses', caseId]

export const fetchAnalyses = async (caseId: string) => (await api.get<AnalysesPage>(`/cases/${caseId}/analyses`)).data

export const useAnalyses = (caseId: string) => useQuery({ queryKey: key(caseId), queryFn: () => fetchAnalyses(caseId) })

export const useRunAnalysis = (caseId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: AnalysisInput) => (await api.post<{ analysis: Analysis }>(`/cases/${caseId}/analyses`, input, { timeout: 180_000 })).data.analysis,
    onSettled: () => queryClient.invalidateQueries({ queryKey: key(caseId) }),
  })
}

export const useCreateTasks = (caseId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ analysisId, actions, assigneeUserId }: { analysisId: string; actions: number[]; assigneeUserId?: string }) =>
      (await api.post<{ tasks: unknown[]; private: boolean }>(`/cases/${caseId}/analyses/${analysisId}/tasks`, { actions, ...(assigneeUserId ? { assignee_user_id: assigneeUserId } : {}) })).data,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key(caseId) })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}
