/**
 * Legal library (المكتبة القانونية): types, wording, API calls and query hooks.
 *
 * Kept apart from the screens and free of DOM code, so a React Native client can reuse it as is.
 * The server is the reference for everything legal: texts come back exactly as stored, an
 * article's `current` says whether it may be relied on, and quoted periods and penalties are
 * sentences of the article itself, never computed here.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export type Jurisdiction = 'ps' | 'jo' | 'eg'
export type LawKind = 'law' | 'decree_law' | 'regulation' | 'decree' | 'decision' | 'order' | 'other'
export type TextStatus = 'in_force' | 'amended' | 'repealed'
export type CourtLevel = 'cassation' | 'high' | 'constitutional' | 'appeal' | 'first_instance' | 'magistrate' | 'other'
export type SearchType = 'all' | 'articles' | 'rulings' | 'laws'

export type LawSummary = {
  law_id: string
  title: string
  law_number: string | null
  law_year: number | null
  law_kind?: LawKind
  jurisdiction?: Jurisdiction
  status: TextStatus
}

export type Article = {
  article_id: string
  article_number: string
  body: string
  status: TextStatus
  note: string | null
  /** Neither the article nor its law is repealed. */
  current: boolean
  law: LawSummary
  ruling_count?: number
  saved_item_id: string | null
}

export type ArticleDetail = Article & { quoted_periods: string[]; quoted_penalties: string[] }

export type AppliedArticle = { article_id: string; article_number: string; law_id: string; law_title: string; status: TextStatus; law_status: TextStatus }

export type Ruling = {
  ruling_id: string
  jurisdiction: Jurisdiction
  court_level: CourtLevel
  court_name: string | null
  case_number: string | null
  ruling_year: number | null
  decided_on: string | null
  subject: string | null
  summary: string | null
  /** The start of the text, when there is no summary to show (lists only). */
  preview?: string | null
  /** The full text (the ruling's own page only). */
  body?: string
  applied_articles: AppliedArticle[]
  saved_item_id: string | null
}

export type Law = LawSummary & {
  law_kind: LawKind
  jurisdiction: Jurisdiction
  status_note: string | null
  published_on: string | null
  source_url: string | null
  article_count?: number
  gazette_issue: { issue_id: string; issue_number: number; published_on: string | null } | null
}

export type SearchResult = {
  query: string
  mapped_terms: { phrase: string; terms: string[] }[]
  articles: Article[]
  rulings: Ruling[]
  laws: Law[]
  hidden_repealed: number
}

export type LibraryStats = { ps_laws: number; ps_rulings: number; gazette_issues: number; comparative: number; articles: number }

export type GazetteIssue = { issue_id: string; issue_number: number; published_on: string | null; item_count?: number }
export type GazetteItem = { position: number; title: string; law_id: string | null; law_status: TextStatus | null }

type Author = { user_id: string; full_name: string }

export type SavedItem = {
  item_id: string
  note: string | null
  tags: string[]
  created_at: string
  updated_at: string
  created_by: Author
  article: (Pick<Article, 'article_id' | 'article_number' | 'body' | 'status' | 'current'> & { law: LawSummary }) | null
  ruling: Pick<Ruling, 'ruling_id' | 'court_level' | 'court_name' | 'case_number' | 'ruling_year' | 'decided_on' | 'subject' | 'jurisdiction'> | null
}

export type Principle = { principle_id: string; title: string; body: string; tags: string[]; created_at: string; updated_at: string; created_by: Author }

export type CaseReference = {
  reference_id: string
  note: string | null
  created_at: string
  linked_by: Author
  article: SavedItem['article']
  ruling: Omit<NonNullable<SavedItem['ruling']>, 'jurisdiction'> | null
}

/** What a saved item or case reference points to: exactly one of the two. */
export type LibraryTarget = { article_id: string; ruling_id?: never } | { ruling_id: string; article_id?: never }

export type ImportCount = { added: number; updated: number }
export type ImportSummary = {
  gazette: ImportCount
  laws: ImportCount
  articles: ImportCount
  rulings: ImportCount
  synonyms: ImportCount
  articles_kept_not_in_file: number
  ruling_links: number
  warnings: string[]
}
export type ImportProblem = { path: string; message: string }
export type ImportRecord = { import_id: string; file_name: string | null; summary: ImportSummary; created_at: string; imported_by_name: string | null }

/* ───────────── wording ───────────── */

export const JURISDICTION: Record<Jurisdiction, string> = { ps: 'فلسطين', jo: 'الأردن', eg: 'مصر' }

export const LAW_KIND: Record<LawKind, string> = {
  law: 'قانون',
  decree_law: 'قرار بقانون',
  regulation: 'نظام',
  decree: 'مرسوم',
  decision: 'قرار',
  order: 'أمر',
  other: 'تشريع',
}

