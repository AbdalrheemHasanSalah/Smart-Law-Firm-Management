import { AlertTriangle, BookMarked, BookOpen, Bookmark, BookmarkCheck, ExternalLink, Gavel, Link2, Newspaper, Plus, Quote, Search, Trash2 } from 'lucide-react'
import { appendText } from '@/lib/voice'
import { DictateButton } from '@/ui/Voice'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { PATHS, useAuth } from '@/auth/auth'
import { messageOf } from '@/lib/api'
import { formatDate } from '@/lib/labels'
import {
  JURISDICTION,
  COURT_LEVEL,
  LAW_KIND,
  SEARCH_TYPES,
  TEXT_STATUS,
  articlesCount,
  hiddenRepealedNote,
  itemsCount,
  lawCitation,
  parseTags,
  rulingCitation,
  useArticle,
  useCaseReferences,
  useGazette,
  useGazetteIssue,
  useLaw,
  useLibrarySearch,
  useLibraryStats,
  useLinkToCase,
  usePrinciples,
  useRemovePrinciple,
  useRemoveSavedItem,
  useRuling,
  useSaved,
  useSaveItem,
  useSavePrinciple,
  useUnlinkFromCase,
  useUpdateSavedItem,
  type Article,
  type Jurisdiction,
  type LibraryTarget,
  type Principle,
  type Ruling,
  type SavedItem,
  type SearchParams,
  type SearchType,
  type TextStatus,
} from '@/lib/legalLibrary'
import { oneOf, useParam } from '@/lib/useParam'
import { FormActions, Modal, SelectField, TextArea } from '@/ui/forms'
import { Button, cn, Field } from '@/ui/kit'
import { Empty, Failed, Loading, Pill, SheetHeader } from '@/ui/Shell'
import { useCases } from './Office'

/* ───────────────────────── shared pieces ───────────────────────── */

const LINK = 'text-xs font-semibold underline-offset-4 hover:underline disabled:opacity-50'
const BASE = `${PATHS.office}/library`
const lawPath = (lawId: string) => `${BASE}/laws/${lawId}`
const rulingPath = (rulingId: string) => `${BASE}/rulings/${rulingId}`

const useMe = () => {
  const session = useAuth().session
  return { userId: session?.user.user_id, admin: session?.active_office?.role === 'admin' }
}

const StatusPill = ({ status }: { status: TextStatus }) => <Pill tone={TEXT_STATUS[status].tone}>{TEXT_STATUS[status].text}</Pill>

/** Shown on every legal text: what it is for, and that it must be checked. */
const Caution = () => (
  <p className="text-xs leading-relaxed text-ink-faint">
    النصوص معروضة كما استُوردت إلى المكتبة. راجع الجريدة الرسمية ونص القانون النافذ قبل الاعتماد على أي منها.
  </p>
)

/** A plain warning that a text is not in force, never a silent label. */
const NotCurrent = ({ article }: { article: Pick<Article, 'status' | 'current'> & { law: { status: TextStatus } } }) =>
  article.current ? null : (
    <p role="note" className="flex items-center gap-2 rounded-md border border-stamp/40 bg-stamp/5 px-3 py-1.5 text-xs font-semibold text-stamp">
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
      {article.law.status === 'repealed' ? 'هذا القانون ملغى: لا يُعتمد على مواده.' : 'هذه المادة ملغاة: لا يُعتمد عليها.'}
    </p>
  )

/** The article text as stored, keeping its line breaks. */
const LegalText = ({ text, className }: { text: string; className?: string }) => (
  <p data-no-translate className={cn('font-doc leading-loose whitespace-pre-line text-ink', className)} dir="rtl">{text}</p>
)

/** Save to the office library, or remove from it, with a note and tags on the first save. */
const SaveButton = ({ target, savedItemId }: { target: LibraryTarget; savedItemId: string | null }) => {
  const [open, setOpen] = useState(false)
  const remove = useRemoveSavedItem()
  if (savedItemId) {
    return (
      <button type="button" onClick={() => remove.mutate(savedItemId)} disabled={remove.isPending} className={cn(LINK, 'inline-flex items-center gap-1 text-stamp-green')} title="إزالة من مكتبة المكتب">
        <BookmarkCheck className="size-4" aria-hidden="true" />
        محفوظ
      </button>
    )
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(LINK, 'inline-flex items-center gap-1 text-stamp-blue')}>
        <Bookmark className="size-4" aria-hidden="true" />
        احفظ للمكتب
      </button>
      <SaveDialog open={open} onClose={() => setOpen(false)} target={target} />
    </>
  )
}

