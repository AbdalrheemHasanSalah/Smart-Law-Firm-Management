import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Plus, Search, Upload } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { personaOf, useAuth } from '@/auth/auth'
import { api, API_URL, DEMO, messageOf } from '@/lib/api'
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
  PRIORITY,
  ROLE,
  TASK_STATUS,
  VISIBILITY,
} from '@/lib/labels'
import type { CaseNote, CaseRelationships, Client, Contract, DocumentRecord, Invitation, LegalCase, Member, Task } from '@/lib/types'
import { FormActions, headerValue, Modal, safePdfName, SelectField, TextArea } from '@/ui/forms'
import { Button, cn, Field, Stamp } from '@/ui/kit'
import { Empty, Failed, Loading, SheetHeader } from '@/ui/Shell'
import { CasesTable, useCases, useClients, useTasks } from './Office'

/* ───────────────────────── shared ───────────────────────── */

const useIsOwner = () => personaOf(useAuth().session) === 'owner'

const useMembers = (enabled: boolean) =>
  useQuery({
    queryKey: ['members'],
    enabled,
    queryFn: async () => (await api.get<{ users: Member[] }>('/users', { params: { pageSize: 50 } })).data.users,
  })

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

const NewCase = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const queryClient = useQueryClient()
  const [values, setValues] = useState({ case_number: '', title: '', case_type: 'civil', priority: 'medium', description: '' })
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const create = useMutation({
    mutationFn: () => api.post('/cases', { ...values, description: values.description.trim() || null }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cases'] })
      setValues({ case_number: '', title: '', case_type: 'civil', priority: 'medium', description: '' })
      onClose()
    },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate()
  }
  return (
    <Modal open={open} onClose={onClose} title="قضية جديدة">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
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
  ['notes', 'الملاحظات'],
  ['documents', 'المستندات'],
  ['tasks', 'المهام'],
] as const
type TabKey = (typeof TABS)[number][0]

const People = ({ caseId }: { caseId: string }) => {
  const owner = useIsOwner()
  const queryClient = useQueryClient()
  const relationships = useQuery({
    queryKey: ['relationships', caseId],
    queryFn: async () => (await api.get<{ relationships: CaseRelationships }>(`/cases/${caseId}/relationships`)).data.relationships,
  })
  const clients = useClients()
  const members = useMembers(owner)
  const [clientId, setClientId] = useState('')
  const [userId, setUserId] = useState('')
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['relationships', caseId] })
  const link = useMutation({ mutationFn: () => api.post(`/cases/${caseId}/clients`, { client_id: clientId }), onSuccess: () => (setClientId(''), refresh()) })
  const assign = useMutation({ mutationFn: () => api.post(`/cases/${caseId}/assignments`, { user_id: userId }), onSuccess: () => (setUserId(''), refresh()) })

  if (relationships.isPending) return <Loading />
  if (relationships.isError) return <Failed error={relationships.error} />
  const parties = relationships.data.clients ?? []
  const staff = relationships.data.assigned_staff
  const freeClients = (clients.data ?? []).filter((client) => !parties.some((party) => party.client_id === client.client_id))
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
        {owner && freeClients.length > 0 && (
          <div className="mt-3 flex items-end gap-2">
            <SelectField label="ربط موكّل" name="link-client" className="flex-1" value={clientId} onChange={(event) => setClientId(event.target.value)} options={[['', 'اختر موكّلاً'], ...freeClients.map((client) => [client.client_id, client.full_name_or_org] as const)]} />
            <Button variant="ink" disabled={!clientId || link.isPending} onClick={() => link.mutate()}>
              اربط
            </Button>
          </div>
        )}
        {link.isError && <p role="alert" className="mt-2 text-sm text-stamp">{messageOf(link.error)}</p>}
      </section>
      <section>
        <h3 className="text-xl text-ink">الفريق المسند</h3>
        <ul className="mt-3 divide-y divide-rule border-y border-rule">
          {staff.length === 0 && <li className="py-3 text-sm text-ink-faint">لم تُسند القضية لأحد بعد.</li>}
          {staff.map((entry) => (
            <li key={entry.user_id ?? entry.full_name} className="flex items-center justify-between gap-3 py-3 text-sm">
              <span className="font-semibold text-ink">{entry.full_name}</span>
              <span className="text-ink-soft">{entry.is_lead ? 'محامٍ رئيسي' : (ROLE[entry.role ?? ''] ?? entry.assignment_role)}</span>
            </li>
          ))}
        </ul>
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
    </div>
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
                <p className="leading-relaxed whitespace-pre-wrap text-ink">{note.body}</p>
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
        <SelectField label="من يراها؟" name="visibility" options={visibilityOptions} value={visibility} onChange={(event) => setVisibility(event.target.value)} />
        {add.isError && <p role="alert" className="text-sm text-stamp">{messageOf(add.error)}</p>}
        <Button type="submit" variant="ink" disabled={!body.trim() || add.isPending} className="w-full">
          {add.isPending ? 'تُحفظ…' : 'أضف الملاحظة'}
        </Button>
      </form>
    </div>
  )
}

