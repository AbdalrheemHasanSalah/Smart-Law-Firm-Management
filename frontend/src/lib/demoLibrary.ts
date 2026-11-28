/**
 * The legal library in demo mode: a handful of clearly fictional laws and rulings (every text says
 * «نص تجريبي مصطنع»), so the screens can be tried without importing real data. Nothing here is real
 * law. The search mimics the server's: normalized words, everyday phrases mapped to legal terms,
 * repealed texts hidden unless asked.
 */
import type {
  AppliedArticle,
  Article,
  CaseReference,
  GazetteIssue,
  GazetteItem,
  ImportRecord,
  Law,
  Principle,
  Ruling,
  SavedItem,
} from './legalLibrary'
import { mentionsAny, normalizeArabic, searchStems } from './legalText'

type DemoActor = { user_id: string; full_name: string; role: string | null }
type Helpers = {
  fail: (status: number, code: string, extra?: object) => Error
  uid: (prefix: string) => string
  /** Throws NOT_FOUND when the user cannot open the case. */
  caseFor: (user: never, caseId: string) => unknown
}
type Ctx = { user: DemoActor; params: string[]; query: Record<string, unknown>; body: Record<string, unknown> }

const SAMPLE = 'نص تجريبي مصطنع لأغراض العرض فقط: '

const laws: (Law & { articles: Omit<Article, 'law' | 'saved_item_id' | 'current' | 'ruling_count'>[] })[] = [
  {
    law_id: 'law-rent', title: 'قانون تجريبي بشأن إيجار العقارات', law_number: '1', law_year: 2020, law_kind: 'law', jurisdiction: 'ps',
    status: 'in_force', status_note: null, published_on: '2020-01-15', source_url: null,
    gazette_issue: { issue_id: 'gz-1', issue_number: 1, published_on: '2020-01-15' },
    articles: [
      { article_id: 'art-rent-1', article_number: '1', status: 'in_force', note: null, body: `${SAMPLE}تسري أحكام هذا القانون التجريبي على عقود إيجار العقارات المعدّة للسكن أو للتجارة.` },
      { article_id: 'art-rent-2', article_number: '2', status: 'in_force', note: null, body: `${SAMPLE}إذا تخلف المستأجر عن دفع الأجرة مدة ثلاثة أشهر بعد إنذاره، جاز للمؤجر أن يطلب إخلاء المأجور. وتُقدَّم دعوى الإخلاء خلال ستين يوماً من تاريخ الإنذار.` },
      { article_id: 'art-rent-3', article_number: '3', status: 'amended', note: 'عُدّلت بقانون تجريبي لاحق (مثال).', body: `${SAMPLE}يعاقب بغرامة لا تزيد على مائة دينار كل مؤجر قطع الماء أو الكهرباء عن المأجور لإكراه المستأجر على الإخلاء.` },
      { article_id: 'art-rent-4', article_number: '4', status: 'repealed', note: 'ألغيت (مثال).', body: `${SAMPLE}للمؤجر أن يزيد الأجرة كل سنة بما لا يتجاوز عشرة في المائة.` },
    ],
  },
  {
    law_id: 'law-labour', title: 'قانون تجريبي بشأن العمل', law_number: '3', law_year: 2019, law_kind: 'law', jurisdiction: 'ps',
    status: 'in_force', status_note: null, published_on: '2019-06-01', source_url: null, gazette_issue: { issue_id: 'gz-0', issue_number: 7, published_on: '2019-06-01' },
    articles: [
      { article_id: 'art-lab-1', article_number: '10', status: 'in_force', note: null, body: `${SAMPLE}لا يجوز لصاحب العمل إنهاء عقد العمل دون إشعار العامل كتابياً قبل شهر من تاريخ الإنهاء.` },
      { article_id: 'art-lab-2', article_number: '11', status: 'in_force', note: null, body: `${SAMPLE}يستحق العامل الذي فُصل فصلاً تعسفياً تعويضاً عن كل سنة من سنوات خدمته، ومكافأة نهاية الخدمة.` },
    ],
  },
  {
    law_id: 'law-old-rent', title: 'قانون تجريبي قديم بشأن الإيجار', law_number: '9', law_year: 1990, law_kind: 'law', jurisdiction: 'ps',
    status: 'repealed', status_note: 'أُلغي بالقانون التجريبي بشأن إيجار العقارات (مثال).', published_on: null, source_url: null, gazette_issue: null,
    articles: [{ article_id: 'art-old-1', article_number: '5', status: 'in_force', note: null, body: `${SAMPLE}للمؤجر طلب إخلاء المستأجر إذا تأخر في دفع الأجرة شهراً واحداً.` }],
  },
  {
    law_id: 'law-jo-cheque', title: 'قانون تجريبي أردني بشأن الشيكات', law_number: '12', law_year: 2018, law_kind: 'law', jurisdiction: 'jo',
    status: 'in_force', status_note: null, published_on: null, source_url: null, gazette_issue: null,
    articles: [{ article_id: 'art-jo-1', article_number: '4', status: 'in_force', note: null, body: `${SAMPLE}يعاقب بالحبس أو بالغرامة من أصدر شيكاً ليس له مقابل وفاء قائم وقابل للصرف.` }],
  },
]