export const TEXT_STATUS: Record<TextStatus, { text: string; tone: 'green' | 'blue' | 'red' }> = {
  in_force: { text: 'ساري', tone: 'green' },
  amended: { text: 'معدّل', tone: 'blue' },
  repealed: { text: 'مُلغى', tone: 'red' },
}

export const COURT_LEVEL: Record<CourtLevel, string> = {
  cassation: 'محكمة النقض',
  high: 'محكمة العدل العليا',
  constitutional: 'المحكمة الدستورية',
  appeal: 'محكمة الاستئناف',
  first_instance: 'محكمة البداية',
  magistrate: 'محكمة الصلح',
  other: 'محكمة',
}

export const SEARCH_TYPES: readonly (readonly [SearchType, string])[] = [
  ['all', 'الكل'],
  ['articles', 'المواد'],
  ['rulings', 'الأحكام'],
  ['laws', 'التشريعات'],
]

/** "قانون رقم 2 لسنة 2001", from whichever parts the law has. */
export const lawCitation = (law: Pick<LawSummary, 'law_number' | 'law_year'> & { law_kind?: LawKind }) =>
  [law.law_kind ? LAW_KIND[law.law_kind] : null, law.law_number ? `رقم ${law.law_number}` : null, law.law_year ? `لسنة ${law.law_year}` : null]
    .filter(Boolean)
    .join(' ')

/** "محكمة النقض · 123/2015 · 2016-01-10", from whichever parts the ruling has. */
export const rulingCitation = (ruling: Pick<Ruling, 'court_level' | 'court_name' | 'case_number' | 'decided_on' | 'ruling_year'>) =>
  [ruling.court_name || COURT_LEVEL[ruling.court_level], ruling.case_number, ruling.decided_on ?? (ruling.ruling_year ? String(ruling.ruling_year) : null)]
    .filter(Boolean)
    .join(' · ')

/** Arabic counting of articles: مادة واحدة، مادتان، 3 مواد، 11 مادة. */
export const articlesCount = (count: number) =>
  count === 1 ? 'مادة واحدة' : count === 2 ? 'مادتان' : count >= 3 && count <= 10 ? `${count} مواد` : `${count} مادة`

/** Arabic counting of a Gazette issue's items: بند واحد، بندان، 3 بنود، 11 بنداً. */
export const itemsCount = (count: number) =>
  count === 1 ? 'بند واحد' : count === 2 ? 'بندان' : count >= 3 && count <= 10 ? `${count} بنود` : `${count} بنداً`

/** How many repealed articles a search left out, in correct Arabic. */
export const hiddenRepealedNote = (count: number) =>
  count === 1
    ? 'أُخفيت مادة ملغاة واحدة تطابق البحث.'
    : count === 2
      ? 'أُخفيت مادتان ملغاتان تطابقان البحث.'
      : count <= 10
        ? `أُخفيت ${count} مواد ملغاة تطابق البحث.`
        : `أُخفيت ${count} مادة ملغاة تطابق البحث.`

