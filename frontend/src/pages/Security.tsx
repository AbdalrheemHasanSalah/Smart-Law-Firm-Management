import { CheckCircle2, Download, FileCheck2, Lock, ShieldAlert, ShieldCheck, Unlock } from 'lucide-react'
import { useState, type ChangeEvent } from 'react'
import { messageOf } from '@/lib/api'
import { formatDate, formatTime, ROLE } from '@/lib/labels'
import {
  CHAIN_PROBLEM,
  fetchOfficeExport,
  PERMISSION,
  PERMISSIONS,
  togglePermission,
  useBackups,
  useMemberSecurity,
  useSetPermissions,
  useUnlockMember,
  useVerifyChain,
  type MemberSecurity,
  type OfficeExport,
  type Permission,
} from '@/lib/permissions'
import { Button, cn } from '@/ui/kit'
import { Empty, Failed, Loading, Pill, SheetHeader } from '@/ui/Shell'

const Section = ({ title, note, children }: { title: string; note: string; children: React.ReactNode }) => (
  <section className="border-t-2 border-ink pt-5 first:border-t-0 first:pt-0">
    <h2 className="text-2xl text-ink">{title}</h2>
    <p className="mt-0.5 mb-4 max-w-3xl text-sm text-ink-soft">{note}</p>
    {children}
  </section>
)