const rulings: (Omit<Ruling, 'applied_articles' | 'saved_item_id'> & { body: string; article_ids: string[] })[] = [
  {
    ruling_id: 'rul-1', jurisdiction: 'ps', court_level: 'cassation', court_name: 'محكمة نقض تجريبية', case_number: '15/2021', ruling_year: 2021, decided_on: '2021-03-01',
    subject: 'إخلاء مأجور لعدم دفع الأجرة (حكم تجريبي)', summary: 'مثال مصطنع: تخلّف المستأجر عن دفع الأجرة ثلاثة أشهر بعد الإنذار يجيز الإخلاء.',
    body: `${SAMPLE}أقام المدعي دعواه طالباً إخلاء المأجور لتخلف المستأجر عن دفع الأجرة. وحيث ثبت إنذار المستأجر وعدم وفائه خلال المدة، فإن طلب الإخلاء في محله. لذلك حكمت المحكمة بإخلاء المأجور.`,
    article_ids: ['art-rent-2'],
  },
  {
    ruling_id: 'rul-2', jurisdiction: 'ps', court_level: 'appeal', court_name: 'محكمة استئناف تجريبية', case_number: '88/2022', ruling_year: 2022, decided_on: '2022-11-20',
    subject: 'فصل تعسفي ومكافأة نهاية الخدمة (حكم تجريبي)', summary: null,
    body: `${SAMPLE}ثبت للمحكمة أن صاحب العمل أنهى العقد دون إشعار، فيكون الفصل تعسفياً ويستحق العامل التعويض ومكافأة نهاية الخدمة.`,
    article_ids: ['art-lab-1', 'art-lab-2'],
  },
]

const synonyms: { phrase: string; terms: string[] }[] = [
  { phrase: 'ما دفع الإيجار', terms: ['التخلف عن دفع الأجرة'] },
  { phrase: 'طلعه من البيت', terms: ['الإخلاء'] },
  { phrase: 'انطرد من الشغل', terms: ['فصل تعسفي', 'إنهاء عقد العمل'] },
  { phrase: 'شيك راجع', terms: ['شيك ليس له مقابل وفاء'] },
].map((entry) => ({ phrase: normalizeArabic(entry.phrase), terms: entry.terms }))

const gazette: (GazetteIssue & { items: GazetteItem[] })[] = [
  { issue_id: 'gz-1', issue_number: 1, published_on: '2020-01-15', items: [
    { position: 0, title: 'قانون تجريبي بشأن إيجار العقارات', law_id: 'law-rent', law_status: 'in_force' },
    { position: 1, title: 'قرار تجريبي بتشكيل لجنة (مثال)', law_id: null, law_status: null },
  ] },
  { issue_id: 'gz-0', issue_number: 7, published_on: '2019-06-01', items: [{ position: 0, title: 'قانون تجريبي بشأن العمل', law_id: 'law-labour', law_status: 'in_force' }] },
]