/** Tags typed as "إيجار، إخلاء" or "إيجار, إخلاء". */
export const parseTags = (text: string) => [...new Set(text.split(/[،,]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 10)

export const MAX_IMPORT_BYTES = 15 * 1024 * 1024

/* ───────────── API ───────────── */

export type SearchParams = { q: string; jurisdiction?: Jurisdiction; type?: SearchType; includeRepealed?: boolean }

const clean = (params: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '' && value !== false).map(([key, value]) => [key, String(value)]))

export const searchLibrary = async (params: SearchParams) => (await api.get<SearchResult>('/library/search', { params: clean(params) })).data

export const fetchStats = async () => (await api.get<{ stats: LibraryStats }>('/library/stats')).data.stats
export const fetchLaw = async (lawId: string) => (await api.get<{ law: Law; articles: Article[] }>(`/library/laws/${lawId}`)).data
export const fetchArticle = async (articleId: string) =>
  (await api.get<{ article: ArticleDetail; rulings: Ruling[] }>(`/library/articles/${articleId}`)).data
export const fetchRuling = async (rulingId: string) => (await api.get<{ ruling: Ruling }>(`/library/rulings/${rulingId}`)).data.ruling
export const fetchGazette = async (year?: number) =>
  (await api.get<{ years: number[]; year: number | null; issues: GazetteIssue[] }>('/library/gazette', { params: year ? { year } : {} })).data
export const fetchGazetteIssue = async (issueId: string) =>
  (await api.get<{ issue: GazetteIssue & { items: GazetteItem[] } }>(`/library/gazette/${issueId}`)).data.issue

export const fetchSaved = async (params: { type?: 'articles' | 'rulings'; tag?: string } = {}) =>
  (await api.get<{ items: SavedItem[]; tags: string[] }>('/library/saved', { params: clean(params) })).data
export const fetchPrinciples = async (search?: string) =>
  (await api.get<{ principles: Principle[] }>('/library/principles', { params: clean({ search }) })).data.principles
export const fetchCaseReferences = async (caseId: string) =>
  (await api.get<{ references: CaseReference[] }>(`/library/cases/${caseId}/references`)).data.references

export const fetchPlatformStats = async () => (await api.get<{ stats: LibraryStats }>('/platform/library/stats')).data.stats
export const fetchImports = async () => (await api.get<{ imports: ImportRecord[] }>('/platform/library/imports')).data.imports
/** Sends the parsed file; with dryRun nothing is saved and the summary is the preview. */
export const importFile = async (file: unknown, { dryRun, fileName }: { dryRun: boolean; fileName: string }) =>
  (await api.post<{ dry_run: boolean; summary: ImportSummary }>('/platform/library/import', file, { params: { dryRun: String(dryRun), fileName } })).data

/* ───────────── hooks ───────────── */

const KEY = 'legal-library'

export const useLibrarySearch = (params: SearchParams | null) =>
  useQuery({
    queryKey: [KEY, 'search', params],
    enabled: params !== null && params.q.trim().length >= 2,
    queryFn: () => searchLibrary(params!),
    placeholderData: keepPreviousData,
  })

export const useLibraryStats = () => useQuery({ queryKey: [KEY, 'stats'], queryFn: fetchStats, staleTime: 5 * 60_000 })
export const useLaw = (lawId: string) => useQuery({ queryKey: [KEY, 'law', lawId], queryFn: () => fetchLaw(lawId) })
export const useArticle = (articleId: string | null) =>
  useQuery({ queryKey: [KEY, 'article', articleId], enabled: articleId !== null, queryFn: () => fetchArticle(articleId!) })
export const useRuling = (rulingId: string) => useQuery({ queryKey: [KEY, 'ruling', rulingId], queryFn: () => fetchRuling(rulingId) })
export const useGazette = (year?: number) => useQuery({ queryKey: [KEY, 'gazette', year ?? null], queryFn: () => fetchGazette(year) })
export const useGazetteIssue = (issueId: string | null) =>
  useQuery({ queryKey: [KEY, 'gazette-issue', issueId], enabled: issueId !== null, queryFn: () => fetchGazetteIssue(issueId!) })
export const useSaved = (params: { type?: 'articles' | 'rulings'; tag?: string } = {}) =>
  useQuery({ queryKey: [KEY, 'saved', params], queryFn: () => fetchSaved(params) })
export const usePrinciples = (search?: string) => useQuery({ queryKey: [KEY, 'principles', search ?? ''], queryFn: () => fetchPrinciples(search) })
export const useCaseReferences = (caseId: string) => useQuery({ queryKey: [KEY, 'case', caseId], queryFn: () => fetchCaseReferences(caseId) })
export const usePlatformLibrary = () =>
  useQuery({ queryKey: [KEY, 'platform'], queryFn: async () => ({ stats: await fetchPlatformStats(), imports: await fetchImports() }) })

/** Every library mutation refreshes every library view: saved flags appear on search results too. */
const useLibraryMutation = <Input, Output>(run: (input: Input) => Promise<Output>) => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: run, onSettled: () => queryClient.invalidateQueries({ queryKey: [KEY] }) })
}

export const useSaveItem = () =>
  useLibraryMutation((input: LibraryTarget & { note?: string | null; tags?: string[] }) => api.post<{ item: SavedItem }>('/library/saved', input))
export const useUpdateSavedItem = () =>
  useLibraryMutation(({ itemId, ...patch }: { itemId: string; note?: string | null; tags?: string[] }) => api.patch(`/library/saved/${itemId}`, patch))
export const useRemoveSavedItem = () => useLibraryMutation((itemId: string) => api.delete(`/library/saved/${itemId}`))

export const useSavePrinciple = () =>
  useLibraryMutation(({ principleId, ...input }: { principleId?: string; title: string; body: string; tags: string[] }) =>
    principleId ? api.patch(`/library/principles/${principleId}`, input) : api.post('/library/principles', input),
  )
export const useRemovePrinciple = () => useLibraryMutation((principleId: string) => api.delete(`/library/principles/${principleId}`))

export const useLinkToCase = () =>
  useLibraryMutation(({ caseId, ...input }: LibraryTarget & { caseId: string; note?: string | null }) => api.post(`/library/cases/${caseId}/references`, input))
export const useUnlinkFromCase = () =>
  useLibraryMutation(({ caseId, referenceId }: { caseId: string; referenceId: string }) => api.delete(`/library/cases/${caseId}/references/${referenceId}`))

export const useImportFile = () => useLibraryMutation((input: { file: unknown; dryRun: boolean; fileName: string }) => importFile(input.file, input))