const SaveDialog = ({ open, onClose, target }: { open: boolean; onClose: () => void; target: LibraryTarget }) => {
  const save = useSaveItem()
  const [note, setNote] = useState('')
  const [tags, setTags] = useState('')
  useEffect(() => {
    if (!open) return
    save.reset()
    setNote('')
    setTags('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate({ ...target, note: note.trim() || null, tags: parseTags(tags) }, { onSuccess: onClose })
  }
  return (
    <Modal open={open} onClose={onClose} title="حفظ في مكتبة المكتب">
      <form onSubmit={submit} className="space-y-4">
        <TextArea label="ملاحظة (اختياري)" name="library_note" placeholder="متى يفيد هذا النص، وفي أي ملفات…" value={note} onChange={(event) => setNote(event.target.value)} />
        <Field label="الوسوم (اختياري)" name="library_tags" placeholder="إيجار، إخلاء" hint="افصل بينها بفاصلة" value={tags} onChange={(event) => setTags(event.target.value)} />
        <FormActions error={save.isError ? messageOf(save.error) : null}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="ink" disabled={save.isPending}>{save.isPending ? 'يُحفظ…' : 'احفظ'}</Button>
        </FormActions>
      </form>
    </Modal>
  )
}

/** Links an article or ruling to one of the cases the user can open. */
const LinkButton = ({ target, presetCaseId }: { target: LibraryTarget; presetCaseId?: string }) => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(LINK, 'inline-flex items-center gap-1 text-stamp-blue')}>
        <Link2 className="size-4" aria-hidden="true" />
        اربط بقضية
      </button>
      <LinkDialog open={open} onClose={() => setOpen(false)} target={target} presetCaseId={presetCaseId} />
    </>
  )
}

const LinkDialog = ({ open, onClose, target, presetCaseId }: { open: boolean; onClose: () => void; target: LibraryTarget; presetCaseId?: string }) => {
  const cases = useCases()
  const link = useLinkToCase()
  const [caseId, setCaseId] = useState(presetCaseId ?? '')
  const [note, setNote] = useState('')
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!open) return
    link.reset()
    setCaseId(presetCaseId ?? '')
    setNote('')
    setDone(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    link.mutate({ ...target, caseId, note: note.trim() || null }, { onSuccess: () => setDone(true) })
  }
  return (
    <Modal open={open} onClose={onClose} title="ربط بقضية">
      {done ? (
        <div className="space-y-4">
          <p className="text-ink">رُبط المرجع بالقضية، ويظهر في تبويب «المراجع القانونية» في ملفها.</p>
          <FormActions>
            <Link to={`${PATHS.office}/cases/${caseId}?tab=library`} className={cn(LINK, 'text-sm text-stamp-blue')}>افتح القضية</Link>
            <Button variant="ink" onClick={onClose}>تم</Button>
          </FormActions>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <SelectField
            label="القضية"
            name="library_case"
            required
            value={caseId}
            onChange={(event) => setCaseId(event.target.value)}
            options={[['', cases.isPending ? 'يُحمَّل…' : 'اختر قضية'], ...(cases.data ?? []).map((entry) => [entry.case_id, `${entry.case_number} — ${entry.title}`] as const)]}
          />
          <TextArea label="ملاحظة (اختياري)" name="library_case_note" placeholder="لماذا يفيد هذا المرجع في القضية…" value={note} onChange={(event) => setNote(event.target.value)} />
          <FormActions error={link.isError ? messageOf(link.error) : null}>
            <Button variant="line" onClick={onClose}>إلغاء</Button>
            <Button type="submit" variant="ink" disabled={!caseId || link.isPending}>{link.isPending ? 'يُربط…' : 'اربط'}</Button>
          </FormActions>
        </form>
      )}
    </Modal>
  )
}

/**
 * Court, case number and date. A court's own name is a record and stays as written; the court
 * level label (used when there is no name) is interface text and is translated.
 */
const RulingCitation = ({ ruling, className = 'text-sm text-ink-soft' }: {
  ruling: Pick<Ruling, 'court_level' | 'court_name' | 'case_number' | 'decided_on' | 'ruling_year'>
  className?: string
}) => {
  const parts = [
    ruling.court_name ? <span key="court" data-no-translate>{ruling.court_name}</span> : <span key="court">{COURT_LEVEL[ruling.court_level]}</span>,
    ruling.case_number ? <bdi key="number" dir="ltr">{ruling.case_number}</bdi> : null,
    ruling.decided_on ? <span key="date">{formatDate(ruling.decided_on)}</span> : ruling.ruling_year ? <span key="year">{ruling.ruling_year}</span> : null,
  ].filter(Boolean)
  return (
    <p className={className}>
      {parts.map((part, index) => (
        <span key={index}>{index > 0 && ' · '}{part}</span>
      ))}
    </p>
  )
}

/** A record's title (a law or ruling name): shown as written, never translated. */
const Title = ({ children }: { children: ReactNode }) => <span data-no-translate>{children}</span>

/* ───────────────────────── article and ruling cards ───────────────────────── */