type DemoSaved = { item_id: string; article_id: string | null; ruling_id: string | null; note: string | null; tags: string[]; created_at: string; updated_at: string; created_by: { user_id: string; full_name: string } }
const saved: DemoSaved[] = []
const principles: Principle[] = []
type DemoReference = { reference_id: string; case_id: string; article_id: string | null; ruling_id: string | null; note: string | null; created_at: string; linked_by: { user_id: string; full_name: string } }
const references: DemoReference[] = []
const imports: ImportRecord[] = []

/* ───────────── shapes ───────────── */

const allArticles = () => laws.flatMap((law) => law.articles.map((article) => ({ article, law })))
const findArticle = (articleId: string) => allArticles().find((entry) => entry.article.article_id === articleId)
const summaryOf = (law: Law) => ({ law_id: law.law_id, title: law.title, law_number: law.law_number, law_year: law.law_year, law_kind: law.law_kind, jurisdiction: law.jurisdiction, status: law.status })
const savedIdOf = (target: { article_id?: string; ruling_id?: string }) =>
  saved.find((item) => (target.article_id && item.article_id === target.article_id) || (target.ruling_id && item.ruling_id === target.ruling_id))?.item_id ?? null

const articleOut = ({ article, law }: { article: (typeof laws)[number]['articles'][number]; law: Law }): Article => ({
  ...article,
  current: article.status !== 'repealed' && law.status !== 'repealed',
  law: summaryOf(law),
  ruling_count: rulings.filter((ruling) => ruling.article_ids.includes(article.article_id)).length,
  saved_item_id: savedIdOf({ article_id: article.article_id }),
})

const appliedOf = (ids: string[]): AppliedArticle[] =>
  ids.flatMap((id) => {
    const found = findArticle(id)
    return found ? [{ article_id: id, article_number: found.article.article_number, law_id: found.law.law_id, law_title: found.law.title, status: found.article.status, law_status: found.law.status }] : []
  })

const rulingOut = (ruling: (typeof rulings)[number], full = false): Ruling => {
  const { body, article_ids: articleIds, ...rest } = ruling
  return { ...rest, ...(full ? { body } : { preview: ruling.summary ? null : body.slice(0, 400) }), applied_articles: appliedOf(articleIds), saved_item_id: savedIdOf({ ruling_id: ruling.ruling_id }) }
}

const lawOut = (law: (typeof laws)[number]): Law => {
  const { articles, ...rest } = law
  return { ...rest, article_count: articles.length }
}

const savedOut = (item: DemoSaved): SavedItem => {
  const found = item.article_id ? findArticle(item.article_id) : undefined
  const ruling = item.ruling_id ? rulings.find((entry) => entry.ruling_id === item.ruling_id) : undefined
  return {
    item_id: item.item_id, note: item.note, tags: item.tags, created_at: item.created_at, updated_at: item.updated_at, created_by: item.created_by,
    article: found ? { article_id: found.article.article_id, article_number: found.article.article_number, body: found.article.body, status: found.article.status, current: found.article.status !== 'repealed' && found.law.status !== 'repealed', law: summaryOf(found.law) } : null,
    ruling: ruling ? { ruling_id: ruling.ruling_id, court_level: ruling.court_level, court_name: ruling.court_name, case_number: ruling.case_number, ruling_year: ruling.ruling_year, decided_on: ruling.decided_on, subject: ruling.subject, jurisdiction: ruling.jurisdiction } : null,
  }
}

const referenceOut = (reference: DemoReference): CaseReference => {
  const { article, ruling } = savedOut({ ...reference, item_id: reference.reference_id, tags: [], updated_at: reference.created_at, created_by: reference.linked_by })
  const { jurisdiction: _jurisdiction, ...rulingRest } = ruling ?? ({} as NonNullable<SavedItem['ruling']>)
  return { reference_id: reference.reference_id, note: reference.note, created_at: reference.created_at, linked_by: reference.linked_by, article, ruling: ruling ? rulingRest : null }
}

/** Same as the server's: exactly one of article_id or ruling_id, and it must exist. */
const targetOf = (body: Record<string, unknown>, fail: Helpers['fail']) => {
  const articleId = typeof body.article_id === 'string' ? body.article_id : null
  const rulingId = typeof body.ruling_id === 'string' ? body.ruling_id : null
  if ((articleId === null) === (rulingId === null)) throw fail(400, 'VALIDATION')
  if (articleId && !findArticle(articleId)) throw fail(404, 'NOT_FOUND')
  if (rulingId && !rulings.some((ruling) => ruling.ruling_id === rulingId)) throw fail(404, 'NOT_FOUND')
  return { article_id: articleId, ruling_id: rulingId }
}