const useDocuments = (caseId?: string, search = '') =>
  useQuery({
    queryKey: ['documents', caseId ?? 'all', search],
    queryFn: async () => (await api.get<{ documents: DocumentRecord[] }>('/documents', { params: { pageSize: 50, ...(caseId ? { caseId } : {}), ...(search ? { search } : {}) } })).data.documents,
  })

const DocumentsTable = ({ rows, cases }: { rows: DocumentRecord[]; cases?: LegalCase[] }) => (
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
          <DownloadLink href={`${API_URL}/documents/${row.document_id}/download`} />
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
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button variant="ink" size="sm" onClick={() => setUploading(true)}>
          <Upload className="size-4" aria-hidden="true" />
          رفع مستند
        </Button>
      </div>
      {documents.isPending ? <Loading /> : documents.isError ? <Failed error={documents.error} /> : documents.data.length === 0 ? <Empty>لا مستندات في هذه القضية بعد.</Empty> : <DocumentsTable rows={documents.data} />}
      <UploadDocument caseId={caseId} open={uploading} onClose={() => setUploading(false)} />
    </>
  )
}

export const CaseFile = () => {
  const { caseId = '' } = useParams()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabKey>('people')
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
      {tab === 'notes' && <Notes caseId={caseId} />}
      {tab === 'documents' && <CaseDocuments caseId={caseId} />}
      {tab === 'tasks' && (caseTasks.length === 0 ? <Empty>لا مهام مرتبطة بهذه القضية.</Empty> : <TasksTable rows={caseTasks} />)}
    </>
  )
}

/* ───────────────────────── clients ───────────────────────── */

const EMPTY_CLIENT = { client_type: 'individual', full_name_or_org: '', phone: '', email: '', address: '' }

