import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { appendText } from '@/lib/voice'
import { DictateButton, VoicePlayer, VoiceRecorder } from '@/ui/Voice'
import { Download, Plus, Search, Upload } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { personaOf, useAuth } from '@/auth/auth'
import { api, API_URL, DEMO, messageOf } from '@/lib/api'
import { oneOf, useParam } from '@/lib/useParam'
import {
  ACCESS_LEVEL,
  CASE_STATUS,
  CASE_TYPE,
  CONTRACT_STATUS,
  dueLabel,
  formatDate,
  INVITE_STATE,
  MEMBER_STATUS,
  optionsOf,
  PARTY_ROLE,
  PORTAL_STATUS,
  PRIORITY,
  ROLE,
  TASK_STATUS,
  VISIBILITY,
} from '@/lib/labels'
import type { CaseNote, CaseRelationships, Client, Contract, DocumentRecord, Invitation, LegalCase, Member, Opponent, Task } from '@/lib/types'
import { FormActions, headerValue, Modal, safePdfName, SelectField, TextArea } from '@/ui/forms'
import { Button, cn, Field, Stamp } from '@/ui/kit'
import { ConflictNotice, useConflictCheck } from '@/ui/Conflicts'
import { choiceReady, ClientChooser, clientBody, existingChoice, type ClientChoice } from '@/ui/ClientChooser'
import { InvoicesTable, InvoiceTotals, NewInvoice, useInvoices } from '@/ui/Finance'
import { ShareDocument } from '@/ui/ShareDocument'
import { HearingPrepTab } from '@/ui/HearingPrep'
import { Empty, Failed, Loading, Pill, SheetHeader } from '@/ui/Shell'
import { CasesTable, useCases, useClients, useTasks } from './Office'
import { CasePowers } from './PowersOfAttorney'
import { CaseLibrary } from './LegalLibrary'
import { CaseAnalysis } from './CaseAnalysis'
import { CaseDrafting } from './Drafting'
import { CaseHearings, CaseNotices } from './CaseSessions'
import { CaseProfit } from './FinanceOffice'

/* ───────────────────────── shared ───────────────────────── */

const useIsOwner = () => personaOf(useAuth().session) === 'owner'

const useMembers = (enabled: boolean) =>
  useQuery({
    queryKey: ['members'],
    enabled,
    queryFn: async () => (await api.get<{ users: Member[] }>('/users', { params: { pageSize: 50 } })).data.users,
  })

type InviteResult = { url: string; sent: boolean }

/** Creates an invitation and returns its single-use link, rebuilt on this origin (the backend's may differ). */
const sendInvitation = async (body: { email: string; role: string; client_id?: string }): Promise<InviteResult> => {
  const { data } = await api.post<{ invite_url: string; email_sent: boolean }>('/offices/current/invitations', body)
  const token = data.invite_url.split('/').pop() ?? ''
  return { url: `${location.origin}/invite/${token}`, sent: data.email_sent }
}

/** The created invitation: whether it was emailed, and its link to copy. */
const InviteLink = ({ result, onDone, title = 'أُنشئت الدعوة' }: { result: InviteResult; onDone: () => void; title?: string }) => {
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <Stamp slam="mount" tone="green" className="text-xl">
        {title}
      </Stamp>
      <p className="mt-4 text-sm leading-relaxed text-ink-soft">
        {result.sent ? 'أُرسل الرابط إلى البريد. يمكنك أيضاً نسخه ومشاركته مباشرة.' : 'لم يُرسل بريد لأن البريد غير مفعّل على الخادم. انسخ الرابط وشاركه مع المدعوّ مباشرة.'} الرابط صالح 7 أيام ويُستخدم مرة واحدة، ولن يُعرض مرة أخرى.
      </p>
      <p className="mt-3 rounded-md border border-ink/20 bg-white/60 p-3 text-xs break-all text-ink" dir="ltr">
        {result.url}
      </p>
      <FormActions>
        <Button
          variant="ink"
          onClick={() => {
            void navigator.clipboard.writeText(result.url).then(() => setCopied(true))
          }}
        >
          {copied ? 'نُسخ' : 'انسخ الرابط'}
        </Button>
        <Button variant="line" onClick={onDone}>
          تم
        </Button>
      </FormActions>
    </div>
  )
}

const TH = 'pe-4 pb-2 text-start text-xs font-semibold text-ink-soft'
const TD = 'py-3 pe-4 align-middle text-sm text-ink'
const ROW = 'border-b border-rule transition-colors hover:bg-marker/25'

const Table = ({ head, children }: { head: string[]; children: ReactNode }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[38rem]">
      <thead>
        <tr className="border-b-2 border-ink">
          {head.map((cell) => (
            <th key={cell} className={TH}>
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
)

/** Debounced search box used on list pages. */
const SearchBox = ({ onSearch, placeholder }: { onSearch: (value: string) => void; placeholder: string }) => {
  const [typed, setTyped] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => onSearch(typed.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [typed, onSearch])
  return (
    <label className="flex items-center gap-2 rounded-md border border-ink/25 bg-white/60 px-3 focus-within:border-stamp-blue">
      <Search className="size-4 text-ink-faint" aria-hidden="true" />
      <input
        type="search"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-52 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
      />
    </label>
  )
}

const AddButton = ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
  <Button variant="stamp" size="sm" onClick={onClick}>
    <Plus className="size-4" aria-hidden="true" />
    {children}
  </Button>
)

/** Inline status changer: a select that saves as soon as it changes. */
const QuickSelect = ({
  value,
  options,
  onChange,
  label,
  disabled,
  caption = false,
}: {
  value: string
  options: readonly (readonly [string, string])[]
  onChange: (value: string) => void
  label: string
  disabled?: boolean
  /** Show the label above the select. Without it the label is for screen readers only (table cells have a column heading). */
  caption?: boolean
}) => {
  const select = (
    <select
      value={value}
      aria-label={caption ? undefined : label}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        'rounded-md border border-ink/25 bg-white/60 px-2 font-semibold text-ink focus:border-stamp-blue focus:outline-none disabled:opacity-50',
        caption ? 'mt-1 block h-10 min-w-36 text-sm' : 'h-8 text-xs',
      )}
    >
      {options.map(([option, text]) => (
        <option key={option} value={option}>
          {text}
        </option>
      ))}
    </select>
  )
  if (!caption) return select
  return (
    <label className="block text-xs font-semibold text-ink-soft">
      {label}
      {select}
    </label>
  )
}

const DownloadLink = ({ href }: { href: string }) =>
  DEMO ? (
    <span title="التنزيل يعمل مع الباك إند الحقيقي فقط" className="inline-flex cursor-not-allowed items-center gap-1 text-xs text-ink-faint">
      <Download className="size-4" aria-hidden="true" />
      تجريبي
    </span>
  ) : (
    <a href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-stamp-blue underline-offset-4 hover:underline">
      <Download className="size-4" aria-hidden="true" />
      تنزيل
    </a>
  )

/* ───────────────────────── cases ───────────────────────── */

const EMPTY_CASE = { case_number: '', title: '', case_type: 'civil', priority: 'medium', description: '' }

/**
 * Opens a case for a client in one step: the client is picked from the office, or entered here
 * and created with the case. `client` opens the form with that client already chosen.
 */
export const NewCase = ({ open, onClose, client }: { open: boolean; onClose: () => void; client?: Client | null }) => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [values, setValues] = useState(EMPTY_CASE)
  const [party, setParty] = useState<ClientChoice | null>(null)
  const [missingClient, setMissingClient] = useState(false)
  useEffect(() => {
    if (!open) return
    setValues(EMPTY_CASE)
    setParty(client ? existingChoice(client) : null)
    setMissingClient(false)
  }, [open, client])
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const create = useMutation({
    mutationFn: (chosen: ClientChoice) =>
      api.post<{ case: LegalCase }>('/cases', { ...values, description: values.description.trim() || null, ...clientBody(chosen) }),
    onSuccess: ({ data }) => {
      void queryClient.invalidateQueries({ queryKey: ['cases'] })
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
      void queryClient.invalidateQueries({ queryKey: ['client-cases'] })
      onClose()
      // Straight to the new file, where the team is assigned next.
      void navigate(`/office/cases/${data.case.case_id}`)
    },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!choiceReady(party)) {
      setMissingClient(true)
      return
    }
    create.mutate(party)
  }
  return (
    <Modal open={open} onClose={onClose} title="قضية جديدة">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <ClientChooser value={party} onChange={(choice) => (setParty(choice), setMissingClient(false))} label="الموكّل في القضية" />
          {missingClient && (
            <p role="alert" className="mt-1 text-xs text-stamp">
              {party?.kind === 'new' ? 'اكتب اسم الموكّل الجديد.' : 'اختر الموكّل، أو أضفه موكّلاً جديداً.'}
            </p>
          )}
        </div>
        <Field label="رقم القضية" name="case_number" dir="ltr" required placeholder="2026/180" value={values.case_number} onChange={set('case_number')} />
        <SelectField label="النوع" name="case_type" options={optionsOf(CASE_TYPE)} value={values.case_type} onChange={set('case_type')} />
        <Field label="عنوان القضية" name="title" required value={values.title} onChange={set('title')} className="sm:col-span-2" />
        <SelectField label="الأولوية" name="priority" options={optionsOf(PRIORITY)} value={values.priority} onChange={set('priority')} />
        <TextArea label="وصف مختصر (اختياري)" name="description" value={values.description} onChange={set('description')} className="sm:col-span-2" />
        <div className="sm:col-span-2">
          <FormActions error={create.isError ? messageOf(create.error) : null}>
            <Button variant="line" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" variant="ink" disabled={create.isPending}>
              {create.isPending ? 'يُحفظ…' : 'افتح القضية'}
            </Button>
          </FormActions>
        </div>
      </form>
    </Modal>
  )
}