const ArticleCard = ({ article, onOpen, showLaw = true }: { article: Article; onOpen: (articleId: string) => void; showLaw?: boolean }) => (
  <article className={cn('rounded-lg border border-rule bg-paper p-4', !article.current && 'opacity-80')}>
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="font-doc text-lg font-bold text-ink">المادة {article.article_number}</p>
        {showLaw && (
          <Link to={lawPath(article.law.law_id)} className="text-sm text-stamp-blue underline-offset-4 hover:underline">
            <Title>{article.law.title}</Title>
          </Link>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {article.law.jurisdiction && <Pill>{JURISDICTION[article.law.jurisdiction]}</Pill>}
        <StatusPill status={article.status} />
      </div>
    </header>
    <div className="mt-2 space-y-2">
      <NotCurrent article={article} />
      <LegalText text={article.body} className="line-clamp-6" />
      {article.note && <p className="text-xs text-ink-soft">ملاحظة: {article.note}</p>}
    </div>
    <footer className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule pt-2">
      <button type="button" onClick={() => onOpen(article.article_id)} className={cn(LINK, 'inline-flex items-center gap-1 text-ink')}>
        <Quote className="size-4" aria-hidden="true" />
        النص والأحكام{article.ruling_count ? ` (${article.ruling_count})` : ''}
      </button>
      <SaveButton target={{ article_id: article.article_id }} savedItemId={article.saved_item_id} />
      {article.current && <LinkButton target={{ article_id: article.article_id }} />}
    </footer>
  </article>
)

const RulingCard = ({ ruling }: { ruling: Ruling }) => (
  <article className="rounded-lg border border-rule bg-paper p-4">
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <Link to={rulingPath(ruling.ruling_id)} className="font-doc text-lg font-bold text-ink underline-offset-4 hover:underline">
          <Title>{ruling.subject ?? rulingCitation(ruling)}</Title>
        </Link>
        <RulingCitation ruling={ruling} />
      </div>
      <Pill>{JURISDICTION[ruling.jurisdiction]}</Pill>
    </header>
    {(ruling.summary ?? ruling.preview) && <LegalText text={(ruling.summary ?? ruling.preview)!} className="mt-2 line-clamp-4 text-sm" />}
    {ruling.applied_articles.length > 0 && (
      <p className="mt-2 text-xs text-ink-soft">
        طبّق:{' '}
        {ruling.applied_articles.map((entry, index) => (
          <span key={entry.article_id}>
            {index > 0 && '، '}
            <Link to={lawPath(entry.law_id)} className="text-stamp-blue underline-offset-4 hover:underline">{`المادة ${entry.article_number} من`} <Title>{entry.law_title}</Title></Link>
          </span>
        ))}
      </p>
    )}
    <footer className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule pt-2">
      <SaveButton target={{ ruling_id: ruling.ruling_id }} savedItemId={ruling.saved_item_id} />
      <LinkButton target={{ ruling_id: ruling.ruling_id }} />
    </footer>
  </article>
)

/** An article with what the text itself says about periods and penalties, and the rulings that applied it. */
const ArticleSheet = ({ articleId, onClose }: { articleId: string | null; onClose: () => void }) => {
  const detail = useArticle(articleId)
  const article = detail.data?.article
  return (
    <Modal open={articleId !== null} onClose={onClose} title={article ? `المادة ${article.article_number}` : 'المادة'} wide>
      {detail.isPending ? (
        <Loading />
      ) : detail.isError ? (
        <Failed error={detail.error} />
      ) : article ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={lawPath(article.law.law_id)} onClick={onClose} className="font-semibold text-stamp-blue underline-offset-4 hover:underline"><Title>{article.law.title}</Title></Link>
            <StatusPill status={article.status} />
          </div>
          <NotCurrent article={article} />
          <LegalText text={article.body} />
          {article.note && <p className="text-sm text-ink-soft">ملاحظة التعديل: {article.note}</p>}
          {(article.quoted_periods.length > 0 || article.quoted_penalties.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {article.quoted_periods.length > 0 && <QuoteBox title="المدد كما وردت في النص" quotes={article.quoted_periods} />}
              {article.quoted_penalties.length > 0 && <QuoteBox title="العقوبة كما وردت في النص" quotes={article.quoted_penalties} />}
            </div>
          )}
          <section>
            <h3 className="mb-2 text-lg text-ink">أحكام طبّقت هذه المادة</h3>
            {detail.data.rulings.length === 0 ? (
              <p className="text-sm text-ink-faint">لا أحكام مرتبطة بهذه المادة في المكتبة.</p>
            ) : (
              <ul className="space-y-2">
                {detail.data.rulings.map((ruling) => (
                  <li key={ruling.ruling_id}>
                    <Link to={rulingPath(ruling.ruling_id)} onClick={onClose} className="text-sm font-semibold text-stamp-blue underline-offset-4 hover:underline">
                      <Title>{ruling.subject ?? rulingCitation(ruling)}</Title>
                    </Link>
                    <RulingCitation ruling={ruling} className="text-xs text-ink-soft" />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <div className="flex flex-wrap items-center gap-4 border-t border-rule pt-3">
            <SaveButton target={{ article_id: article.article_id }} savedItemId={article.saved_item_id} />
            {article.current && <LinkButton target={{ article_id: article.article_id }} />}
          </div>
          <Caution />
        </div>
      ) : null}
    </Modal>
  )
}

const QuoteBox = ({ title, quotes }: { title: string; quotes: string[] }) => (
  <div className="rounded-md border border-ink/15 bg-marker/20 p-3">
    <p className="text-xs font-semibold text-ink-soft">{title}</p>
    <ul className="mt-1 space-y-1">
      {quotes.map((quote) => (
        <li key={quote} className="font-doc text-sm text-ink">«{quote}»</li>
      ))}
    </ul>
    <p className="mt-2 text-[0.7rem] text-ink-faint">منقولة حرفياً من المادة، دون أي حساب. احسب الموعد من تاريخ الحكم أو التبليغ بحسب النص.</p>
  </div>
)

/* ───────────────────────── search tab ───────────────────────── */

const EXAMPLES = ['المستأجر ما دفع الإيجار من ثلاثة أشهر', 'انطرد من الشغل بدون إشعار', 'شيك راجع من البنك']

const SearchTab = ({ onOpenArticle }: { onOpenArticle: (articleId: string) => void }) => {
  const [qParam, setQParam] = useParam('q')
  const [typeParam, setTypeParam] = useParam('type')
  const [jurisdictionParam, setJurisdictionParam] = useParam('country')
  const [repealedParam, setRepealedParam] = useParam('repealed')
  const [draft, setDraft] = useState(qParam ?? '')
  const type = oneOf(typeParam, SEARCH_TYPES.map(([key]) => key), 'all') as SearchType
  const jurisdiction = oneOf(jurisdictionParam, ['ps', 'jo', 'eg', ''] as const, '') || undefined
  const params: SearchParams | null = qParam ? { q: qParam, type, jurisdiction: jurisdiction as Jurisdiction | undefined, includeRepealed: repealedParam === '1' } : null
  const results = useLibrarySearch(params)
  useEffect(() => setDraft(qParam ?? ''), [qParam])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setQParam(draft.trim() || null)
  }
  const data = results.data
  const total = data ? data.articles.length + data.rulings.length + data.laws.length : 0

  return (
    <div className="space-y-5">
      <form onSubmit={submit} role="search" className="flex flex-wrap items-end gap-3">
        <Field
          label="اكتب المسألة كما يرويها الموكّل، أو بالمصطلح القانوني"
          name="library_q"
          className="min-w-64 flex-1"
          placeholder="مثلاً: المستأجر ما دفع الإيجار من ستة أشهر"
          value={draft}
          minLength={2}
          maxLength={300}
          onChange={(event) => setDraft(event.target.value)}
        />
        <DictateButton className="mb-2" onText={(spoken) => setDraft((current) => appendText(current, spoken))} />
        <Button type="submit" variant="ink" disabled={draft.trim().length < 2}>
          <Search className="size-4" aria-hidden="true" />
          ابحث
        </Button>
      </form>
      <div className="flex flex-wrap items-end gap-3">
        <SelectField label="النوع" name="library_type" className="w-36" value={type} onChange={(event) => setTypeParam(event.target.value === 'all' ? null : event.target.value)} options={SEARCH_TYPES} />
        <SelectField
          label="الدولة"
          name="library_country"
          className="w-36"
          value={jurisdiction ?? ''}
          onChange={(event) => setJurisdictionParam(event.target.value || null)}
          options={[['', 'الكل'], ...(Object.entries(JURISDICTION) as [Jurisdiction, string][])]}
        />
        <label className="flex h-10 cursor-pointer items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="size-4 accent-stamp" checked={repealedParam === '1'} onChange={(event) => setRepealedParam(event.target.checked ? '1' : null)} />
          أظهر النصوص الملغاة أيضاً
        </label>
      </div>

      {!params ? (
        <div className="rounded-lg border border-dashed border-ink/20 p-5">
          <p className="text-sm text-ink-soft">جرّب سؤالاً:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button key={example} type="button" onClick={() => setQParam(example)} className="rounded-full border border-ink/20 px-3 py-1 text-sm text-ink transition-colors hover:border-ink hover:bg-ink/5">
                {example}
              </button>
            ))}
          </div>
        </div>
      ) : results.isPending ? (
        <Loading />
      ) : results.isError ? (
        <Failed error={new Error(messageOf(results.error))} />
      ) : data ? (
        <div className={cn('space-y-6 transition-opacity', results.isPlaceholderData && 'opacity-60')} aria-busy={results.isFetching}>
          {data.mapped_terms.length > 0 && (
            <p className="rounded-md bg-marker/25 px-3 py-2 text-sm text-ink">
              بحثنا أيضاً بالمصطلح القانوني:{' '}
              {data.mapped_terms.map((entry) => (
                <span key={entry.phrase} className="me-2 font-semibold">«{entry.terms.join('، ')}»</span>
              ))}
            </p>
          )}
          {data.hidden_repealed > 0 && (
            <p className="text-sm text-ink-soft">
              {hiddenRepealedNote(data.hidden_repealed)}{' '}
              <button type="button" onClick={() => setRepealedParam('1')} className={cn(LINK, 'text-stamp-blue')}>اعرضها</button>
            </p>
          )}
          {total === 0 ? (
            <Empty>لا نتائج. جرّب كلمات أخرى أو المصطلح القانوني للمسألة.</Empty>
          ) : (
            <>
              {data.articles.length > 0 && (
                <ResultGroup title="المواد" icon={BookOpen} count={data.articles.length}>
                  {data.articles.map((article) => <ArticleCard key={article.article_id} article={article} onOpen={onOpenArticle} />)}
                </ResultGroup>
              )}
              {data.rulings.length > 0 && (
                <ResultGroup title="الأحكام" icon={Gavel} count={data.rulings.length}>
                  {data.rulings.map((ruling) => <RulingCard key={ruling.ruling_id} ruling={ruling} />)}
                </ResultGroup>
              )}
              {data.laws.length > 0 && (
                <ResultGroup title="التشريعات" icon={BookMarked} count={data.laws.length}>
                  {data.laws.map((law) => (
                    <Link key={law.law_id} to={lawPath(law.law_id)} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rule bg-paper p-4 transition-colors hover:bg-marker/20">
                      <span>
                        <span data-no-translate className="block font-doc text-lg font-bold text-ink">{law.title}</span>
                        <span className="text-sm text-ink-soft">{[lawCitation(law), law.article_count ? articlesCount(law.article_count) : null].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="flex gap-1.5"><Pill>{JURISDICTION[law.jurisdiction]}</Pill><StatusPill status={law.status} /></span>
                    </Link>
                  ))}
                </ResultGroup>
              )}
              <Caution />
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

const ResultGroup = ({ title, icon: Icon, count, children }: { title: string; icon: typeof BookOpen; count: number; children: ReactNode }) => (
  <section>
    <h2 className="mb-3 flex items-center gap-2 text-xl text-ink">
      <Icon className="size-5 text-ink-soft" aria-hidden="true" />
      {title}
      <span className="text-sm font-normal text-ink-faint">({count})</span>
    </h2>
    <div className="space-y-3">{children}</div>
  </section>
)

/* ───────────────────────── saved tab ───────────────────────── */

const SavedTab = ({ onOpenArticle }: { onOpenArticle: (articleId: string) => void }) => {
  const [tag, setTag] = useParam('tag')
  const saved = useSaved({ tag: tag ?? undefined })
  const [editing, setEditing] = useState<SavedItem | null>(null)
  const remove = useRemoveSavedItem()
  const me = useMe()
  return (
    <div className="space-y-4">
      {saved.data && saved.data.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-soft">الوسوم:</span>
          <button type="button" onClick={() => setTag(null)} className={cn('rounded-full px-3 py-1 text-sm', !tag ? 'bg-ink text-paper' : 'border border-ink/20 text-ink')}>الكل</button>
          {saved.data.tags.map((entry) => (
            <button key={entry} type="button" onClick={() => setTag(entry)} className={cn('rounded-full px-3 py-1 text-sm', tag === entry ? 'bg-ink text-paper' : 'border border-ink/20 text-ink')}>{entry}</button>
          ))}
        </div>
      )}
      {saved.isPending ? (
        <Loading />
      ) : saved.isError ? (
        <Failed error={saved.error} />
      ) : saved.data.items.length === 0 ? (
        <Empty>لم يحفظ المكتب أي مادة أو حكم بعد. احفظ ما يتكرر في عملكم من نتائج البحث.</Empty>
      ) : (
        <ul className="space-y-3">
          {saved.data.items.map((item) => (
            <li key={item.item_id} className="rounded-lg border border-rule bg-paper p-4">
              {item.article ? (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => onOpenArticle(item.article!.article_id)} className="font-doc text-lg font-bold text-ink underline-offset-4 hover:underline">
                      المادة {item.article.article_number}
                    </button>
                    <Link to={lawPath(item.article.law.law_id)} className="text-sm text-stamp-blue underline-offset-4 hover:underline"><Title>{item.article.law.title}</Title></Link>
                    <StatusPill status={item.article.status} />
                  </div>
                  <NotCurrent article={item.article} />
                  <LegalText text={item.article.body} className="line-clamp-3 text-sm" />
                </div>
              ) : item.ruling ? (
                <div>
                  <Link to={rulingPath(item.ruling.ruling_id)} className="font-doc text-lg font-bold text-ink underline-offset-4 hover:underline"><Title>{item.ruling.subject ?? rulingCitation(item.ruling)}</Title></Link>
                  <RulingCitation ruling={item.ruling} />
                </div>
              ) : null}
              {item.note && <p className="mt-2 rounded-md bg-marker/20 px-3 py-2 text-sm text-ink">{item.note}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
                {item.tags.map((entry) => <span key={entry} className="rounded-full bg-ink/8 px-2 py-0.5 text-ink-soft">{entry}</span>)}
                <span>حفظه {item.created_by.full_name} · {formatDate(item.created_at)}</span>
                {(me.admin || me.userId === item.created_by.user_id) && (
                  <>
                    <button type="button" onClick={() => setEditing(item)} className={cn(LINK, 'text-stamp-blue')}>تعديل</button>
                    <button type="button" onClick={() => remove.mutate(item.item_id)} disabled={remove.isPending} className={cn(LINK, 'text-stamp')}>إزالة</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <EditSaved item={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

const EditSaved = ({ item, onClose }: { item: SavedItem | null; onClose: () => void }) => {
  const update = useUpdateSavedItem()
  const [note, setNote] = useState('')
  const [tags, setTags] = useState('')
  useEffect(() => {
    if (!item) return
    update.reset()
    setNote(item.note ?? '')
    setTags(item.tags.join('، '))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.item_id])
  return (
    <Modal open={item !== null} onClose={onClose} title="تعديل المحفوظ">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (item) update.mutate({ itemId: item.item_id, note: note.trim() || null, tags: parseTags(tags) }, { onSuccess: onClose })
        }}
        className="space-y-4"
      >
        <TextArea label="ملاحظة" name="saved_note" value={note} onChange={(event) => setNote(event.target.value)} />
        <Field label="الوسوم" name="saved_tags" hint="افصل بينها بفاصلة" value={tags} onChange={(event) => setTags(event.target.value)} />
        <FormActions error={update.isError ? messageOf(update.error) : null}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="ink" disabled={update.isPending}>{update.isPending ? 'يُحفظ…' : 'احفظ'}</Button>
        </FormActions>
      </form>
    </Modal>
  )
}

/* ───────────────────────── principles tab ───────────────────────── */

const PrinciplesTab = () => {
  const [search, setSearch] = useState('')
  const principles = usePrinciples(search.trim() || undefined)
  const [editing, setEditing] = useState<Principle | 'new' | null>(null)
  const remove = useRemovePrinciple()
  const me = useMe()
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-sm text-ink-soft">المبادئ التي يعتمدها المكتب في عمله، بصياغته هو: يراها فريق المكتب فقط.</p>
        <div className="flex items-end gap-3">
          <Field label="بحث" name="principle_search" className="w-52" value={search} onChange={(event) => setSearch(event.target.value)} />
          <Button variant="ink" size="sm" onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden="true" />
            مبدأ جديد
          </Button>
        </div>
      </div>
      {principles.isPending ? (
        <Loading />
      ) : principles.isError ? (
        <Failed error={principles.error} />
      ) : principles.data.length === 0 ? (
        <Empty>لا مبادئ مسجّلة بعد.</Empty>
      ) : (
        <ul className="space-y-3">
          {principles.data.map((principle) => (
            <li key={principle.principle_id} className="rounded-lg border border-rule bg-paper p-4">
              <p className="font-doc text-lg font-bold text-ink">{principle.title}</p>
              <LegalText text={principle.body} className="mt-1 text-sm" />
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
                {principle.tags.map((tag) => <span key={tag} className="rounded-full bg-ink/8 px-2 py-0.5 text-ink-soft">{tag}</span>)}
                <span>{principle.created_by.full_name} · {formatDate(principle.updated_at)}</span>
                {(me.admin || me.userId === principle.created_by.user_id) && (
                  <>
                    <button type="button" onClick={() => setEditing(principle)} className={cn(LINK, 'text-stamp-blue')}>تعديل</button>
                    <button type="button" onClick={() => remove.mutate(principle.principle_id)} disabled={remove.isPending} className={cn(LINK, 'text-stamp')}>حذف</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <PrincipleForm principle={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

const PrincipleForm = ({ principle, onClose }: { principle: Principle | 'new' | null; onClose: () => void }) => {
  const save = useSavePrinciple()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const key = principle === null ? null : principle === 'new' ? 'new' : principle.principle_id
  useEffect(() => {
    if (principle === null) return
    save.reset()
    setTitle(principle === 'new' ? '' : principle.title)
    setBody(principle === 'new' ? '' : principle.body)
    setTags(principle === 'new' ? '' : principle.tags.join('، '))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return (
    <Modal open={principle !== null} onClose={onClose} title={principle === 'new' ? 'مبدأ جديد' : 'تعديل المبدأ'} wide>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate(
            { principleId: principle && principle !== 'new' ? principle.principle_id : undefined, title: title.trim(), body: body.trim(), tags: parseTags(tags) },
            { onSuccess: onClose },
          )
        }}
        className="space-y-4"
      >
        <Field label="عنوان المبدأ" name="principle_title" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
        <TextArea label="نص المبدأ" name="principle_body" required rows={6} value={body} onChange={(event) => setBody(event.target.value)} />
        <Field label="الوسوم (اختياري)" name="principle_tags" hint="افصل بينها بفاصلة" value={tags} onChange={(event) => setTags(event.target.value)} />
        <FormActions error={save.isError ? messageOf(save.error) : null}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="ink" disabled={!title.trim() || !body.trim() || save.isPending}>{save.isPending ? 'يُحفظ…' : 'احفظ'}</Button>
        </FormActions>
      </form>
    </Modal>
  )
}

/* ───────────────────────── gazette tab ───────────────────────── */

const GazetteTab = () => {
  const [yearParam, setYearParam] = useParam('year')
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : undefined
  const gazette = useGazette(year)
  const [issueId, setIssueId] = useState<string | null>(null)
  const issue = useGazetteIssue(issueId)
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-soft">أعداد الوقائع الفلسطينية مرتبة بالسنة، وكل عدد يُفتح بما نُشر فيه.</p>
      {gazette.isPending ? (
        <Loading />
      ) : gazette.isError ? (
        <Failed error={gazette.error} />
      ) : gazette.data.years.length === 0 ? (
        <Empty>لم تُستورد أعداد من الجريدة الرسمية بعد.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {gazette.data.years.map((entry) => (
              <button key={entry} type="button" onClick={() => setYearParam(String(entry))} className={cn('rounded-full px-3 py-1 text-sm tabular-nums', gazette.data.year === entry ? 'bg-ink text-paper' : 'border border-ink/20 text-ink')}>
                {entry}
              </button>
            ))}
          </div>
          {gazette.data.issues.length === 0 ? (
            <Empty>لا أعداد في هذه السنة.</Empty>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {gazette.data.issues.map((entry) => (
                <li key={entry.issue_id}>
                  <button type="button" onClick={() => setIssueId(entry.issue_id)} className="w-full rounded-lg border border-rule bg-paper p-4 text-start transition-colors hover:bg-marker/20">
                    <span className="flex items-center gap-2 font-doc text-lg font-bold text-ink">
                      <Newspaper className="size-5 text-ink-soft" aria-hidden="true" />
                      العدد {entry.issue_number}
                    </span>
                    <span className="text-sm text-ink-soft">{`${formatDate(entry.published_on)} · ${itemsCount(entry.item_count ?? 0)}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <Modal open={issueId !== null} onClose={() => setIssueId(null)} title={issue.data ? `الوقائع الفلسطينية · العدد ${issue.data.issue_number}` : 'العدد'}>
        {issue.isPending ? (
          <Loading />
        ) : issue.isError ? (
          <Failed error={issue.error} />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">تاريخ النشر: {formatDate(issue.data.published_on)}</p>
            {issue.data.items.length === 0 ? (
              <p className="text-sm text-ink-faint">لم يُستورد محتوى هذا العدد.</p>
            ) : (
              <ol className="list-decimal space-y-1.5 ps-5">
                {issue.data.items.map((item) => (
                  <li key={item.position} className="text-ink">
                    {item.law_id ? (
                      <Link to={lawPath(item.law_id)} className="text-stamp-blue underline-offset-4 hover:underline">{item.title}</Link>
                    ) : (
                      item.title
                    )}
                    {item.law_status === 'repealed' && <span className="ms-2 text-xs font-semibold text-stamp">(ملغى)</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

/* ───────────────────────── library page ───────────────────────── */

const TABS = [
  ['search', 'البحث'],
  ['saved', 'محفوظات المكتب'],
  ['principles', 'مبادئ المكتب'],
  ['gazette', 'الوقائع الفلسطينية'],
] as const
type TabKey = (typeof TABS)[number][0]

const StatsLine = () => {
  const stats = useLibraryStats()
  if (!stats.data) return null
  const { ps_laws: laws, ps_rulings: rulings, gazette_issues: issues, comparative } = stats.data
  if (laws + rulings + issues + comparative === 0) return null
  const items = [
    [laws, 'تشريعاً فلسطينياً'],
    [rulings, 'حكماً فلسطينياً'],
    [issues, 'عدداً من الوقائع'],
    [comparative, 'نصاً وحكماً للمقارنة'],
  ] as const
  return (
    <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([value, label]) => (
        <div key={label} className="flex flex-col-reverse rounded-lg border border-rule bg-paper px-4 py-3">
          <dt className="text-xs text-ink-soft">{label}</dt>
          <dd className="font-doc text-2xl font-bold tabular-nums text-ink">{value.toLocaleString('en')}</dd>
        </div>
      ))}
    </dl>
  )
}

export const LegalLibrary = () => {
  const [tabParam, setTabParam] = useParam('tab')
  const tab = oneOf(tabParam, TABS.map(([key]) => key), 'search') as TabKey
  const [articleId, setArticleId] = useParam('article')
  const stats = useLibraryStats()
  const empty = stats.data && stats.data.articles + stats.data.ps_rulings + stats.data.gazette_issues + stats.data.comparative === 0
  return (
    <>
      <SheetHeader title="المكتبة القانونية" note="التشريعات والأحكام والوقائع الفلسطينية، ومحفوظات مكتبك" />
      <StatsLine />
      {empty && tab === 'search' && (
        <p role="status" className="mb-5 rounded-md border border-ink/15 bg-marker/20 px-4 py-3 text-sm text-ink">
          المكتبة فارغة حالياً: لم تُستورد إليها نصوص بعد. تُضاف النصوص من إدارة المنصّة.
        </p>
      )}
      <div role="tablist" aria-label="أقسام المكتبة" className="mb-6 flex flex-wrap gap-1 border-b border-rule">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTabParam(key === 'search' ? null : key)}
            className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors', tab === key ? 'border-stamp text-ink' : 'border-transparent text-ink-soft hover:text-ink')}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'search' && <SearchTab onOpenArticle={setArticleId} />}
      {tab === 'saved' && <SavedTab onOpenArticle={setArticleId} />}
      {tab === 'principles' && <PrinciplesTab />}
      {tab === 'gazette' && <GazetteTab />}
      <ArticleSheet articleId={articleId} onClose={() => setArticleId(null)} />
    </>
  )
}

/* ───────────────────────── law and ruling pages ───────────────────────── */

const BackLink = () => (
  <Link to={BASE} className="mb-4 inline-block text-sm text-stamp-blue underline-offset-4 hover:underline">← المكتبة القانونية</Link>
)

export const LawPage = () => {
  const { lawId = '' } = useParams()
  const law = useLaw(lawId)
  const [articleId, setArticleId] = useParam('article')
  const [filter, setFilter] = useState('')
  if (law.isPending) return <Loading />
  if (law.isError) return <><BackLink /><Failed error={new Error(messageOf(law.error))} /></>
  const { law: info, articles } = law.data
  const wanted = filter.trim()
  const shown = wanted ? articles.filter((article) => article.article_number === wanted || article.body.includes(wanted)) : articles
  return (
    <>
      <BackLink />
      <SheetHeader title={info.title} note={[LAW_KIND[info.law_kind], lawCitation({ law_number: info.law_number, law_year: info.law_year }), JURISDICTION[info.jurisdiction]].filter(Boolean).join(' · ')} />
      <div className="mb-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink-soft">
          <StatusPill status={info.status} />
          {info.published_on && <span>نُشر في {formatDate(info.published_on)}</span>}
          {info.gazette_issue && <span>الوقائع الفلسطينية، العدد {info.gazette_issue.issue_number}</span>}
          {info.source_url && (
            <a href={info.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-stamp-blue underline-offset-4 hover:underline">
              المصدر <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
        {info.status === 'repealed' && (
          <p role="alert" className="flex items-center gap-2 rounded-md border border-stamp/40 bg-stamp/5 px-3 py-2 text-sm font-semibold text-stamp">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            هذا القانون ملغى{info.status_note ? `: ${info.status_note}` : '.'} لا يُعتمد على مواده.
          </p>
        )}
        {info.status === 'amended' && info.status_note && <p className="text-sm text-ink-soft">التعديل: {info.status_note}</p>}
      </div>
      <Field label="ابحث في مواد هذا القانون" name="law_filter" className="mb-5 max-w-sm" placeholder="رقم المادة أو كلمة" value={filter} onChange={(event) => setFilter(event.target.value)} />
      {shown.length === 0 ? (
        <Empty>{articles.length === 0 ? 'لم تُستورد مواد هذا القانون.' : 'لا مواد مطابقة.'}</Empty>
      ) : (
        <div className="space-y-3">
          {shown.map((article) => <ArticleCard key={article.article_id} article={article} onOpen={setArticleId} showLaw={false} />)}
        </div>
      )}
      <div className="mt-6"><Caution /></div>
      <ArticleSheet articleId={articleId} onClose={() => setArticleId(null)} />
    </>
  )
}

export const RulingPage = () => {
  const { rulingId = '' } = useParams()
  const ruling = useRuling(rulingId)
  if (ruling.isPending) return <Loading />
  if (ruling.isError) return <><BackLink /><Failed error={new Error(messageOf(ruling.error))} /></>
  const data = ruling.data
  return (
    <>
      <BackLink />
      <SheetHeader title={data.subject ?? rulingCitation(data)} note={JURISDICTION[data.jurisdiction]} />
      <RulingCitation ruling={data} className="-mt-4 mb-4 text-sm text-ink-soft" />
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <SaveButton target={{ ruling_id: data.ruling_id }} savedItemId={data.saved_item_id} />
        <LinkButton target={{ ruling_id: data.ruling_id }} />
      </div>
      {data.summary && (
        <section className="mb-5 rounded-lg border border-ink/15 bg-marker/20 p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink-soft">الخلاصة</h2>
          <LegalText text={data.summary} />
        </section>
      )}
      {data.applied_articles.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-lg text-ink">المواد التي طبّقها الحكم</h2>
          <ul className="space-y-1">
            {data.applied_articles.map((entry) => (
              <li key={entry.article_id} className="text-sm">
                <Link to={`${lawPath(entry.law_id)}?article=${entry.article_id}`} className="text-stamp-blue underline-offset-4 hover:underline">{`المادة ${entry.article_number} من`} <Title>{entry.law_title}</Title></Link>
                {(entry.status === 'repealed' || entry.law_status === 'repealed') && <span className="ms-2 text-xs font-semibold text-stamp">(ملغاة اليوم)</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="rounded-lg border border-rule bg-paper p-5">
        <h2 className="mb-2 text-lg text-ink">نص الحكم</h2>
        <LegalText text={data.body ?? ''} />
      </section>
      <div className="mt-6"><Caution /></div>
    </>
  )
}

/* ───────────────────────── case file tab ───────────────────────── */

/** The articles and rulings linked to a case, and a way to find more. */
export const CaseLibrary = ({ caseId }: { caseId: string }) => {
  const references = useCaseReferences(caseId)
  const unlink = useUnlinkFromCase()
  const [articleId, setArticleId] = useState<string | null>(null)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">المواد والأحكام التي يستند إليها فريق القضية، مع سبب ربط كل منها.</p>
        <Link to={BASE} className="inline-flex items-center gap-1 text-sm font-semibold text-stamp-blue underline-offset-4 hover:underline">
          <Search className="size-4" aria-hidden="true" />
          ابحث في المكتبة القانونية
        </Link>
      </div>
      {unlink.isError && <p role="alert" className="text-sm text-stamp">{messageOf(unlink.error)}</p>}
      {references.isPending ? (
        <Loading />
      ) : references.isError ? (
        <Failed error={references.error} />
      ) : references.data.length === 0 ? (
        <Empty>لم يُربط أي مرجع قانوني بهذه القضية بعد. ابحث في المكتبة واضغط «اربط بقضية».</Empty>
      ) : (
        <ul className="space-y-3">
          {references.data.map((reference) => (
            <li key={reference.reference_id} className="rounded-lg border border-rule bg-paper p-4">
              {reference.article ? (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setArticleId(reference.article!.article_id)} className="font-doc text-lg font-bold text-ink underline-offset-4 hover:underline">
                      المادة {reference.article.article_number}
                    </button>
                    <Link to={lawPath(reference.article.law.law_id)} className="text-sm text-stamp-blue underline-offset-4 hover:underline"><Title>{reference.article.law.title}</Title></Link>
                    <StatusPill status={reference.article.status} />
                  </div>
                  <NotCurrent article={reference.article} />
                  <LegalText text={reference.article.body} className="line-clamp-3 text-sm" />
                </div>
              ) : reference.ruling ? (
                <div>
                  <Link to={rulingPath(reference.ruling.ruling_id)} className="font-doc text-lg font-bold text-ink underline-offset-4 hover:underline">
                    <Title>{reference.ruling.subject ?? rulingCitation(reference.ruling)}</Title>
                  </Link>
                  <RulingCitation ruling={reference.ruling} />
                </div>
              ) : null}
              {reference.note && <p className="mt-2 rounded-md bg-marker/20 px-3 py-2 text-sm text-ink">{reference.note}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 text-xs text-ink-faint">
                <span>ربطه {reference.linked_by.full_name} · {formatDate(reference.created_at)}</span>
                <button
                  type="button"
                  onClick={() => unlink.mutate({ caseId, referenceId: reference.reference_id })}
                  disabled={unlink.isPending}
                  className={cn(LINK, 'inline-flex items-center gap-1 text-stamp')}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  إزالة الربط
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ArticleSheet articleId={articleId} onClose={() => setArticleId(null)} />
    </div>
  )
}