const bytes = (value: number) =>
  value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`

/* ───────────────────────── members ───────────────────────── */

const MemberCard = ({ member }: { member: MemberSecurity }) => {
  const save = useSetPermissions()
  const unlock = useUnlockMember()
  const toggle = (permission: Permission) => save.mutate({ userId: member.user_id, ...togglePermission(member, permission) })
  return (
    <li className="rounded-lg border border-rule bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-ink">{member.full_name}</p>
          <p className="text-xs text-ink-soft">
            {member.is_owner ? 'صاحب المكتب' : ROLE[member.role] ?? member.role} · <bdi dir="ltr">{member.email}</bdi>
            {member.status === 'suspended' && ' · موقوف'}
          </p>
        </div>
        {member.locked_until && (
          <div className="flex items-center gap-2">
            <Pill tone="red">
              <Lock className="me-1 inline size-3" aria-hidden="true" />
              {`الدخول موقوف حتى ${formatTime(member.locked_until)}`}
            </Pill>
            <button type="button" disabled={unlock.isPending} onClick={() => unlock.mutate(member.user_id)} className="inline-flex items-center gap-1 text-xs font-semibold text-stamp-blue underline-offset-4 hover:underline">
              <Unlock className="size-3.5" aria-hidden="true" />
              ارفع الإيقاف
            </button>
          </div>
        )}
      </div>
      {member.is_owner ? (
        <p className="mt-3 text-sm text-ink-soft">لصاحب المكتب كل الصلاحيات، ولا تُسحب.</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={`صلاحيات ${member.full_name}`}>
          {PERMISSIONS.filter((key) => key !== 'office.manage').map((key) => {
            const on = member.permissions.includes(key)
            const byRole = member.role_defaults.includes(key)
            const changed = member.permissions_granted.includes(key) || member.permissions_revoked.includes(key)
            return (
              <li key={key}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={save.isPending}
                  onClick={() => toggle(key)}
                  title={`${PERMISSION[key].note}${changed ? (byRole ? ' — مسحوبة من دوره' : ' — مضافة له') : byRole ? ' — من دوره' : ''}`}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                    on ? 'border-stamp-green bg-stamp-green/15 text-stamp-green' : 'border-ink/15 text-ink-faint line-through decoration-ink/30',
                    changed && 'ring-2 ring-marker ring-offset-1',
                  )}
                >
                  {PERMISSION[key].label}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {(save.isError || unlock.isError) && <p role="alert" className="mt-2 text-sm text-stamp">{messageOf(save.error ?? unlock.error)}</p>}
    </li>
  )
}

const Members = () => {
  const members = useMemberSecurity()
  if (members.isPending) return <Loading />
  if (members.isError) return <Failed error={members.error} />
  return (
    <>
      <p className="mb-3 text-xs text-ink-soft">
        الأخضر مسموح. اضغط صلاحية لسحبها أو إضافتها لهذا العضو وحده؛ المحاطة بإطار أصفر مختلفة عن دوره. الخادم يطبّق ذلك على كل طلب.
      </p>
      <ul className="grid gap-3 lg:grid-cols-2">
        {members.data.members.map((member) => <MemberCard key={member.user_id} member={member} />)}
      </ul>
    </>
  )
}

/* ───────────────────────── audit chain ───────────────────────── */

const AuditChain = () => {
  const verify = useVerifyChain()
  const result = verify.data
  return (
    <div className="space-y-3">
      <Button variant="ink" size="sm" onClick={() => verify.mutate()} disabled={verify.isPending}>
        <ShieldCheck className="size-4" aria-hidden="true" />
        {verify.isPending ? 'يُفحص…' : 'افحص سلامة السجل'}
      </Button>
      {verify.isError && <p role="alert" className="text-sm text-stamp">{messageOf(verify.error)}</p>}
      {result && (
        <div className={cn('rounded-md border p-4 text-sm', result.ok ? 'border-stamp-green/40 bg-stamp-green/10' : 'border-stamp/40 bg-stamp/10')} aria-live="polite">
          <p className="flex items-center gap-2 font-semibold text-ink">
            {result.ok ? <CheckCircle2 className="size-4 text-stamp-green" aria-hidden="true" /> : <ShieldAlert className="size-4 text-stamp" aria-hidden="true" />}
            {result.ok ? 'السجل سليم: لم يُعدَّل أي قيد ولم يُحذف.' : 'في السجل قيود لا تطابق سلسلتها.'}
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            {`القيود المفحوصة: ${result.checked}${result.legacy > 0 ? ` · قيود أقدم من السلسلة لا يمكن فحصها: ${result.legacy}` : ''} · ${formatDate(result.checked_at)} ${formatTime(result.checked_at)}`}
          </p>
          {result.head && (
            <p className="mt-1 text-xs text-ink-soft">
              {`آخر قيد: رقم ${result.head.seq} · البصمة`} <code dir="ltr" className="font-mono text-ink">{result.head.hash.slice(0, 16)}…</code> — دوّنها إن أردت مقارنتها لاحقاً.
            </p>
          )}
          {result.problems.length > 0 && (
            <ul className="mt-2 list-disc ps-5 text-xs text-ink">
              {result.problems.map((problem) => (
                <li key={problem.seq}>{`القيد رقم ${problem.seq} (${formatDate(problem.at)}): ${CHAIN_PROBLEM[problem.kind]}`}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/* ───────────────────────── export ───────────────────────── */

const sha256Hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((byte) => byte.toString(16).padStart(2, '0')).join('')

const OfficeExportPanel = () => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<OfficeExport['manifest'] | null>(null)
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null)

  const download = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await fetchOfficeExport()
      const blob = new Blob([JSON.stringify(result)], { type: 'application/json' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `qadiyati-office-export-${result.manifest.exported_at.slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(link.href)
      setDone(result.manifest)
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  const verifyFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as Partial<OfficeExport>
      if (parsed.manifest?.format !== 'qadiyati-office-export' || !parsed.data) throw new Error('format')
      const hash = await sha256Hex(JSON.stringify(parsed.data))
      setCheck(
        hash === parsed.manifest.sha256
          ? { ok: true, text: `الملف سليم ومطابق لبصمته: نسخة ${parsed.manifest.office.name} بتاريخ ${formatDate(parsed.manifest.exported_at)}.` }
          : { ok: false, text: 'الملف لا يطابق بصمته: تغيّر بعد تنزيله أو تلف.' },
      )
    } catch {
      setCheck({ ok: false, text: 'هذا ليس ملف نسخة من قضيتي، أو أنه تالف.' })
    }
  }

  const rows = done ? Object.values(done.counts).reduce((sum, count) => sum + count, 0) : 0
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="ink" size="sm" onClick={() => void download()} disabled={busy}>
          <Download className="size-4" aria-hidden="true" />
          {busy ? 'تُجهَّز وتُفحص…' : 'نزّل نسخة من بيانات المكتب'}
        </Button>
        <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-ink/25 px-3 text-sm font-semibold text-ink hover:border-ink">
          <FileCheck2 className="size-4" aria-hidden="true" />
          تحقّق من ملف نسخة
          <input type="file" accept="application/json,.json" className="sr-only" onChange={(event) => void verifyFile(event)} />
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-stamp">{error}</p>}
      {done && (
        <p className="text-sm text-ink" aria-live="polite">
          {`نُزّلت نسخة فُحصت قبل تسليمها — عدد الجداول: ${Object.keys(done.counts).length}، وعدد السجلات: ${rows}. البصمة`} <code dir="ltr" className="font-mono text-xs">{done.sha256.slice(0, 16)}…</code>
        </p>
      )}
      {check && <p className={cn('text-sm', check.ok ? 'text-stamp-green' : 'text-stamp')} aria-live="polite">{check.text}</p>}
      <p className="text-xs text-ink-faint">يحوي الملف كل سجلات مكتبك (القضايا والموكّلين والمالية والسجل…) دون كلمات المرور والرموز السرية. الملفات المرفوعة نفسها لا تدخل فيه، بل سجلاتها فقط؛ تُحفظ مع النسخ الليلية للخادم.</p>
    </div>
  )
}