export const Cases = () => {
  const owner = useIsOwner()
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const cases = useCases(search)
  return (
    <>
      <SheetHeader
        title="سجلّ القضايا"
        note={cases.data ? `${cases.data.length} قضية` : undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox onSearch={setSearch} placeholder="ابحث بالرقم أو العنوان" />
            {owner && <AddButton onClick={() => setAdding(true)}>قضية جديدة</AddButton>}
          </div>
        }
      />
      {cases.isPending ? <Loading /> : cases.isError ? <Failed error={cases.error} /> : cases.data.length === 0 ? <Empty>لا قضايا مطابقة.</Empty> : <CasesTable rows={cases.data} />}
      <NewCase open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

/* ───────────────────────── case file ───────────────────────── */

const TABS = [
  ['people', 'الأطراف والفريق'],
  ['hearings', 'الجلسات'],
  ['notices', 'أوراق المحضرين'],
  ['notes', 'الملاحظات'],
  ['documents', 'المستندات'],
  ['powers', 'التوكيلات'],
  ['library', 'المراجع القانونية'],
  ['tasks', 'المهام'],
  ['finance', 'المالية'],
  ['prep', 'تحضير الجلسة'],
  ['analysis', 'التحليل'],
  ['drafting', 'الصياغة'],
] as const
type TabKey = (typeof TABS)[number][0]

const People = ({ caseId }: { caseId: string }) => {
  const owner = useIsOwner()
  const queryClient = useQueryClient()
  const relationships = useQuery({
    queryKey: ['relationships', caseId],
    queryFn: async () => (await api.get<{ relationships: CaseRelationships }>(`/cases/${caseId}/relationships`)).data.relationships,
  })
  const members = useMembers(owner)
  const [party, setParty] = useState<ClientChoice | null>(null)
  const [userId, setUserId] = useState('')
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['relationships', caseId] })
  // An existing client of the office, or a new one created and linked in one step.
  const link = useMutation({
    mutationFn: (chosen: ClientChoice) => api.post(`/cases/${caseId}/clients`, clientBody(chosen)),
    onSuccess: () => {
      setParty(null)
      void refresh()
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
  })
  const assign = useMutation({ mutationFn: () => api.post(`/cases/${caseId}/assignments`, { user_id: userId }), onSuccess: () => (setUserId(''), refresh()) })
  const [removing, setRemoving] = useState<string | null>(null)
  const unassign = useMutation({
    mutationFn: (id: string) => api.delete(`/cases/${caseId}/assignments/${id}`),
    onSuccess: () => {
      setRemoving(null)
      void refresh()
      void queryClient.invalidateQueries({ queryKey: ['cases'] })
    },
  })

  if (relationships.isPending) return <Loading />
  if (relationships.isError) return <Failed error={relationships.error} />
  const parties = relationships.data.clients ?? []
  const staff = relationships.data.assigned_staff
  const isLawyer = (entry: (typeof staff)[number]) => Boolean(entry.is_lead) || entry.assignment_role !== 'assistant'
  const lawyerCount = staff.filter(isLawyer).length
  const freeStaff = (members.data ?? []).filter((member) => member.role !== 'client' && member.role !== 'admin' && member.status === 'active' && !staff.some((entry) => entry.user_id === member.user_id))

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section>
        <h3 className="text-xl text-ink">الموكّلون في القضية</h3>
        <ul className="mt-3 divide-y divide-rule border-y border-rule">
          {parties.length === 0 && <li className="py-3 text-sm text-ink-faint">لم يُربط موكّل بعد.</li>}
          {parties.map((party) => (
            <li key={party.client_id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <span className="font-semibold text-ink">{party.full_name_or_org}</span>
              <span className="text-ink-soft">{PARTY_ROLE[party.party_role] ?? party.party_role}</span>
            </li>
          ))}
        </ul>
        {owner && (
          <div className="mt-4 space-y-3">
            <ClientChooser value={party} onChange={setParty} exclude={parties.map((entry) => entry.client_id)} label="أضف موكّلاً إلى القضية" />
            {party && (
              <div className="flex justify-end gap-2">
                <Button variant="line" size="sm" onClick={() => setParty(null)}>
                  إلغاء
                </Button>
                <Button variant="ink" size="sm" disabled={!choiceReady(party) || link.isPending} onClick={() => choiceReady(party) && link.mutate(party)}>
                  {link.isPending ? 'يُحفظ…' : party.kind === 'new' ? 'أضفه واربطه' : 'اربط'}
                </Button>
              </div>
            )}
          </div>
        )}
        {link.isError && <p role="alert" className="mt-2 text-sm text-stamp">{messageOf(link.error)}</p>}
      </section>
      <section>
        <h3 className="text-xl text-ink">الفريق المسند</h3>
        <ul className="mt-3 divide-y divide-rule border-y border-rule">
          {staff.length === 0 && <li className="py-3 text-sm text-ink-faint">لم تُسند القضية لأحد بعد.</li>}
          {staff.map((entry) => {
            // The case keeps at least one lawyer, so the only one cannot be removed.
            const onlyLawyer = isLawyer(entry) && lawyerCount <= 1
            const confirming = removing === entry.user_id
            return (
              <li key={entry.user_id ?? entry.full_name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3 text-sm">
                <span className="font-semibold text-ink">{entry.full_name}</span>
                <span className="flex items-center gap-3">
                  <span className="text-ink-soft">{entry.is_lead ? 'محامٍ رئيسي' : (ROLE[entry.role ?? ''] ?? entry.assignment_role)}</span>
                  {owner && entry.user_id && !confirming && (
                    <button
                      type="button"
                      disabled={onlyLawyer || unassign.isPending}
                      title={onlyLawyer ? 'المحامي الوحيد في القضية لا يُزال. أسند محامياً آخر أولاً.' : undefined}
                      onClick={() => (unassign.reset(), setRemoving(entry.user_id!))}
                      className="text-xs font-semibold text-stamp underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-ink-faint disabled:no-underline"
                    >
                      أزل
                    </button>
                  )}
                </span>
                {confirming && (
                  <span className="flex w-full items-center justify-end gap-3 text-xs">
                    <span className="text-ink-soft">
                      إزالة {entry.full_name} من القضية{entry.is_lead && lawyerCount > 1 ? '؟ سيصبح محامٍ آخر رئيسياً.' : '؟'}
                    </span>
                    <button type="button" disabled={unassign.isPending} onClick={() => unassign.mutate(entry.user_id!)} className="font-semibold text-stamp underline-offset-4 hover:underline disabled:opacity-50">
                      {unassign.isPending ? 'تُزال…' : 'نعم، أزل'}
                    </button>
                    <button type="button" disabled={unassign.isPending} onClick={() => setRemoving(null)} className="font-semibold text-ink-soft underline-offset-4 hover:underline">
                      تراجع
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        {owner && lawyerCount === 1 && <p className="mt-2 text-xs text-ink-faint">لا يُزال المحامي الوحيد في القضية؛ أسند محامياً آخر أولاً.</p>}
        {unassign.isError && <p role="alert" className="mt-2 text-sm text-stamp">{messageOf(unassign.error)}</p>}
        {owner && freeStaff.length > 0 && (
          <div className="mt-3 flex items-end gap-2">
            <SelectField label="إسناد لعضو" name="assign-user" className="flex-1" value={userId} onChange={(event) => setUserId(event.target.value)} options={[['', 'اختر عضواً'], ...freeStaff.map((member) => [member.user_id, `${member.full_name} — ${ROLE[member.role]}`] as const)]} />
            <Button variant="ink" disabled={!userId || assign.isPending} onClick={() => assign.mutate()}>
              أسند
            </Button>
          </div>
        )}
        {assign.isError && <p role="alert" className="mt-2 text-sm text-stamp">{messageOf(assign.error)}</p>}
      </section>
      <Opponents caseId={caseId} />
    </div>
  )
}

const EMPTY_OPPONENT = { full_name: '', national_id: '', phone: '' }

/** The other side of the case. Adding one checks it against the office's clients first. */
const Opponents = ({ caseId }: { caseId: string }) => {
  const owner = useIsOwner()
  const queryClient = useQueryClient()
  const opponents = useQuery({
    queryKey: ['opponents', caseId],
    queryFn: async () => (await api.get<{ opponents: Opponent[] }>(`/cases/${caseId}/opponents`)).data.opponents,
  })
  const [values, setValues] = useState(EMPTY_OPPONENT)
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const conflicts = useConflictCheck({ name: values.full_name, national_id: values.national_id, phone: values.phone, role: 'opponent', enabled: owner })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['opponents', caseId] })
    void queryClient.invalidateQueries({ queryKey: ['conflicts'] })
  }
  const add = useMutation({
    mutationFn: () =>
      api.post(`/cases/${caseId}/opponents`, {
        full_name: values.full_name.trim(),
        national_id: values.national_id.trim() || null,
        phone: values.phone.trim() || null,
      }),
    onSuccess: () => {
      setValues(EMPTY_OPPONENT)
      refresh()
    },
  })
  const remove = useMutation({ mutationFn: (opponentId: string) => api.delete(`/cases/${caseId}/opponents/${opponentId}`), onSuccess: refresh })

  return (
    <section className="md:col-span-2">
      <h3 className="text-xl text-ink">الخصوم</h3>
      <p className="mt-0.5 text-xs text-ink-soft">الطرف الآخر في القضية. يُقارن كل خصم بموكّلي المكتب لكشف تعارض المصالح.</p>
      {opponents.isPending ? (
        <Loading />
      ) : opponents.isError ? (
        <Failed error={opponents.error} />
      ) : (
        <ul className="mt-3 divide-y divide-rule border-y border-rule">
          {opponents.data.length === 0 && <li className="py-3 text-sm text-ink-faint">لم يُسجّل خصم بعد.</li>}
          {opponents.data.map((opponent) => (
            <li key={opponent.opponent_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <span>
                <span className="font-semibold text-ink">{opponent.full_name}</span>
                {opponent.national_id && <span className="ms-2 text-xs text-ink-soft">هوية: <bdi>{opponent.national_id}</bdi></span>}
                {opponent.phone && <span className="ms-2 text-xs text-ink-soft"><bdi>{opponent.phone}</bdi></span>}
              </span>
              {owner && (
                <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(opponent.opponent_id)} className="text-xs font-semibold text-stamp underline-offset-4 hover:underline disabled:opacity-50">
                  إزالة
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {owner && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            add.mutate()
          }}
          className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        >
          <Field label="اسم الخصم أو الجهة" name="opponent-name" required value={values.full_name} onChange={set('full_name')} />
          <Field label="رقم الهوية أو التسجيل" name="opponent-id" dir="ltr" value={values.national_id} onChange={set('national_id')} />
          <Field label="الهاتف" name="opponent-phone" dir="ltr" value={values.phone} onChange={set('phone')} />
          <Button type="submit" variant="ink" disabled={!values.full_name.trim() || add.isPending}>
            {add.isPending ? 'يُضاف…' : 'أضف خصماً'}
          </Button>
          <ConflictNotice result={conflicts.data} role="opponent" className="sm:col-span-4" />
        </form>
      )}
      {(add.isError || remove.isError) && <p role="alert" className="mt-2 text-sm text-stamp">{messageOf(add.error ?? remove.error)}</p>}
    </section>
  )
}

const Notes = ({ caseId }: { caseId: string }) => {
  const owner = useIsOwner()
  const queryClient = useQueryClient()
  const notes = useQuery({
    queryKey: ['notes', caseId],
    queryFn: async () => (await api.get<{ notes: CaseNote[] }>(`/cases/${caseId}/notes`, { params: { pageSize: 50 } })).data.notes,
  })
  const [body, setBody] = useState('')
  const [visibility, setVisibility] = useState('case_team')
  const add = useMutation({
    mutationFn: () => api.post(`/cases/${caseId}/notes`, { body: body.trim(), visibility }),
    onSuccess: () => {
      setBody('')
      void queryClient.invalidateQueries({ queryKey: ['notes', caseId] })
    },
  })
  // Only the office administrator may publish a note to the client.
  const visibilityOptions = optionsOf(VISIBILITY).filter(([value]) => owner || value !== 'client_visible')
  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_18rem]">
      <div>
        {notes.isPending ? (
          <Loading />
        ) : notes.isError ? (
          <Failed error={notes.error} />
        ) : notes.data.length === 0 ? (
          <Empty>لا ملاحظات على هذه القضية بعد.</Empty>
        ) : (
          <ul className="space-y-3">
            {notes.data.map((note) => (
              <li key={note.note_id} className={cn('border-s-4 bg-paper-shade p-4', note.visibility === 'client_visible' ? 'border-stamp-green' : note.visibility === 'internal' ? 'border-ink' : 'border-stamp-blue')}>
                {note.voice && <VoicePlayer clip={note.voice} className="mb-2" />}
                {note.body && <p className="leading-relaxed whitespace-pre-wrap text-ink">{note.body}</p>}
                <p className="mt-2 text-xs text-ink-soft">
                  {formatDate(note.created_at)} · {VISIBILITY[note.visibility]?.text}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          add.mutate()
        }}
        className="h-fit space-y-3 rounded-lg border border-ink/15 p-4"
      >
        <TextArea label="ملاحظة جديدة" name="note" rows={4} required value={body} onChange={(event) => setBody(event.target.value)} />
        <DictateButton onText={(spoken) => setBody((current) => appendText(current, spoken))} />
        <SelectField label="من يراها؟" name="visibility" options={visibilityOptions} value={visibility} onChange={(event) => setVisibility(event.target.value)} />
        {add.isError && <p role="alert" className="text-sm text-stamp">{messageOf(add.error)}</p>}
        <Button type="submit" variant="ink" disabled={!body.trim() || add.isPending} className="w-full">
          {add.isPending ? 'تُحفظ…' : 'أضف الملاحظة'}
        </Button>
        <div className="border-t border-rule pt-3">
          <p className="mb-2 text-xs text-ink-soft">أو سجّل ملاحظة صوتية (حتى دقيقتين)، بالخصوصية المختارة أعلاه:</p>
          <VoiceRecorder
            sendLabel="احفظ الملاحظة"
            onSend={async (clip) => {
              await api.post(`/cases/${caseId}/notes`, { voice_clip_id: clip.clip_id, visibility, ...(body.trim() ? { body: body.trim() } : {}) })
              setBody('')
              void queryClient.invalidateQueries({ queryKey: ['notes', caseId] })
            }}
          />
        </div>
      </form>
    </div>
  )
}

const useDocuments = (caseId?: string, search = '') =>
  useQuery({
    queryKey: ['documents', caseId ?? 'all', search],
    queryFn: async () => (await api.get<{ documents: DocumentRecord[] }>('/documents', { params: { pageSize: 50, ...(caseId ? { caseId } : {}), ...(search ? { search } : {}) } })).data.documents,
  })

const DocumentsTable = ({ rows, cases, onShare }: { rows: DocumentRecord[]; cases?: LegalCase[]; onShare?: (document: DocumentRecord) => void }) => (
  <Table head={['الملف', 'النوع', ...(cases ? ['القضية'] : []), 'التاريخ', 'الوصول', '']}>
    {rows.map((row) => (
      <tr key={row.document_id} className={ROW}>
        <td className={cn(TD, 'font-semibold')} dir="ltr">
          {row.file_name}
        </td>
        <td className={TD}>{row.document_type}</td>
        {cases && <td className={TD}>{cases.find((entry) => entry.case_id === row.case_id)?.case_number ?? '—'}</td>}
        <td className={cn(TD, 'whitespace-nowrap text-ink-soft')}>{formatDate(row.document_date ?? row.created_at)}</td>
        <td className={TD}>
          <Stamp tone={ACCESS_LEVEL[row.access_level]?.tone} rotate={0} className="text-xs">
            {ACCESS_LEVEL[row.access_level]?.text}
          </Stamp>
        </td>
        <td className={cn(TD, 'text-end')}>
          <div className="flex flex-col items-end gap-1">
            <DownloadLink href={`${API_URL}/documents/${row.document_id}/download`} />
            {onShare && (
              <button type="button" onClick={() => onShare(row)} className="text-xs font-semibold text-stamp-green underline-offset-4 hover:underline">
                {row.access_level === 'authorized_users' ? 'المشاركة' : 'شارك مع الموكّل'}
              </button>
            )}
          </div>
        </td>
      </tr>
    ))}
  </Table>
)

const UploadDocument = ({ caseId, open, onClose }: { caseId: string; open: boolean; onClose: () => void }) => {
  const queryClient = useQueryClient()
  const relationships = useQuery({
    queryKey: ['relationships', caseId],
    enabled: open,
    queryFn: async () => (await api.get<{ relationships: CaseRelationships }>(`/cases/${caseId}/relationships`)).data.relationships,
  })
  const parties = relationships.data?.clients ?? []
  const [file, setFile] = useState<File | null>(null)
  const [type, setType] = useState('')
  const [level, setLevel] = useState('case_team')
  const [clientId, setClientId] = useState('')
  const upload = useMutation({
    mutationFn: () =>
      api.post(`/cases/${caseId}/documents`, file, {
        headers: {
          'Content-Type': 'application/pdf',
          'X-Document-File-Name': safePdfName(file!.name),
          'X-Document-Type': headerValue(type),
          'X-Document-Access-Level': level,
          ...(level === 'authorized_users' && clientId ? { 'X-Document-Client-Id': clientId } : {}),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] })
      setFile(null)
      setType('')
      onClose()
    },
  })
  const needsClient = level === 'authorized_users'
  return (
    <Modal open={open} onClose={onClose} title="رفع مستند">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          upload.mutate()
        }}
        className="space-y-4"
      >
        <div>
          <label htmlFor="document-file" className="block text-xs font-semibold text-ink-soft">
            الملف (PDF فقط، حتى 10 ميغابايت)
          </label>
          <input id="document-file" type="file" accept="application/pdf" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm text-ink file:me-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-2 file:text-sm file:font-semibold file:text-paper" />
        </div>
        <Field label="نوع المستند" name="document_type" required placeholder="لائحة دعوى، عقد، وكالة…" value={type} onChange={(event) => setType(event.target.value)} />
        <SelectField label="من يراه؟" name="access_level" options={optionsOf(ACCESS_LEVEL)} value={level} onChange={(event) => setLevel(event.target.value)} />
        {needsClient && (
          <SelectField label="الموكّل الذي يُشارَك معه" name="client" value={clientId} onChange={(event) => setClientId(event.target.value)} options={[['', 'اختر موكّلاً'], ...parties.map((party) => [party.client_id, party.full_name_or_org] as const)]} />
        )}
        <FormActions error={upload.isError ? messageOf(upload.error) : null}>
          <Button variant="line" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" variant="ink" disabled={!file || !type.trim() || (needsClient && !clientId) || upload.isPending}>
            {upload.isPending ? 'يُرفع…' : 'ارفع'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  )
}

const CaseDocuments = ({ caseId }: { caseId: string }) => {
  const documents = useDocuments(caseId)
  const [uploading, setUploading] = useState(false)
  const [sharing, setSharing] = useState<DocumentRecord | null>(null)
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button variant="ink" size="sm" onClick={() => setUploading(true)}>
          <Upload className="size-4" aria-hidden="true" />
          رفع مستند
        </Button>
      </div>
      {documents.isPending ? <Loading /> : documents.isError ? <Failed error={documents.error} /> : documents.data.length === 0 ? <Empty>لا مستندات في هذه القضية بعد.</Empty> : <DocumentsTable rows={documents.data} onShare={setSharing} />}
      <ShareDocument document={sharing} onClose={() => setSharing(null)} />
      <UploadDocument caseId={caseId} open={uploading} onClose={() => setUploading(false)} />
    </>
  )
}

/** What the case has cost its clients so far: fees, court fees and expenses, per currency. */
const CaseFinance = ({ caseId }: { caseId: string }) => {
  const owner = useIsOwner()
  const invoices = useInvoices({ case_id: caseId })
  const relationships = useQuery({
    queryKey: ['relationships', caseId],
    queryFn: async () => (await api.get<{ relationships: CaseRelationships }>(`/cases/${caseId}/relationships`)).data.relationships,
  })
  const [billing, setBilling] = useState(false)
  const parties = (relationships.data?.clients ?? []).map((party) => ({ client_id: party.client_id, full_name_or_org: party.full_name_or_org }))
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">الأتعاب ورسوم المحكمة والمصاريف المطالب بها في هذه القضية، وما دُفع منها.</p>
        {owner && <AddButton onClick={() => setBilling(true)}>مطالبة جديدة</AddButton>}
      </div>
      {owner && <CaseProfit caseId={caseId} />}
      {invoices.isPending ? (
        <Loading />
      ) : invoices.isError ? (
        <Failed error={invoices.error} />
      ) : invoices.data.length === 0 ? (
        <Empty>لا مطالبات مالية في هذه القضية بعد.</Empty>
      ) : (
        <>
          <InvoiceTotals invoices={invoices.data} />
          <InvoicesTable rows={invoices.data} owner={owner} showCase={false} />
        </>
      )}
      {owner && <NewInvoice open={billing} onClose={() => setBilling(false)} caseId={caseId} clients={parties} />}
    </div>
  )
}

export const CaseFile = () => {
  const { caseId = '' } = useParams()
  const queryClient = useQueryClient()
  const [tabParam, setTabParam] = useParam('tab')
  const tab = oneOf(tabParam, TABS.map(([key]) => key), 'people')
  const setTab = (key: TabKey) => setTabParam(key === 'people' ? null : key)
  const record = useQuery({
    queryKey: ['case', caseId],
    queryFn: async () => (await api.get<{ case: LegalCase }>(`/cases/${caseId}`)).data.case,
  })
  const tasks = useTasks()
  const update = useMutation({
    mutationFn: (patch: Partial<LegalCase>) => api.patch(`/cases/${caseId}`, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['case', caseId] })
      void queryClient.invalidateQueries({ queryKey: ['cases'] })
    },
  })
  if (record.isPending) return <Loading />
  if (record.isError) return <Failed error={record.error} />
  const row = record.data
  const caseTasks = (tasks.data ?? []).filter((task) => task.case_id === caseId)

  return (
    <>
      <Link to="/office/cases" className="text-sm text-ink-soft underline-offset-4 hover:underline">
        → سجلّ القضايا
      </Link>
      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-5">
        <div className="min-w-0">
          <p className="font-doc text-xl font-bold text-stamp" dir="ltr">
            {row.case_number}
          </p>
          <h1 className="mt-1 text-3xl text-ink">{row.title}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {CASE_TYPE[row.case_type] ?? row.case_type} · فُتحت {formatDate(row.opened_at)}
            {row.closed_at && ` · أُغلقت ${formatDate(row.closed_at)}`}
          </p>
          {row.description && <p className="mt-3 max-w-2xl leading-relaxed text-ink">{row.description}</p>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <QuickSelect caption label="حالة القضية" value={row.status} options={optionsOf(CASE_STATUS)} disabled={update.isPending} onChange={(status) => update.mutate({ status: status as LegalCase['status'] })} />
          <QuickSelect caption label="أولوية القضية" value={row.priority} options={optionsOf(PRIORITY)} disabled={update.isPending} onChange={(priority) => update.mutate({ priority: priority as LegalCase['priority'] })} />
        </div>
      </div>
      {update.isError && <p role="alert" className="mb-4 text-sm text-stamp">{messageOf(update.error)}</p>}

      <div role="tablist" aria-label="أقسام القضية" className="mb-6 flex flex-wrap gap-1 border-b border-rule">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors', tab === key ? 'border-stamp text-ink' : 'border-transparent text-ink-soft hover:text-ink')}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'people' && <People caseId={caseId} />}
      {tab === 'hearings' && <CaseHearings caseId={caseId} />}
      {tab === 'notices' && <CaseNotices caseId={caseId} />}
      {tab === 'notes' && <Notes caseId={caseId} />}
      {tab === 'documents' && <CaseDocuments caseId={caseId} />}
      {tab === 'powers' && <CasePowers caseId={caseId} />}
      {tab === 'library' && <CaseLibrary caseId={caseId} />}
      {tab === 'tasks' && (caseTasks.length === 0 ? <Empty>لا مهام مرتبطة بهذه القضية.</Empty> : <TasksTable rows={caseTasks} />)}
      {tab === 'finance' && <CaseFinance caseId={caseId} />}
      {tab === 'prep' && <HearingPrepTab caseId={caseId} />}
      {tab === 'analysis' && <CaseAnalysis caseId={caseId} />}
      {tab === 'drafting' && <CaseDrafting caseId={caseId} />}
    </>
  )
}

/* ───────────────────────── clients ───────────────────────── */

const EMPTY_CLIENT = { client_type: 'individual', full_name_or_org: '', national_id: '', phone: '', email: '', address: '' }

const ClientForm = ({
  client,
  open,
  onClose,
  onNewCase,
}: {
  client: Client | null
  open: boolean
  onClose: () => void
  /** Opens a new case for this client (office administrator only). */
  onNewCase?: (client: Client) => void
}) => {
  const owner = useIsOwner()
  const queryClient = useQueryClient()
  const [values, setValues] = useState(EMPTY_CLIENT)
  // A new client may be invited to the client portal right away, by the email entered here.
  const [invite, setInvite] = useState(true)
  const [created, setCreated] = useState<{ result: InviteResult | null; error: string | null } | null>(null)
  useEffect(() => {
    if (open) setCreated(null)
    if (open)
      setValues(
        client
          ? { client_type: client.client_type, full_name_or_org: client.full_name_or_org, national_id: client.national_id ?? '', phone: client.phone ?? '', email: client.email ?? '', address: client.address ?? '' }
          : EMPTY_CLIENT,
      )
  }, [open, client])
  // Taking on a new client: is this person on the other side of one of the office's cases?
  const conflicts = useConflictCheck({
    name: values.full_name_or_org,
    national_id: values.national_id,
    phone: values.phone,
    role: 'client',
    excludeClientId: client?.client_id,
    enabled: open && owner,
  })
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const linked = useQuery({
    queryKey: ['client-cases', client?.client_id],
    enabled: open && client !== null,
    queryFn: async () => (await api.get<{ cases: LegalCase[] }>(`/clients/${client!.client_id}/cases`)).data.cases,
  })
  const save = useMutation({
    mutationFn: () => {
      const contact = { phone: values.phone.trim() || null, email: values.email.trim() || null, address: values.address.trim() || null }
      // Staff may correct contact details; only the office administrator edits identity fields.
      const body =
        owner || !client
          ? { client_type: values.client_type, full_name_or_org: values.full_name_or_org.trim(), national_id: values.national_id.trim() || null, ...contact }
          : contact
      if (client) return api.patch(`/clients/${client.client_id}`, body).then(() => null)
      return api.post<{ client: Client }>('/clients', body).then(async ({ data }) => {
        if (!sendsInvite) return null
        // The client is saved either way; a failed invitation can be sent again from the list.
        try {
          return { result: await sendInvitation({ email: values.email.trim(), role: 'client', client_id: data.client.client_id }), error: null }
        } catch (error) {
          return { result: null, error: messageOf(error) }
        }
      })
    },
    onSuccess: (outcome) => {
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
      if (outcome) setCreated(outcome)
      else onClose()
    },
  })
  const identityLocked = client !== null && !owner
  const sendsInvite = owner && client === null && invite && values.email.trim() !== ''
  return (
    <Modal open={open} onClose={onClose} title={client ? 'بيانات الموكّل' : 'موكّل جديد'}>
      {created ? (
        created.result ? (
          <InviteLink result={created.result} onDone={onClose} title={created.result.sent ? 'أُضيف الموكّل وأُرسلت دعوته' : 'أُضيف الموكّل وأُنشئت دعوته'} />
        ) : (
          <div>
            <p className="text-sm text-ink">حُفظ الموكّل، لكن تعذّر إنشاء دعوته: {created.error}</p>
            <p className="mt-2 text-xs text-ink-soft">يمكنك إرسالها لاحقاً من عمود «البوابة» في قائمة الموكّلين.</p>
            <FormActions>
              <Button variant="line" onClick={onClose}>
                تم
              </Button>
            </FormActions>
          </div>
        )
      ) : (
      <form
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field label="الاسم أو اسم الجهة" name="full_name_or_org" required disabled={identityLocked} value={values.full_name_or_org} onChange={set('full_name_or_org')} className="sm:col-span-2" />
        <SelectField label="النوع" name="client_type" disabled={identityLocked} options={[['individual', 'فرد'], ['organization', 'شركة أو جهة']]} value={values.client_type} onChange={set('client_type')} />
        <Field
          label={values.client_type === 'organization' ? 'رقم التسجيل' : 'رقم الهوية'}
          name="national_id"
          dir="ltr"
          disabled={identityLocked}
          value={values.national_id}
          onChange={set('national_id')}
          hint="اختياري، ويُستعمل لفحص تعارض المصالح."
        />
        <Field label="الهاتف" name="phone" dir="ltr" value={values.phone} onChange={set('phone')} />
        <Field label="البريد الإلكتروني" name="email" type="email" dir="ltr" value={values.email} onChange={set('email')} />
        <Field label="العنوان" name="address" value={values.address} onChange={set('address')} className="sm:col-span-2" />
        {owner && client === null && (
          <label className="flex items-start gap-2 text-sm text-ink sm:col-span-2">
            <input type="checkbox" checked={invite} onChange={(event) => setInvite(event.target.checked)} className="mt-0.5 size-4 accent-ink" />
            <span>
              أرسل له دعوة إلى بوابة الموكّل على بريده
              <span className="block text-xs text-ink-soft">{values.email.trim() ? 'يصله رابط ينشئ به حسابه ويتابع قضاياه.' : 'أدخل البريد الإلكتروني لإرسال الدعوة.'}</span>
            </span>
          </label>
        )}
        {owner && <ConflictNotice result={conflicts.data} role="client" className="sm:col-span-2" />}
        {client && (
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-ink-soft">قضاياه</p>
              {owner && onNewCase && (
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    onNewCase(client)
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-stamp underline-offset-4 hover:underline"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  قضية جديدة لهذا الموكّل
                </button>
              )}
            </div>
            <ul className="mt-1 text-sm text-ink">
              {linked.data?.length === 0 && <li className="text-ink-faint">لا قضايا مرتبطة.</li>}
              {linked.data?.map((row) => (
                <li key={row.case_id}>
                  <Link to={`/office/cases/${row.case_id}`} onClick={onClose} className="underline-offset-4 hover:text-stamp hover:underline">
                    <span dir="ltr">{row.case_number}</span> — {row.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="sm:col-span-2">
          <FormActions error={save.isError ? messageOf(save.error) : null}>
            <Button variant="line" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" variant="ink" disabled={save.isPending}>
              {save.isPending ? 'يُحفظ…' : sendsInvite ? 'احفظ وأرسل الدعوة' : 'احفظ'}
            </Button>
          </FormActions>
        </div>
      </form>
      )}
    </Modal>
  )
}

/** Sends (or sends again) a client's invitation to the client portal. */
const PortalInvite = ({ client, onClose }: { client: Client | null; onClose: () => void }) => {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [result, setResult] = useState<InviteResult | null>(null)
  const portal = client?.portal
  useEffect(() => {
    if (!client) return
    setResult(null)
    setEmail(client.portal?.status === 'invited' ? client.portal.invited_email : (client.email ?? ''))
  }, [client])
  const send = useMutation({
    mutationFn: async () => {
      // A new link replaces the one already waiting.
      if (portal?.status === 'invited') await api.delete(`/offices/current/invitations/${portal.invitation_id}`)
      return sendInvitation({ email: email.trim(), role: 'client', client_id: client!.client_id })
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
      setResult(data)
    },
  })
  const close = () => {
    send.reset()
    onClose()
  }
  return (
    <Modal open={client !== null} onClose={close} title={portal?.status === 'invited' ? 'إعادة إرسال الدعوة' : 'دعوة إلى بوابة الموكّل'}>
      {result ? (
        <InviteLink result={result} onDone={close} />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            send.mutate()
          }}
          className="space-y-4"
        >
          <p className="text-sm text-ink-soft">
            يصل <span className="font-semibold text-ink">{client?.full_name_or_org}</span> رابط يفتح نافذة تسجيل الموكّل، فينشئ حسابه ويُربط بسجلّه هنا ليتابع قضاياه ووثائقه.
          </p>
          <Field label="بريد الموكّل" name="portal-email" type="email" dir="ltr" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <FormActions error={send.isError ? messageOf(send.error) : null}>
            <Button variant="line" onClick={close}>
              إلغاء
            </Button>
            <Button type="submit" variant="ink" disabled={!email.trim() || send.isPending}>
              {send.isPending ? 'تُرسل…' : 'أرسل الدعوة'}
            </Button>
          </FormActions>
        </form>
      )}
    </Modal>
  )
}

const LINK_BUTTON = 'text-xs font-semibold underline-offset-4 hover:underline disabled:opacity-50'

/** The office administrator's control over one client's portal access. */
const PortalActions = ({ client, onInvite }: { client: Client; onInvite: (client: Client) => void }) => {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['clients'] })
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/offices/current/invitations/${id}`), onSuccess: refresh })
  const setStatus = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/users/${id}/status`, { status }), onSuccess: refresh })
  const portal = client.portal ?? { status: 'none' as const }
  const label = PORTAL_STATUS[portal.status]
  const busy = revoke.isPending || setStatus.isPending
  const error = revoke.error ?? setStatus.error
  return (
    <div className="flex flex-col items-start gap-1">
      <Pill tone={label?.tone}>{label?.text}</Pill>
      <div className="flex flex-wrap gap-x-3">
        {portal.status === 'none' && (
          <button type="button" onClick={() => onInvite(client)} className={cn(LINK_BUTTON, 'text-stamp-blue')}>
            أرسل دعوة
          </button>
        )}
        {portal.status === 'invited' && (
          <>
            <button type="button" disabled={busy} onClick={() => onInvite(client)} className={cn(LINK_BUTTON, 'text-stamp-blue')}>
              أعد الإرسال
            </button>
            <button type="button" disabled={busy} onClick={() => revoke.mutate(portal.invitation_id)} className={cn(LINK_BUTTON, 'text-stamp')}>
              ألغِ الدعوة
            </button>
          </>
        )}
        {(portal.status === 'active' || portal.status === 'suspended') && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setStatus.mutate({ id: portal.user_id, status: portal.status === 'active' ? 'suspended' : 'active' })}
            className={cn(LINK_BUTTON, portal.status === 'active' ? 'text-stamp' : 'text-stamp-green')}
          >
            {portal.status === 'active' ? 'أوقف الوصول' : 'فعّل الوصول'}
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-stamp">{messageOf(error)}</p>}
    </div>
  )
}

export const Clients = () => {
  const owner = useIsOwner()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Client | 'new' | null>(null)
  const [inviting, setInviting] = useState<Client | null>(null)
  const [newCaseFor, setNewCaseFor] = useState<Client | null>(null)
  const clients = useQuery({
    queryKey: ['clients', search],
    queryFn: async () => (await api.get<{ clients: Client[] }>('/clients', { params: { pageSize: 50, ...(search ? { search } : {}) } })).data.clients,
  })
  return (
    <>
      <SheetHeader
        title="الموكّلون"
        note={clients.data ? `${clients.data.length} موكّل` : undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox onSearch={setSearch} placeholder="ابحث بالاسم أو الهاتف" />
            {owner && <AddButton onClick={() => setEditing('new')}>موكّل جديد</AddButton>}
          </div>
        }
      />
      {clients.isPending ? (
        <Loading />
      ) : clients.isError ? (
        <Failed error={clients.error} />
      ) : clients.data.length === 0 ? (
        <Empty>لا موكّلين مطابقين.</Empty>
      ) : (
        <Table head={owner ? ['الاسم', 'النوع', 'الهاتف', 'البريد', 'البوابة', 'أُضيف', ''] : ['الاسم', 'النوع', 'الهاتف', 'البريد', 'أُضيف', '']}>
          {clients.data.map((client) => (
            <tr key={client.client_id} className={ROW}>
              <td className={cn(TD, 'font-semibold')}>{client.full_name_or_org}</td>
              <td className={cn(TD, 'whitespace-nowrap')}>{client.client_type === 'organization' ? 'شركة أو جهة' : 'فرد'}</td>
              <td className={cn(TD, 'whitespace-nowrap')}>
                <bdi>{client.phone ?? '—'}</bdi>
              </td>
              <td className={TD}>
                <bdi>{client.email ?? '—'}</bdi>
              </td>
              {owner && (
                <td className={TD}>
                  <PortalActions client={client} onInvite={setInviting} />
                </td>
              )}
              <td className={cn(TD, 'whitespace-nowrap text-ink-soft')}>{formatDate(client.created_at)}</td>
              <td className={cn(TD, 'text-end whitespace-nowrap')}>
                {owner && (
                  <>
                    <button type="button" onClick={() => setNewCaseFor(client)} className="me-3 text-xs font-semibold text-stamp underline-offset-4 hover:underline">
                      قضية جديدة
                    </button>
                    <Link to={`/office/clients/${client.client_id}/statement`} className="me-3 text-xs font-semibold text-ink-soft underline-offset-4 hover:text-stamp hover:underline">
                      كشف حساب
                    </Link>
                  </>
                )}
                <Link to={`/office/powers-of-attorney?client=${client.client_id}`} className="me-3 text-xs font-semibold text-ink-soft underline-offset-4 hover:text-stamp hover:underline">
                  التوكيلات
                </Link>
                <button type="button" onClick={() => setEditing(client)} className="text-xs font-semibold text-stamp-blue underline-offset-4 hover:underline">
                  فتح
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <ClientForm client={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} onNewCase={setNewCaseFor} />
      {owner && <PortalInvite client={inviting} onClose={() => setInviting(null)} />}
      {owner && <NewCase open={newCaseFor !== null} client={newCaseFor} onClose={() => setNewCaseFor(null)} />}
    </>
  )
}

/* ───────────────────────── tasks ───────────────────────── */

const TasksTable = ({ rows, cases, personal = false }: { rows: Task[]; cases?: LegalCase[]; personal?: boolean }) => {
  const queryClient = useQueryClient()
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/tasks/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
  // Private tasks have no case and no other assignee: those columns give way to a delete action.
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/tasks/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
  const [confirming, setConfirming] = useState<string | null>(null)
  if (personal)
    return (
      <>
        {remove.isError && <p role="alert" className="mb-3 text-sm text-stamp">{messageOf(remove.error)}</p>}
        <Table head={['المهمة', 'الموعد', 'الأولوية', 'الحالة', '']}>
          {rows.map((task) => {
            const open = task.status === 'pending' || task.status === 'in_progress'
            const late = open && task.due_at !== null && new Date(task.due_at) < new Date()
            return (
              <tr key={task.task_id} className={ROW}>
                <td className={TD}>
                  <p className={cn('font-semibold', task.status === 'completed' && 'text-ink-faint line-through')}>{task.title}</p>
                  {task.description && <p className="text-xs whitespace-pre-line text-ink-soft">{task.description}</p>}
                </td>
                <td className={cn(TD, 'whitespace-nowrap', late ? 'font-semibold text-stamp' : 'text-ink-soft')}>{dueLabel(task.due_at)}</td>
                <td className={TD}>{PRIORITY[task.priority]?.text}</td>
                <td className={TD}>
                  <QuickSelect label="حالة المهمة" value={task.status} options={optionsOf(TASK_STATUS)} disabled={update.isPending} onChange={(status) => update.mutate({ id: task.task_id, status })} />
                </td>
                <td className={cn(TD, 'text-end whitespace-nowrap')}>
                  {confirming === task.task_id ? (
                    <span className="inline-flex gap-3 text-xs font-semibold">
                      <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(task.task_id, { onSuccess: () => setConfirming(null) })} className="text-stamp underline-offset-4 hover:underline disabled:opacity-50">
                        نعم، احذف
                      </button>
                      <button type="button" onClick={() => setConfirming(null)} className="text-ink-soft underline-offset-4 hover:underline">
                        تراجع
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirming(task.task_id)} className="text-xs font-semibold text-stamp underline-offset-4 hover:underline">
                      احذف
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </Table>
      </>
    )
  return (
    <Table head={['المهمة', ...(cases ? ['القضية'] : []), 'المسؤول', 'الموعد', 'الأولوية', 'الحالة']}>
      {rows.map((task) => {
        const open = task.status === 'pending' || task.status === 'in_progress'
        const late = open && task.due_at !== null && new Date(task.due_at) < new Date()
        return (
          <tr key={task.task_id} className={ROW}>
            <td className={TD}>
              <p className={cn('font-semibold', task.status === 'completed' && 'text-ink-faint line-through')}>{task.title}</p>
              {task.description && <p className="text-xs text-ink-soft">{task.description}</p>}
            </td>
            {cases && (
              <td className={TD}>
                {task.case_id ? (
                  <Link to={`/office/cases/${task.case_id}`} className="underline-offset-4 hover:text-stamp hover:underline" dir="ltr">
                    {cases.find((entry) => entry.case_id === task.case_id)?.case_number ?? '—'}
                  </Link>
                ) : (
                  '—'
                )}
              </td>
            )}
            <td className={TD}>{task.assigned_to_name}</td>
            <td className={cn(TD, 'whitespace-nowrap', late ? 'font-semibold text-stamp' : 'text-ink-soft')}>{dueLabel(task.due_at)}</td>
            <td className={TD}>{PRIORITY[task.priority]?.text}</td>
            <td className={TD}>
              <QuickSelect label="حالة المهمة" value={task.status} options={optionsOf(TASK_STATUS)} disabled={update.isPending} onChange={(status) => update.mutate({ id: task.task_id, status })} />
            </td>
          </tr>
        )
      })}
    </Table>
  )
}

const NewTask = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const queryClient = useQueryClient()
  const members = useMembers(open)
  const cases = useCases()
  const empty = { title: '', description: '', priority: 'medium', due: '', assignee: '', caseId: '' }
  const [values, setValues] = useState(empty)
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const staff = (members.data ?? []).filter((member) => member.role !== 'client' && member.status === 'active')
  const create = useMutation({
    mutationFn: () =>
      api.post('/tasks', {
        title: values.title.trim(),
        priority: values.priority,
        assigned_to_user_id: values.assignee,
        ...(values.description.trim() ? { description: values.description.trim() } : {}),
        ...(values.due ? { due_at: new Date(values.due).toISOString() } : {}),
        ...(values.caseId ? { case_id: values.caseId } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setValues(empty)
      onClose()
    },
  })
  return (
    <Modal open={open} onClose={onClose} title="مهمة جديدة">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field label="عنوان المهمة" name="title" required value={values.title} onChange={set('title')} className="sm:col-span-2" />
        <SelectField label="المسؤول" name="assignee" required value={values.assignee} onChange={set('assignee')} options={[['', 'اختر عضواً'], ...staff.map((member) => [member.user_id, `${member.full_name} — ${ROLE[member.role]}`] as const)]} />
        <SelectField label="الأولوية" name="priority" options={optionsOf(PRIORITY)} value={values.priority} onChange={set('priority')} />
        <Field label="موعد الإنجاز" name="due" type="datetime-local" dir="ltr" value={values.due} onChange={set('due')} />
        <SelectField label="القضية (اختياري)" name="case" value={values.caseId} onChange={set('caseId')} options={[['', 'بدون قضية'], ...(cases.data ?? []).map((row) => [row.case_id, `${row.case_number} — ${row.title}`] as const)]} />
        <TextArea label="تفاصيل (اختياري)" name="description" value={values.description} onChange={set('description')} className="sm:col-span-2" />
        <div className="sm:col-span-2">
          <FormActions error={create.isError ? messageOf(create.error) : null}>
            <Button variant="line" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" variant="ink" disabled={!values.title.trim() || !values.assignee || create.isPending}>
              {create.isPending ? 'تُحفظ…' : 'أضف المهمة'}
            </Button>
          </FormActions>
        </div>
      </form>
    </Modal>
  )
}

/** A staff member's own task: seen by them alone, apart from what the office assigns. */
const NewPrivateTask = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const queryClient = useQueryClient()
  const empty = { title: '', description: '', priority: 'medium', due: '' }
  const [values, setValues] = useState(empty)
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const create = useMutation({
    mutationFn: () =>
      api.post('/tasks/private', {
        title: values.title.trim(),
        priority: values.priority,
        ...(values.description.trim() ? { description: values.description.trim() } : {}),
        ...(values.due ? { due_at: new Date(values.due).toISOString() } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setValues(empty)
      onClose()
    },
  })
  return (
    <Modal open={open} onClose={onClose} title="مهمة خاصة">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <p className="text-xs text-ink-soft sm:col-span-2">تظهر لك وحدك، ولا يراها مدير المكتب ولا بقية الفريق.</p>
        <Field label="عنوان المهمة" name="title" required value={values.title} onChange={set('title')} className="sm:col-span-2" />
        <SelectField label="الأولوية" name="priority" options={optionsOf(PRIORITY)} value={values.priority} onChange={set('priority')} />
        <Field label="موعد الإنجاز (اختياري)" name="due" type="datetime-local" dir="ltr" value={values.due} onChange={set('due')} />
        <TextArea label="ملاحظات (اختياري)" name="description" value={values.description} onChange={set('description')} className="sm:col-span-2" />
        <div className="sm:col-span-2">
          <FormActions error={create.isError ? messageOf(create.error) : null}>
            <Button variant="line" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" variant="ink" disabled={!values.title.trim() || create.isPending}>
              {create.isPending ? 'تُحفظ…' : 'أضف المهمة'}
            </Button>
          </FormActions>
        </div>
      </form>
    </Modal>
  )
}

const TASK_FILTERS = [['open', 'المفتوحة'], ['completed', 'المنجزة'], ['all', 'الكل']] as const
const TASK_VIEWS = [['assigned', 'المهام المسندة'], ['private', 'مهامي الخاصة']] as const

export const Tasks = () => {
  const owner = useIsOwner()
  const tasks = useTasks()
  const cases = useCases()
  const [filterParam, setFilterParam] = useParam('filter')
  const filter = oneOf(filterParam, TASK_FILTERS.map(([key]) => key), 'open')
  const setFilter = (key: (typeof TASK_FILTERS)[number][0]) => setFilterParam(key === 'open' ? null : key)
  const [viewParam, setViewParam] = useParam('view')
  const view = oneOf(viewParam, TASK_VIEWS.map(([key]) => key), 'assigned')
  const personal = view === 'private'
  const [adding, setAdding] = useState(false)
  const [addingPrivate, setAddingPrivate] = useState(false)
  const all = tasks.data ?? []
  const privateOpen = all.filter((task) => task.is_private && (task.status === 'pending' || task.status === 'in_progress')).length
  const rows = all
    .filter((task) => Boolean(task.is_private) === personal)
    .filter((task) => (filter === 'all' ? true : filter === 'completed' ? task.status === 'completed' : task.status === 'pending' || task.status === 'in_progress'))
  return (
    <>
      <SheetHeader
        title="المهام"
        note={personal ? 'مهامك الخاصة، تظهر لك وحدك' : owner ? 'مهام كل أعضاء المكتب' : 'المهام المسندة إليك'}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-ink/25 p-0.5">
              {TASK_FILTERS.map(([key, label]) => (
                <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key} className={cn('rounded px-3 py-1.5 text-xs font-semibold transition-colors', filter === key ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink')}>
                  {label}
                </button>
              ))}
            </div>
            {personal ? <AddButton onClick={() => setAddingPrivate(true)}>مهمة خاصة</AddButton> : owner && <AddButton onClick={() => setAdding(true)}>مهمة جديدة</AddButton>}
          </div>
        }
      />
      <div className="mb-5 flex gap-6 border-b border-rule" role="tablist" aria-label="نوع المهام">
        {TASK_VIEWS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => setViewParam(key === 'assigned' ? null : key)}
            className={cn('-mb-px border-b-2 pb-2.5 text-sm font-semibold transition-colors', view === key ? 'border-stamp text-ink' : 'border-transparent text-ink-soft hover:text-ink')}
          >
            {label}
            {key === 'private' && privateOpen > 0 && <span className="ms-1.5 text-xs text-ink-faint tabular-nums">({privateOpen})</span>}
          </button>
        ))}
      </div>
      {tasks.isPending ? (
        <Loading />
      ) : tasks.isError ? (
        <Failed error={tasks.error} />
      ) : rows.length === 0 ? (
        <Empty>{personal && filter === 'open' ? 'لا مهام خاصة مفتوحة. أضف ما تريد تذكّره لنفسك.' : 'لا مهام في هذا التصنيف.'}</Empty>
      ) : (
        <TasksTable rows={rows} cases={cases.data ?? []} personal={personal} />
      )}
      <NewTask open={adding} onClose={() => setAdding(false)} />
      <NewPrivateTask open={addingPrivate} onClose={() => setAddingPrivate(false)} />
    </>
  )
}

/* ───────────────────────── documents ───────────────────────── */

export const Documents = () => {
  const [search, setSearch] = useState('')
  const documents = useDocuments(undefined, search)
  const cases = useCases()
  const [sharing, setSharing] = useState<DocumentRecord | null>(null)
  return (
    <>
      <SheetHeader title="المستندات" note="كل مستندات القضايا التي تعمل عليها. الرفع يتم من داخل ملف القضية." action={<SearchBox onSearch={setSearch} placeholder="ابحث باسم الملف أو نوعه" />} />
      {documents.isPending ? <Loading /> : documents.isError ? <Failed error={documents.error} /> : documents.data.length === 0 ? <Empty>لا مستندات مطابقة.</Empty> : <DocumentsTable rows={documents.data} cases={cases.data ?? []} onShare={setSharing} />}
      <ShareDocument document={sharing} onClose={() => setSharing(null)} />
    </>
  )
}

/* ───────────────────────── contracts ───────────────────────── */

const UploadContract = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const queryClient = useQueryClient()
  const clients = useClients()
  const [file, setFile] = useState<File | null>(null)
  const [values, setValues] = useState({ clientId: '', title: '', type: '' })
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const upload = useMutation({
    mutationFn: () =>
      api.post(`/clients/${values.clientId}/contracts`, file, {
        headers: {
          'Content-Type': 'application/pdf',
          'X-Contract-File-Name': safePdfName(file!.name),
          'X-Contract-Title': headerValue(values.title),
          'X-Contract-Type': headerValue(values.type),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      setFile(null)
      setValues({ clientId: '', title: '', type: '' })
      onClose()
    },
  })
  return (
    <Modal open={open} onClose={onClose} title="عقد جديد">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          upload.mutate()
        }}
        className="space-y-4"
      >
        <SelectField label="الموكّل" name="client" required value={values.clientId} onChange={set('clientId')} options={[['', 'اختر موكّلاً'], ...(clients.data ?? []).map((client) => [client.client_id, client.full_name_or_org] as const)]} />
        <Field label="عنوان العقد" name="title" required value={values.title} onChange={set('title')} />
        <Field label="نوع العقد" name="type" required placeholder="أتعاب محاماة، وكالة، استشارات…" value={values.type} onChange={set('type')} />
        <div>
          <label htmlFor="contract-file" className="block text-xs font-semibold text-ink-soft">
            ملف العقد (PDF فقط)
          </label>
          <input id="contract-file" type="file" accept="application/pdf" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm text-ink file:me-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-2 file:text-sm file:font-semibold file:text-paper" />
        </div>
        <FormActions error={upload.isError ? messageOf(upload.error) : null}>
          <Button variant="line" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" variant="ink" disabled={!file || !values.clientId || !values.title.trim() || !values.type.trim() || upload.isPending}>
            {upload.isPending ? 'يُرفع…' : 'ارفع العقد'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  )
}

export const Contracts = () => {
  const queryClient = useQueryClient()
  const clients = useClients()
  const [adding, setAdding] = useState(false)
  const contracts = useQuery({
    queryKey: ['contracts'],
    queryFn: async () => (await api.get<{ contracts: Contract[] }>('/contracts', { params: { pageSize: 50 } })).data.contracts,
  })
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/contracts/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contracts'] }),
  })
  return (
    <>
      <SheetHeader title="العقود" note={contracts.data ? `${contracts.data.length} عقد` : undefined} action={<AddButton onClick={() => setAdding(true)}>عقد جديد</AddButton>} />
      {update.isError && <p role="alert" className="mb-4 text-sm text-stamp">{messageOf(update.error)}</p>}
      {contracts.isPending ? (
        <Loading />
      ) : contracts.isError ? (
        <Failed error={contracts.error} />
      ) : contracts.data.length === 0 ? (
        <Empty>لا عقود بعد.</Empty>
      ) : (
        <Table head={['العقد', 'النوع', 'الموكّل', 'أُنشئ', 'الحالة', '']}>
          {contracts.data.map((contract) => (
            <tr key={contract.contract_id} className={ROW}>
              <td className={cn(TD, 'font-semibold')}>{contract.title}</td>
              <td className={TD}>{contract.contract_type}</td>
              <td className={TD}>{clients.data?.find((client) => client.client_id === contract.client_id)?.full_name_or_org ?? '—'}</td>
              <td className={cn(TD, 'whitespace-nowrap text-ink-soft')}>{formatDate(contract.created_at)}</td>
              <td className={TD}>
                <QuickSelect label="حالة العقد" value={contract.status} options={optionsOf(CONTRACT_STATUS)} disabled={update.isPending} onChange={(status) => update.mutate({ id: contract.contract_id, status })} />
              </td>
              <td className={cn(TD, 'text-end')}>
                <DownloadLink href={`${API_URL}/contracts/${contract.contract_id}/download`} />
              </td>
            </tr>
          ))}
        </Table>
      )}
      <UploadContract open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

/* ───────────────────────── team ───────────────────────── */

const Invite = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const queryClient = useQueryClient()
  const [values, setValues] = useState({ email: '', role: 'lawyer' })
  const [result, setResult] = useState<InviteResult | null>(null)
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const create = useMutation({
    mutationFn: () => sendInvitation({ email: values.email.trim(), role: values.role }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['invitations'] })
      setResult(data)
    },
  })
  const close = () => {
    setResult(null)
    setValues({ email: '', role: 'lawyer' })
    create.reset()
    onClose()
  }
  return (
    <Modal open={open} onClose={close} title="دعوة عضو للفريق">
      {result ? (
        <InviteLink result={result} onDone={close} />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
          className="space-y-4"
        >
          <Field label="بريد المدعوّ" name="email" type="email" dir="ltr" required value={values.email} onChange={set('email')} />
          <SelectField label="الدور" name="role" options={[['lawyer', 'محامٍ'], ['assistant', 'مساعد قانوني']]} value={values.role} onChange={set('role')} />
          <p className="text-xs text-ink-soft">لدعوة موكّل إلى بوابته افتح صفحة «الموكّلون».</p>
          <FormActions error={create.isError ? messageOf(create.error) : null}>
            <Button variant="line" onClick={close}>
              إلغاء
            </Button>
            <Button type="submit" variant="ink" disabled={!values.email.trim() || create.isPending}>
              {create.isPending ? 'تُنشأ…' : 'أنشئ الدعوة'}
            </Button>
          </FormActions>
        </form>
      )}
    </Modal>
  )
}

export const Team = () => {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const members = useMembers(true)
  const [inviting, setInviting] = useState(false)
  // Clients and their portal invitations are managed from the clients page, not here.
  const invitations = useQuery({
    queryKey: ['invitations'],
    queryFn: async () => (await api.get<{ invitations: Invitation[] }>('/offices/current/invitations')).data.invitations,
    select: (rows) => rows.filter((invitation) => invitation.role !== 'client'),
  })
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/users/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members'] }),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/offices/current/invitations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invitations'] }),
  })
  return (
    <>
      <SheetHeader title="الفريق" note="محامو المكتب ومساعدوه ودعواتهم. الموكّلون يُدارون من صفحة الموكّلين."action={<AddButton onClick={() => setInviting(true)}>دعوة جديدة</AddButton>} />
      {setStatus.isError && <p role="alert" className="mb-4 text-sm text-stamp">{messageOf(setStatus.error)}</p>}
      {members.isPending ? (
        <Loading />
      ) : members.isError ? (
        <Failed error={members.error} />
      ) : (
        <Table head={['العضو', 'البريد', 'الدور', 'الحالة', '']}>
          {members.data.filter((member) => member.role !== 'client').map((member) => {
            const self = member.user_id === session?.user.user_id
            return (
              <tr key={member.user_id} className={ROW}>
                <td className={cn(TD, 'font-semibold')}>
                  {member.full_name}
                  {self && <span className="ms-2 text-xs font-normal text-ink-faint">(أنت)</span>}
                </td>
                <td className={TD} dir="ltr">
                  {member.email}
                </td>
                <td className={TD}>{ROLE[member.role]}</td>
                <td className={TD}>
                  <Stamp tone={MEMBER_STATUS[member.status]?.tone} rotate={0} className="text-xs">
                    {MEMBER_STATUS[member.status]?.text}
                  </Stamp>
                </td>
                <td className={cn(TD, 'text-end')}>
                  {!self && (
                    <button type="button" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: member.user_id, status: member.status === 'active' ? 'suspended' : 'active' })} className="text-xs font-semibold text-stamp-blue underline-offset-4 hover:underline disabled:opacity-50">
                      {member.status === 'active' ? 'أوقف الوصول' : 'أعد الوصول'}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </Table>
      )}

      <h2 className="mt-12 mb-4 text-2xl text-ink">الدعوات</h2>
      {invitations.isPending ? (
        <Loading />
      ) : invitations.isError ? (
        <Failed error={invitations.error} />
      ) : invitations.data.length === 0 ? (
        <Empty>لا دعوات بعد.</Empty>
      ) : (
        <Table head={['البريد', 'الدور', 'تنتهي', 'الحالة', '']}>
          {invitations.data.map((invitation) => (
            <tr key={invitation.invitation_id} className={ROW}>
              <td className={cn(TD, 'font-semibold')} dir="ltr">
                {invitation.email}
              </td>
              <td className={TD}>{ROLE[invitation.role]}</td>
              <td className={cn(TD, 'whitespace-nowrap text-ink-soft')}>{formatDate(invitation.expires_at)}</td>
              <td className={TD}>
                <Stamp tone={INVITE_STATE[invitation.state]?.tone} rotate={0} className="text-xs">
                  {INVITE_STATE[invitation.state]?.text}
                </Stamp>
              </td>
              <td className={cn(TD, 'text-end')}>
                {invitation.state === 'pending' && (
                  <button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(invitation.invitation_id)} className="text-xs font-semibold text-stamp underline-offset-4 hover:underline disabled:opacity-50">
                    ألغِ الدعوة
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Invite open={inviting} onClose={() => setInviting(false)} />
    </>
  )
}

