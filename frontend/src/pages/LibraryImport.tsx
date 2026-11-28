import { AlertTriangle, CheckCircle2, FileJson, Upload } from 'lucide-react'
import { useState } from 'react'
import { messageOf, toApiError } from '@/lib/api'
import { formatDate } from '@/lib/labels'
import {
  MAX_IMPORT_BYTES,
  useImportFile,
  usePlatformLibrary,
  type ImportProblem,
  type ImportSummary,
  type LibraryStats,
} from '@/lib/legalLibrary'
import { Button, cn } from '@/ui/kit'
import { Empty, Failed, Loading, SheetHeader } from '@/ui/Shell'

/**
 * The platform admin's import of the shared legal library: pick a JSON file, preview what it
 * would add or update (nothing is saved), then import it. The server checks every field and
 * imports all of the file or none of it; the format is in backend/database/legal-library-import.md.
 */

const COUNTS: [keyof Pick<ImportSummary, 'laws' | 'articles' | 'rulings' | 'gazette' | 'synonyms'>, string][] = [
  ['laws', 'التشريعات'],
  ['articles', 'المواد'],
  ['rulings', 'الأحكام'],
  ['gazette', 'أعداد الوقائع'],
  ['synonyms', 'المرادفات'],
]

const SummaryTable = ({ summary }: { summary: ImportSummary }) => (
  <div className="space-y-3">
    <table className="w-full max-w-md border-collapse text-sm">
      <thead>
        <tr className="border-b-2 border-ink">
          <th scope="col" className="pb-2 text-start text-xs font-semibold text-ink-soft">النوع</th>
          <th scope="col" className="pb-2 text-start text-xs font-semibold text-ink-soft">جديد</th>
          <th scope="col" className="pb-2 text-start text-xs font-semibold text-ink-soft">تحديث</th>
        </tr>
      </thead>
      <tbody>
        {COUNTS.map(([key, label]) => (
          <tr key={key} className="border-b border-rule">
            <td className="py-2 text-ink">{label}</td>
            <td className="py-2 tabular-nums text-ink">{summary[key].added}</td>
            <td className="py-2 tabular-nums text-ink">{summary[key].updated}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <p className="text-sm text-ink-soft">
      روابط الأحكام بالمواد: {summary.ruling_links}
      {summary.articles_kept_not_in_file > 0 && ` · ${summary.articles_kept_not_in_file} مادة مخزّنة ليست في الملف بقيت كما هي`}
    </p>
    {summary.warnings.length > 0 && (
      <div className="rounded-md border border-ink/15 bg-marker/20 p-3">
        <p className="text-xs font-semibold text-ink-soft">تنبيهات ({summary.warnings.length})</p>
        <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-ink" dir="auto">
          {summary.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      </div>
    )}
  </div>
)

const Problems = ({ problems }: { problems: ImportProblem[] }) => (
  <div role="alert" className="rounded-md border border-stamp/40 bg-stamp/5 p-3">
    <p className="flex items-center gap-2 text-sm font-semibold text-stamp">
      <AlertTriangle className="size-4" aria-hidden="true" />
      لم يُستورد شيء. صحّح هذه الأخطاء ثم أعد المحاولة:
    </p>
    <ul className="mt-2 space-y-0.5 text-sm text-ink" dir="ltr">
      {problems.map((problem) => (
        <li key={`${problem.path}-${problem.message}`}><code className="font-mono text-xs">{problem.path}</code> {problem.message}</li>
      ))}
    </ul>
  </div>
)

const StatsGrid = ({ stats }: { stats: LibraryStats }) => (
  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
    {([
      [stats.ps_laws, 'تشريع فلسطيني'],
      [stats.articles, 'مادة'],
      [stats.ps_rulings, 'حكم فلسطيني'],
      [stats.gazette_issues, 'عدد من الوقائع'],
      [stats.comparative, 'نص وحكم للمقارنة'],
    ] as const).map(([value, label]) => (
      <div key={label} className="flex flex-col-reverse rounded-lg border border-rule bg-paper px-4 py-3">
        <dt className="text-xs text-ink-soft">{label}</dt>
        <dd className="font-doc text-2xl font-bold tabular-nums text-ink">{value.toLocaleString('en')}</dd>
      </div>
    ))}
  </dl>
)

export const LibraryImport = () => {
  const library = usePlatformLibrary()
  const run = useImportFile()
  const [file, setFile] = useState<{ name: string; content: unknown } | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [result, setResult] = useState<{ dryRun: boolean; summary: ImportSummary } | null>(null)

  const choose = async (picked: File | undefined) => {
    setFile(null)
    setResult(null)
    setReadError(null)
    run.reset()
    if (!picked) return
    if (picked.size > MAX_IMPORT_BYTES) {
      setReadError('الملف أكبر من 15 ميغابايت. قسّمه إلى ملفات أصغر.')
      return
    }
    try {
      setFile({ name: picked.name, content: JSON.parse(await picked.text()) })
    } catch {
      setReadError('تعذّرت قراءة الملف: يجب أن يكون JSON صالحاً بترميز UTF-8.')
    }
  }

  const send = (dryRun: boolean) => {
    if (!file) return
    setResult(null)
    run.mutate({ file: file.content, dryRun, fileName: file.name }, { onSuccess: (data) => setResult({ dryRun: data.dry_run, summary: data.summary }) })
  }

  const failure = run.isError ? toApiError(run.error) : null
  const problems = (failure?.details as { errors?: ImportProblem[] } | undefined)?.errors

  return (
    <>
      <SheetHeader title="المكتبة القانونية" note="استيراد التشريعات والأحكام وأعداد الوقائع إلى مكتبة كل المكاتب" />
      {library.data && <div className="mb-8"><StatsGrid stats={library.data.stats} /></div>}

      <section className="mb-8 rounded-lg border border-rule bg-paper p-5">
        <h2 className="mb-1 flex items-center gap-2 text-xl text-ink">
          <FileJson className="size-5 text-ink-soft" aria-hidden="true" />
          استيراد ملف
        </h2>
        <p className="mb-4 max-w-2xl text-sm text-ink-soft">
          ملف JSON بالصيغة الموثّقة في <code className="font-mono text-xs" dir="ltr">backend/database/legal-library-import.md</code>، حتى 15 ميغابايت.
          استورد فقط نصوصاً يحق لك نشرها. «معاينة» تُظهر ما سيُضاف وما سيُحدَّث دون حفظ أي شيء، ثم «استورد» يحفظ الملف كله أو لا شيء منه.
        </p>
        <input
          type="file"
          accept="application/json,.json"
          aria-label="ملف الاستيراد"
          onChange={(event) => void choose(event.target.files?.[0])}
          className="block w-full max-w-md text-sm text-ink file:me-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-2 file:text-sm file:font-semibold file:text-paper"
        />
        {readError && <p role="alert" className="mt-2 text-sm text-stamp">{readError}</p>}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="line" disabled={!file || run.isPending} onClick={() => send(true)}>
            {run.isPending && run.variables?.dryRun ? 'يُعايَن…' : 'معاينة'}
          </Button>
          <Button variant="ink" disabled={!file || run.isPending || result?.dryRun !== true} onClick={() => send(false)} title={result?.dryRun ? undefined : 'عاين الملف أولاً'}>
            <Upload className="size-4" aria-hidden="true" />
            {run.isPending && !run.variables?.dryRun ? 'يُستورد…' : 'استورد'}
          </Button>
        </div>

        <div className="mt-5 space-y-3">
          {problems && problems.length > 0 ? <Problems problems={problems} /> : failure && <p role="alert" className="text-sm text-stamp">{messageOf(run.error)}</p>}
          {result && (
            <div className={cn('space-y-3 rounded-md border p-4', result.dryRun ? 'border-ink/15' : 'border-stamp-green/40 bg-stamp-green/5')}>
              <p className="flex items-center gap-2 font-semibold text-ink">
                {!result.dryRun && <CheckCircle2 className="size-5 text-stamp-green" aria-hidden="true" />}
                {result.dryRun ? 'المعاينة: هذا ما سيحدث عند الاستيراد (لم يُحفظ شيء بعد).' : 'تم الاستيراد.'}
              </p>
              <SummaryTable summary={result.summary} />
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl text-ink">سجل الاستيراد</h2>
        {library.isPending ? (
          <Loading />
        ) : library.isError ? (
          <Failed error={library.error} />
        ) : library.data.imports.length === 0 ? (
          <Empty>لم يُستورد أي ملف بعد.</Empty>
        ) : (
          <ul className="space-y-2">
            {library.data.imports.map((entry) => (
              <li key={entry.import_id} className="rounded-lg border border-rule bg-paper px-4 py-3 text-sm">
                <p className="font-semibold text-ink" dir="auto">{entry.file_name ?? 'ملف بلا اسم'}</p>
                <p className="text-ink-soft">
                  {formatDate(entry.created_at)}
                  {entry.imported_by_name && ` · ${entry.imported_by_name}`}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-faint">
                  {COUNTS.map(([key, label]) => (
                    <span key={key}>{label}: {entry.summary[key].added + entry.summary[key].updated}</span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