export const SecurityPage = () => (
  <>
    <SheetHeader title="الأمان والصلاحيات" note="صلاحيات أعضاء الفريق، وإيقاف الدخول بعد المحاولات الخاطئة، وسلامة سجل النشاط، ونسخة من بيانات مكتبك." />
    <div className="space-y-10">
      <Section title="الفريق وصلاحياته" note="لكل دور صلاحيات افتراضية، ويمكنك إضافة صلاحية لعضو أو سحبها منه. يُوقَف دخول أي حساب 15 دقيقة بعد خمس كلمات مرور خاطئة متتالية (وتتضاعف المدة إن تكرر)، ويصله بريد بذلك.">
        <Members />
      </Section>
      <Section title="سلامة سجل النشاط" note="كل قيد في السجل يحمل بصمة القيد الذي قبله، فأي تعديل أو حذف لاحق يكسر السلسلة ويظهر هنا. لا يمكن تعديل السجل أو الحذف منه.">
        <AuditChain />
      </Section>
      <Section title="نسخة من بيانات المكتب" note="ملف واحد ببيانات مكتبك وحده، يُفحص قبل تسليمه ومعه بصمة SHA-256 للتحقق منه لاحقاً.">
        <OfficeExportPanel />
      </Section>
    </div>
  </>
)

/* ───────────────────────── platform backups ───────────────────────── */

export const PlatformBackups = () => {
  const backups = useBackups()
  return (
    <>
      <SheetHeader title="النسخ الاحتياطية" note="نسخ الخادم الليلية (قاعدة البيانات والمستندات)، وكل نسخة تُفحص فور أخذها." />
      {backups.isPending ? (
        <Loading />
      ) : backups.isError ? (
        <Failed error={backups.error} />
      ) : !backups.data.configured ? (
        <Empty>لم تُسجَّل أي نسخة بعد على هذا الخادم. تُفعَّل النسخ الليلية بسكربت الإعداد (deploy/scripts/setup-server.sh)، وتظهر هنا بعد أول ليلة.</Empty>
      ) : (
        <>
          <div className={cn('mb-4 rounded-md border p-4 text-sm', backups.data.stale ? 'border-stamp/40 bg-stamp/10 text-ink' : 'border-stamp-green/40 bg-stamp-green/10 text-ink')}>
            {backups.data.latest_ok_at
              ? `آخر نسخة سليمة: ${formatDate(backups.data.latest_ok_at)} ${formatTime(backups.data.latest_ok_at)}${backups.data.stale ? ' — مضى عليها أكثر من 36 ساعة، افحص الخادم.' : '.'}`
              : 'لا توجد نسخة سليمة بعد. افحص سجل النسخ على الخادم (/var/log/qadiyati-backup.log).'}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-ink text-xs text-ink-soft">
                  {['التاريخ', 'قاعدة البيانات', 'المستندات', 'البصمة', 'الحالة'].map((head) => <th key={head} scope="col" className="py-2 pe-3 text-start font-semibold">{head}</th>)}
                </tr>
              </thead>
              <tbody>
                {backups.data.backups.map((run) => (
                  <tr key={run.stamp} className="border-b border-rule align-top">
                    <td className="py-2 pe-3 whitespace-nowrap">{formatDate(run.finished_at)} {formatTime(run.finished_at)}</td>
                    <td className="py-2 pe-3">{run.database ? `${bytes(run.database.bytes)} · الجداول: ${run.database.tables}` : '—'}{run.database && !run.database.verified && <span className="block text-xs text-stamp">لم تجتز الفحص</span>}</td>
                    <td className="py-2 pe-3">{run.documents ? `${bytes(run.documents.bytes)} · الملفات: ${run.documents.entries}` : '—'}{run.documents && !run.documents.verified && <span className="block text-xs text-stamp">لم يُفتح الأرشيف</span>}</td>
                    <td className="py-2 pe-3 font-mono text-xs" dir="ltr">{run.database?.sha256?.slice(0, 12) ?? '—'}</td>
                    <td className="py-2 pe-3">
                      {run.ok ? <Pill tone="green">سليمة</Pill> : <Pill tone="red">فشلت</Pill>}
                      {run.error && <span className="block text-xs text-stamp" dir="ltr">{run.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-ink-faint">الاسترجاع يتم من الخادم بأمر <code dir="ltr">sudo qadiyati-restore التاريخ</code>، ويأخذ لقطة من الوضع الحالي قبله ويعيدها تلقائياً إن فشل (التفاصيل في deploy/README.md).</p>
        </>
      )}
    </>
  )
}