const canChange = (user: DemoActor, ownerId: string) => user.role === 'admin' || user.user_id === ownerId

/* ───────────── routes ───────────── */

type Handler = (ctx: Ctx) => unknown
type LibraryRoute = [method: string, pattern: RegExp, roles: readonly string[], handler: Handler]

export const libraryRoutes = ({ fail, uid, caseFor }: Helpers): LibraryRoute[] => {
  const STAFF = ['admin', 'lawyer', 'assistant'] as const
  const now = () => new Date().toISOString()
  return [
    ['get', /^\/library\/stats$/, STAFF, () => ({
      stats: {
        ps_laws: laws.filter((law) => law.jurisdiction === 'ps').length,
        ps_rulings: rulings.filter((ruling) => ruling.jurisdiction === 'ps').length,
        gazette_issues: gazette.length,
        comparative: laws.filter((law) => law.jurisdiction !== 'ps').length + rulings.filter((ruling) => ruling.jurisdiction !== 'ps').length,
        articles: allArticles().length,
      },
    })],
    ['get', /^\/library\/search$/, STAFF, ({ query }) => {
      const q = String(query.q ?? '').trim()
      if (q.length < 2) throw fail(400, 'VALIDATION')
      const normalized = normalizeArabic(q)
      const mapped = synonyms.filter((entry) => normalized.includes(entry.phrase))
      const stems = searchStems([q, ...mapped.flatMap((entry) => entry.terms)].join(' '))
      const jurisdiction = query.jurisdiction as string | undefined
      const type = (query.type as string | undefined) ?? 'all'
      const includeRepealed = query.includeRepealed === 'true'
      const matching = allArticles().filter(({ article, law }) => (!jurisdiction || law.jurisdiction === jurisdiction) && mentionsAny(article.body, stems))
      const current = ({ article, law }: (typeof matching)[number]) => article.status !== 'repealed' && law.status !== 'repealed'
      const articles = type === 'all' || type === 'articles' ? matching.filter((entry) => includeRepealed || current(entry)).map(articleOut) : []
      return {
        query: q,
        mapped_terms: mapped,
        articles,
        rulings: type === 'all' || type === 'rulings' ? rulings.filter((ruling) => (!jurisdiction || ruling.jurisdiction === jurisdiction) && mentionsAny(`${ruling.subject ?? ''} ${ruling.summary ?? ''} ${ruling.body}`, stems)).map((ruling) => rulingOut(ruling)) : [],
        laws: type === 'all' || type === 'laws' ? laws.filter((law) => (!jurisdiction || law.jurisdiction === jurisdiction) && mentionsAny(law.title, stems)).map(lawOut) : [],
        hidden_repealed: includeRepealed || !(type === 'all' || type === 'articles') ? 0 : matching.filter((entry) => !current(entry)).length,
      }
    }],
    ['get', /^\/library\/laws\/([^/]+)$/, STAFF, ({ params }) => {
      const law = laws.find((entry) => entry.law_id === params[0])
      if (!law) throw fail(404, 'NOT_FOUND')
      return { law: lawOut(law), articles: law.articles.map((article) => articleOut({ article, law })) }
    }],
    ['get', /^\/library\/articles\/([^/]+)$/, STAFF, ({ params }) => {
      const found = findArticle(params[0]!)
      if (!found) throw fail(404, 'NOT_FOUND')
      const sentences = found.article.body.split(/(?<=[.؛\n])\s*/).map((part) => part.trim()).filter(Boolean)
      return {
        article: {
          ...articleOut(found),
          quoted_periods: sentences.filter((sentence) => /(يوما|يوماً|أيام|شهر|أشهر|سنة|سنوات)/.test(sentence)),
          quoted_penalties: sentences.filter((sentence) => /(يعاقب|بالحبس|بالغرامة|عقوبة)/.test(sentence)),
        },
        rulings: rulings.filter((ruling) => ruling.article_ids.includes(found.article.article_id)).map((ruling) => rulingOut(ruling)),
      }
    }],
    ['get', /^\/library\/rulings\/([^/]+)$/, STAFF, ({ params }) => {
      const ruling = rulings.find((entry) => entry.ruling_id === params[0])
      if (!ruling) throw fail(404, 'NOT_FOUND')
      return { ruling: rulingOut(ruling, true) }
    }],
    ['get', /^\/library\/gazette$/, STAFF, ({ query }) => {
      const years = [...new Set(gazette.map((issue) => Number(issue.published_on!.slice(0, 4))))].sort((a, b) => b - a)
      const year = query.year ? Number(query.year) : years[0] ?? null
      return { years, year, issues: gazette.filter((issue) => Number(issue.published_on!.slice(0, 4)) === year).map(({ items, ...issue }) => ({ ...issue, item_count: items.length })) }
    }],
    ['get', /^\/library\/gazette\/([^/]+)$/, STAFF, ({ params }) => {
      const issue = gazette.find((entry) => entry.issue_id === params[0])
      if (!issue) throw fail(404, 'NOT_FOUND')
      return { issue }
    }],

    ['get', /^\/library\/saved$/, STAFF, ({ query }) => {
      const rows = saved.filter((item) =>
        (query.type !== 'articles' || item.article_id) && (query.type !== 'rulings' || item.ruling_id) && (!query.tag || item.tags.includes(String(query.tag))))
      return { items: rows.map(savedOut), tags: [...new Set(saved.flatMap((item) => item.tags))].sort() }
    }],
    ['post', /^\/library\/saved$/, STAFF, ({ user, body }) => {
      const target = targetOf(body, fail)
      if (savedIdOf({ article_id: target.article_id ?? undefined, ruling_id: target.ruling_id ?? undefined })) throw fail(409, 'ALREADY_SAVED')
      const item: DemoSaved = { item_id: uid('lib'), ...target, note: (body.note as string) || null, tags: (body.tags as string[]) ?? [], created_at: now(), updated_at: now(), created_by: { user_id: user.user_id, full_name: user.full_name } }
      saved.unshift(item)
      return { item: savedOut(item) }
    }],
    ['patch', /^\/library\/saved\/([^/]+)$/, STAFF, ({ user, params, body }) => {
      const item = saved.find((entry) => entry.item_id === params[0])
      if (!item) throw fail(404, 'NOT_FOUND')
      if (!canChange(user, item.created_by.user_id)) throw fail(403, 'FORBIDDEN')
      if (body.note !== undefined) item.note = (body.note as string) || null
      if (body.tags !== undefined) item.tags = body.tags as string[]
      item.updated_at = now()
      return { item: savedOut(item) }
    }],
    ['delete', /^\/library\/saved\/([^/]+)$/, STAFF, ({ user, params }) => {
      const index = saved.findIndex((entry) => entry.item_id === params[0])
      if (index < 0) throw fail(404, 'NOT_FOUND')
      if (!canChange(user, saved[index]!.created_by.user_id)) throw fail(403, 'FORBIDDEN')
      saved.splice(index, 1)
      return { removed: true }
    }],

    ['get', /^\/library\/principles$/, STAFF, ({ query }) => {
      const search = String(query.search ?? '').trim()
      return { principles: principles.filter((entry) => !search || `${entry.title} ${entry.body}`.includes(search)) }
    }],
    ['post', /^\/library\/principles$/, STAFF, ({ user, body }) => {
      if (!String(body.title ?? '').trim() || !String(body.body ?? '').trim()) throw fail(400, 'VALIDATION')
      const row: Principle = { principle_id: uid('pr'), title: String(body.title).trim(), body: String(body.body).trim(), tags: (body.tags as string[]) ?? [], created_at: now(), updated_at: now(), created_by: { user_id: user.user_id, full_name: user.full_name } }
      principles.unshift(row)
      return { principle: row }
    }],
    ['patch', /^\/library\/principles\/([^/]+)$/, STAFF, ({ user, params, body }) => {
      const row = principles.find((entry) => entry.principle_id === params[0])
      if (!row) throw fail(404, 'NOT_FOUND')
      if (!canChange(user, row.created_by.user_id)) throw fail(403, 'FORBIDDEN')
      Object.assign(row, { ...(body.title !== undefined ? { title: String(body.title).trim() } : {}), ...(body.body !== undefined ? { body: String(body.body).trim() } : {}), ...(body.tags !== undefined ? { tags: body.tags } : {}), updated_at: now() })
      return { principle: row }
    }],
    ['delete', /^\/library\/principles\/([^/]+)$/, STAFF, ({ user, params }) => {
      const index = principles.findIndex((entry) => entry.principle_id === params[0])
      if (index < 0) throw fail(404, 'NOT_FOUND')
      if (!canChange(user, principles[index]!.created_by.user_id)) throw fail(403, 'FORBIDDEN')
      principles.splice(index, 1)
      return { removed: true }
    }],

    ['get', /^\/library\/cases\/([^/]+)\/references$/, STAFF, ({ user, params }) => {
      caseFor(user as never, params[0]!)
      return { references: references.filter((entry) => entry.case_id === params[0]).map(referenceOut) }
    }],
    ['post', /^\/library\/cases\/([^/]+)\/references$/, STAFF, ({ user, params, body }) => {
      caseFor(user as never, params[0]!)
      const target = targetOf(body, fail)
      if (references.some((entry) => entry.case_id === params[0] && ((target.article_id && entry.article_id === target.article_id) || (target.ruling_id && entry.ruling_id === target.ruling_id)))) {
        throw fail(409, 'ALREADY_LINKED')
      }
      const row: DemoReference = { reference_id: uid('ref'), case_id: params[0]!, ...target, note: (body.note as string) || null, created_at: now(), linked_by: { user_id: user.user_id, full_name: user.full_name } }
      references.unshift(row)
      return { reference: referenceOut(row) }
    }],
    ['delete', /^\/library\/cases\/([^/]+)\/references\/([^/]+)$/, STAFF, ({ user, params }) => {
      caseFor(user as never, params[0]!)
      const index = references.findIndex((entry) => entry.case_id === params[0] && entry.reference_id === params[1])
      if (index < 0) throw fail(404, 'NOT_FOUND')
      references.splice(index, 1)
      return { removed: true }
    }],

    ['get', /^\/platform\/library\/stats$/, ['platform'], () => ({
      stats: { ps_laws: laws.filter((law) => law.jurisdiction === 'ps').length, ps_rulings: rulings.length, gazette_issues: gazette.length, comparative: 1, articles: allArticles().length },
    })],
    ['get', /^\/platform\/library\/imports$/, ['platform'], () => ({ imports })],
    /** Demo mode checks only the outline of the file; the real server checks every field. */
    ['post', /^\/platform\/library\/import$/, ['platform'], ({ query, body }) => {
      const count = (key: string) => (Array.isArray(body[key]) ? (body[key] as unknown[]).length : 0)
      const unknown = Object.keys(body).filter((key) => !['laws', 'rulings', 'gazette', 'synonyms', 'format'].includes(key))
      if (unknown.length || count('laws') + count('rulings') + count('gazette') + count('synonyms') === 0) {
        throw fail(400, 'IMPORT_INVALID', { errors: unknown.length ? unknown.map((path) => ({ path, message: 'is not a known section' })) : [{ path: '$', message: 'has nothing to import' }] })
      }
      const articles = Array.isArray(body.laws) ? (body.laws as { articles?: unknown[] }[]).reduce((sum, law) => sum + (law.articles?.length ?? 0), 0) : 0
      const summary = {
        gazette: { added: count('gazette'), updated: 0 }, laws: { added: count('laws'), updated: 0 }, articles: { added: articles, updated: 0 },
        rulings: { added: count('rulings'), updated: 0 }, synonyms: { added: count('synonyms'), updated: 0 },
        articles_kept_not_in_file: 0, ruling_links: 0, warnings: ['وضع التجربة: لم يُحفظ شيء فعلياً، والأعداد تقديرية من شكل الملف.'],
      }
      const dryRun = query.dryRun === 'true'
      if (!dryRun) imports.unshift({ import_id: uid('imp'), file_name: (query.fileName as string) || null, summary, created_at: now(), imported_by_name: 'مدير المنصّة' })
      return { dry_run: dryRun, summary }
    }],
  ]
}