const ClientForm = ({ client, open, onClose }: { client: Client | null; open: boolean; onClose: () => void }) => {
  const owner = useIsOwner()
  const queryClient = useQueryClient()
  const [values, setValues] = useState(EMPTY_CLIENT)
  useEffect(() => {
    if (open) setValues(client ? { client_type: client.client_type, full_name_or_org: client.full_name_or_org, phone: client.phone ?? '', email: client.email ?? '', address: client.address ?? '' } : EMPTY_CLIENT)
  }, [open, client])
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
      const body = owner || !client ? { client_type: values.client_type, full_name_or_org: values.full_name_or_org.trim(), ...contact } : contact
      return client ? api.patch(`/clients/${client.client_id}`, body) : api.post('/clients', body)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
      onClose()
    },
  })
  const identityLocked = client !== null && !owner
  return (
    <Modal open={open} onClose={onClose} title={client ? 'بيانات الموكّل' : 'موكّل جديد'}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field label="الاسم أو اسم الجهة" name="full_name_or_org" required disabled={identityLocked} value={values.full_name_or_org} onChange={set('full_name_or_org')} className="sm:col-span-2" />
        <SelectField label="النوع" name="client_type" disabled={identityLocked} options={[['individual', 'فرد'], ['organization', 'شركة أو جهة']]} value={values.client_type} onChange={set('client_type')} />
        <Field label="الهاتف" name="phone" dir="ltr" value={values.phone} onChange={set('phone')} />
        <Field label="البريد الإلكتروني" name="email" type="email" dir="ltr" value={values.email} onChange={set('email')} />
        <Field label="العنوان" name="address" value={values.address} onChange={set('address')} />
        {client && (
          <div className="sm:col-span-2">
            <p className="text-xs font-semibold text-ink-soft">قضاياه</p>
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
              {save.isPending ? 'يُحفظ…' : 'احفظ'}
            </Button>
          </FormActions>
        </div>
      </form>
    </Modal>
  )
}

export const Clients = () => {
  const owner = useIsOwner()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Client | 'new' | null>(null)
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
        <Table head={['الاسم', 'النوع', 'الهاتف', 'البريد', 'أُضيف', '']}>
          {clients.data.map((client) => (
            <tr key={client.client_id} className={ROW}>
              <td className={cn(TD, 'font-semibold')}>{client.full_name_or_org}</td>
              <td className={TD}>{client.client_type === 'organization' ? 'شركة أو جهة' : 'فرد'}</td>
              <td className={TD}>
                <bdi>{client.phone ?? '—'}</bdi>
              </td>
              <td className={TD}>
                <bdi>{client.email ?? '—'}</bdi>
              </td>
              <td className={cn(TD, 'whitespace-nowrap text-ink-soft')}>{formatDate(client.created_at)}</td>
              <td className={cn(TD, 'text-end')}>
                <button type="button" onClick={() => setEditing(client)} className="text-xs font-semibold text-stamp-blue underline-offset-4 hover:underline">
                  فتح
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <ClientForm client={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
    </>
  )
}

/* ───────────────────────── tasks ───────────────────────── */

const TasksTable = ({ rows, cases }: { rows: Task[]; cases?: LegalCase[] }) => {
  const queryClient = useQueryClient()
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/tasks/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
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

const TASK_FILTERS = [['open', 'المفتوحة'], ['completed', 'المنجزة'], ['all', 'الكل']] as const

export const Tasks = () => {
  const owner = useIsOwner()
  const tasks = useTasks()
  const cases = useCases()
  const [filter, setFilter] = useState<(typeof TASK_FILTERS)[number][0]>('open')
  const [adding, setAdding] = useState(false)
  const rows = (tasks.data ?? []).filter((task) => (filter === 'all' ? true : filter === 'completed' ? task.status === 'completed' : task.status === 'pending' || task.status === 'in_progress'))
  return (
    <>
      <SheetHeader
        title="المهام"
        note={owner ? 'مهام كل أعضاء المكتب' : 'المهام المسندة إليك'}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-ink/25 p-0.5">
              {TASK_FILTERS.map(([key, label]) => (
                <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key} className={cn('rounded px-3 py-1.5 text-xs font-semibold transition-colors', filter === key ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink')}>
                  {label}
                </button>
              ))}
            </div>
            {owner && <AddButton onClick={() => setAdding(true)}>مهمة جديدة</AddButton>}
          </div>
        }
      />
      {tasks.isPending ? <Loading /> : tasks.isError ? <Failed error={tasks.error} /> : rows.length === 0 ? <Empty>لا مهام في هذا التصنيف.</Empty> : <TasksTable rows={rows} cases={cases.data ?? []} />}
      <NewTask open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

/* ───────────────────────── documents ───────────────────────── */

export const Documents = () => {
  const [search, setSearch] = useState('')
  const documents = useDocuments(undefined, search)
  const cases = useCases()
  return (
    <>
      <SheetHeader title="المستندات" note="كل مستندات القضايا التي تعمل عليها. الرفع يتم من داخل ملف القضية." action={<SearchBox onSearch={setSearch} placeholder="ابحث باسم الملف أو نوعه" />} />
      {documents.isPending ? <Loading /> : documents.isError ? <Failed error={documents.error} /> : documents.data.length === 0 ? <Empty>لا مستندات مطابقة.</Empty> : <DocumentsTable rows={documents.data} cases={cases.data ?? []} />}
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
  const clients = useClients()
  const [values, setValues] = useState({ email: '', role: 'lawyer', clientId: '' })
  const [result, setResult] = useState<{ url: string; sent: boolean } | null>(null)
  const [copied, setCopied] = useState(false)
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ invite_url: string; email_sent: boolean }>('/offices/current/invitations', {
          email: values.email.trim(),
          role: values.role,
          ...(values.role === 'client' && values.clientId ? { client_id: values.clientId } : {}),
        })
      ).data,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['invitations'] })
      // Rebuild the link on this origin: the backend's first trusted origin may differ.
      const token = data.invite_url.split('/').pop() ?? ''
      setResult({ url: `${location.origin}/invite/${token}`, sent: data.email_sent })
    },
  })
  const close = () => {
    setResult(null)
    setCopied(false)
    setValues({ email: '', role: 'lawyer', clientId: '' })
    create.reset()
    onClose()
  }
  return (
    <Modal open={open} onClose={close} title="دعوة جديدة">
      {result ? (
        <div>
          <Stamp slam="mount" tone="green" className="text-xl">
            أُنشئت الدعوة
          </Stamp>
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            {result.sent ? 'أُرسل الرابط إلى البريد. يمكنك أيضاً نسخه ومشاركته مباشرة.' : 'لم يُرسل بريد. انسخ الرابط وشاركه مع المدعوّ مباشرة.'} الرابط صالح 7 أيام ويُستخدم مرة واحدة، ولن يُعرض مرة أخرى.
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
            <Button variant="line" onClick={close}>
              تم
            </Button>
          </FormActions>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
          className="space-y-4"
        >
          <Field label="بريد المدعوّ" name="email" type="email" dir="ltr" required value={values.email} onChange={set('email')} />
          <SelectField label="الدور" name="role" options={[['lawyer', 'محامٍ'], ['assistant', 'مساعد قانوني'], ['client', 'موكّل']]} value={values.role} onChange={set('role')} />
          {values.role === 'client' && (
            <SelectField label="سجلّ الموكّل الذي يُربط به الحساب" name="client" value={values.clientId} onChange={set('clientId')} options={[['', 'اختر سجلّ الموكّل'], ...(clients.data ?? []).map((client) => [client.client_id, client.full_name_or_org] as const)]} />
          )}
          <FormActions error={create.isError ? messageOf(create.error) : null}>
            <Button variant="line" onClick={close}>
              إلغاء
            </Button>
            <Button type="submit" variant="ink" disabled={!values.email.trim() || (values.role === 'client' && !values.clientId) || create.isPending}>
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
  const invitations = useQuery({
    queryKey: ['invitations'],
    queryFn: async () => (await api.get<{ invitations: Invitation[] }>('/offices/current/invitations')).data.invitations,
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
      <SheetHeader title="الفريق" note="أعضاء المكتب ودعواتهم" action={<AddButton onClick={() => setInviting(true)}>دعوة جديدة</AddButton>} />
      {setStatus.isError && <p role="alert" className="mb-4 text-sm text-stamp">{messageOf(setStatus.error)}</p>}
      {members.isPending ? (
        <Loading />
      ) : members.isError ? (
        <Failed error={members.error} />
      ) : (
        <Table head={['العضو', 'البريد', 'الدور', 'الحالة', '']}>
          {members.data.map((member) => {
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

