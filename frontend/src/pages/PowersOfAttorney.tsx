import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, FileCheck2, Plus, Upload } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { PATHS, useAuth } from '@/auth/auth'
import { api, DEMO, messageOf } from '@/lib/api'
import { formatDate } from '@/lib/labels'
import {
  expiryNote,
  hasActivePower,
  MAX_SCAN_BYTES,
  POA_FILTERS,
  POA_STATE,
  POA_TYPE,
  SCAN_TYPES,
  scanUrl,
  useAuthorizableLawyers,
  usePowers,
  useSavePower,
  useSetPowerStatus,
  type PoaFilter,
  type PoaInput,
  type PoaType,
  type PowerOfAttorney,
} from '@/lib/powersOfAttorney'
import type { CaseRelationships, Client, LegalCase } from '@/lib/types'
import { useParam } from '@/lib/useParam'
import { FormActions, Modal, SelectField, TextArea } from '@/ui/forms'
import { Button, cn, Field } from '@/ui/kit'
import { Empty, Failed, Loading, Pill, SheetHeader } from '@/ui/Shell'
import { useClients } from './Office'

/* ───────────────────────── shared ───────────────────────── */

const TH = 'pe-4 pb-2 text-start text-xs font-semibold text-ink-soft'
const TD = 'py-3 pe-4 align-top text-sm text-ink'
const ROW = 'border-b border-rule transition-colors hover:bg-marker/25'
const LINK = 'text-xs font-semibold underline-offset-4 hover:underline disabled:opacity-50'

const useOfficeRole = () => useAuth().session?.active_office?.role ?? null

const StateCell = ({ power }: { power: PowerOfAttorney }) => {
  const label = POA_STATE[power.state]
  const note = expiryNote(power)
  return (
    <div className="flex flex-col items-start gap-1">
      <Pill tone={label.tone}>{label.text}</Pill>
      {note && (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-stamp">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          {note}
        </span>
      )}
    </div>
  )
}

const ScanLink = ({ power }: { power: PowerOfAttorney }) =>
  !power.has_scan ? (
    <span className="text-xs text-ink-faint">لا صورة</span>
  ) : DEMO ? (
    <span title="عرض الصورة يعمل مع الباك إند الحقيقي فقط" className="text-xs text-ink-faint">صورة (تجريبي)</span>
  ) : (
    <a href={scanUrl(power.poa_id)} target="_blank" rel="noreferrer" className={cn(LINK, 'inline-flex items-center gap-1 text-stamp-blue')}>
      <FileCheck2 className="size-4" aria-hidden="true" />
      الصورة
    </a>
  )

/** The table of powers of attorney, with the actions the viewer's role allows. */
const PowersTable = ({ rows, showClient = true, onEdit, onToggle }: {
  rows: PowerOfAttorney[]
  showClient?: boolean
  onEdit?: (power: PowerOfAttorney) => void
  onToggle?: (power: PowerOfAttorney) => void
}) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[720px] border-collapse">
      <thead>
        <tr className="border-b-2 border-ink">
          {['الرقم والنوع', ...(showClient ? ['الموكّل'] : []), 'المحامون المفوَّضون', 'القضايا', 'الإصدار', 'الانتهاء', 'الحالة', ''].map((head) => (
            <th key={head} scope="col" className={TH}>{head}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((power) => (
          <tr key={power.poa_id} className={ROW}>
            <td className={TD}>
              <p className="font-semibold" dir="auto">{power.poa_number}</p>
              <p className="text-xs text-ink-soft">{POA_TYPE[power.poa_type]}</p>
              {power.issuing_authority && <p className="text-xs text-ink-faint">{power.issuing_authority}</p>}
            </td>
            {showClient && <td className={TD}>{power.client_name}</td>}
            <td className={TD}>{power.lawyers.map((lawyer) => lawyer.full_name).join('، ') || '—'}</td>
            <td className={TD}>
              {power.cases.length === 0 ? (
                <span className="text-ink-faint">غير مرتبط بقضية</span>
              ) : (
                <ul className="space-y-0.5">
                  {power.cases.map((entry) => (
                    <li key={entry.case_id}>
                      {showClient ? (
                        <Link to={`${PATHS.office}/cases/${entry.case_id}`} className="text-stamp-blue underline-offset-4 hover:underline" dir="ltr">
                          {entry.case_number}
                        </Link>
                      ) : (
                        <bdi dir="ltr">{entry.case_number}</bdi>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </td>
            <td className={cn(TD, 'whitespace-nowrap text-ink-soft')}>{formatDate(power.issued_on)}</td>
            <td className={cn(TD, 'whitespace-nowrap text-ink-soft')}>{power.expires_on ? formatDate(power.expires_on) : 'غير محدّد'}</td>
            <td className={TD}><StateCell power={power} /></td>
            <td className={cn(TD, 'text-end whitespace-nowrap')}>
              <div className="flex flex-col items-end gap-1">
                <ScanLink power={power} />
                {onEdit && (
                  <button type="button" onClick={() => onEdit(power)} className={cn(LINK, 'text-stamp-blue')}>تعديل</button>
                )}
                {onToggle && (
                  <button type="button" onClick={() => onToggle(power)} className={cn(LINK, power.status === 'revoked' ? 'text-stamp-green' : 'text-stamp')}>
                    {power.status === 'revoked' ? 'أعد تفعيله' : 'ألغِ التوكيل'}
                  </button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

/** A list of checkboxes: the lawyers to name, or the cases to cover. */
const CheckList = ({ legend, items, selected, onChange, empty }: {
  legend: string
  items: { id: string; label: ReactNode }[]
  selected: string[]
  onChange: (next: string[]) => void
  empty: string
}) => (
  <fieldset>
    <legend className="block text-xs font-semibold text-ink-soft">{legend}</legend>
    {items.length === 0 ? (
      <p className="mt-1 text-sm text-ink-faint">{empty}</p>
    ) : (
      <div className="mt-1 max-h-36 space-y-1 overflow-y-auto rounded-md border border-ink/15 p-2">
        {items.map((item) => (
          <label key={item.id} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={(event) => onChange(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))}
              className="size-4 accent-stamp"
            />
            {item.label}
          </label>
        ))}
      </div>
    )}
  </fieldset>
)

const EMPTY: Omit<PoaInput, 'client_id'> = {
  poa_number: '', poa_type: 'litigation', issuing_authority: '', issued_on: '', expires_on: '', scope: '', lawyer_ids: [], case_ids: [],
}

/**
 * Records a power of attorney, or edits one. `clientId` and `caseId` preset the client and the
 * case when it is opened from a case file; `clients` limits the client choice (a case's parties).
 */
export const PowerForm = ({ open, onClose, power, clientId: presetClient, caseId: presetCase, clients: clientChoices }: {
  open: boolean
  onClose: () => void
  power?: PowerOfAttorney | null
  clientId?: string
  caseId?: string
  clients?: { client_id: string; full_name_or_org: string }[]
}) => {
  const me = useAuth().session?.user.user_id
  const role = useOfficeRole()
  const allClients = useClients()
  const lawyers = useAuthorizableLawyers(open)
  const save = useSavePower()
  const [savedId, setSavedId] = useState<string | null>(null)
  const [clientId, setClientId] = useState('')
  const [values, setValues] = useState(EMPTY)
  const [scan, setScan] = useState<File | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    save.reset()
    setSavedId(null)
    setScan(null)
    setLocalError(null)
    if (power) {
      setClientId(power.client_id)
      setValues({
        poa_number: power.poa_number, poa_type: power.poa_type, issuing_authority: power.issuing_authority ?? '',
        issued_on: power.issued_on, expires_on: power.expires_on ?? '', scope: power.scope ?? '',
        lawyer_ids: power.lawyers.map((lawyer) => lawyer.user_id), case_ids: power.cases.map((entry) => entry.case_id),
      })
    } else {
      const only = clientChoices?.length === 1 ? clientChoices[0]!.client_id : ''
      setClientId(presetClient ?? only)
      // A lawyer usually records their own power of attorney; an assistant picks the lawyer.
      setValues({ ...EMPTY, lawyer_ids: me && role !== 'assistant' ? [me] : [], case_ids: presetCase ? [presetCase] : [] })
    }
    // Reset only when the sheet opens or switches record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, power?.poa_id])

  const clientCases = useQuery({
    queryKey: ['client-cases', clientId],
    enabled: open && Boolean(clientId),
    queryFn: async () => (await api.get<{ cases: LegalCase[] }>(`/clients/${clientId}/cases`, { params: { pageSize: 50 } })).data.cases,
  })

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => setValues((current) => ({ ...current, [key]: value }))
  const clientOptions: { client_id: string; full_name_or_org: string }[] = clientChoices ?? (allClients.data ?? []).map((client: Client) => ({ client_id: client.client_id, full_name_or_org: client.full_name_or_org }))
  const editingId = power?.poa_id ?? savedId
  const ready = clientId && values.poa_number.trim() && values.issued_on && values.lawyer_ids.length > 0
    && (!values.expires_on || values.expires_on >= values.issued_on)

  const submit = () => {
    setLocalError(null)
    if (scan && (!(SCAN_TYPES as readonly string[]).includes(scan.type) || scan.size > MAX_SCAN_BYTES)) {
      setLocalError('الصورة يجب أن تكون PDF أو PNG أو JPG، حتى 5 ميغابايت.')
      return
    }
    const input: PoaInput = {
      client_id: clientId,
      poa_number: values.poa_number.trim(),
      poa_type: values.poa_type,
      issuing_authority: values.issuing_authority?.trim() || null,
      issued_on: values.issued_on,
      expires_on: values.expires_on || null,
      scope: values.scope?.trim() || null,
      lawyer_ids: values.lawyer_ids,
      case_ids: values.case_ids,
    }
    save.mutate(
      { poaId: editingId ?? undefined, input, scan: scan ? { file: scan, type: scan.type } : null },
      {
        onSuccess: ({ saved, scanError }) => {
          if (scanError) {
            setSavedId(saved.poa_id)
            setLocalError(`حُفظ التوكيل، لكن تعذّر رفع الصورة: ${messageOf(scanError)} أعد المحاولة.`)
            return
          }
          onClose()
        },
      },
    )
  }

  const error = localError ?? (save.isError ? messageOf(save.error) : null)

  return (
    <Modal open={open} onClose={onClose} title={power ? 'تعديل التوكيل' : 'توكيل جديد'} wide>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        className="space-y-4"
      >
        <SelectField
          label="الموكّل"
          name="poa_client"
          required
          disabled={Boolean(power) || Boolean(savedId) || (Boolean(presetClient) && !clientChoices)}
          value={clientId}
          onChange={(event) => {
            setClientId(event.target.value)
            set('case_ids', [])
          }}
          options={[['', 'اختر موكّلاً'], ...clientOptions.map((client) => [client.client_id, client.full_name_or_org] as const)]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="رقم التوكيل" name="poa_number" required value={values.poa_number} onChange={(event) => set('poa_number', event.target.value)} />
          <SelectField label="نوع التوكيل" name="poa_type" value={values.poa_type} onChange={(event) => set('poa_type', event.target.value as PoaType)} options={Object.entries(POA_TYPE)} />
          <Field label="جهة الإصدار" name="issuing_authority" placeholder="كاتب العدل، المحكمة…" value={values.issuing_authority ?? ''} onChange={(event) => set('issuing_authority', event.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="تاريخ الإصدار" name="issued_on" type="date" required value={values.issued_on} onChange={(event) => set('issued_on', event.target.value)} />
            <Field
              label="تاريخ الانتهاء"
              name="expires_on"
              type="date"
              min={values.issued_on || undefined}
              hint="اتركه فارغاً إن لم يكن له انتهاء"
              error={values.expires_on && values.issued_on && values.expires_on < values.issued_on ? 'قبل تاريخ الإصدار' : undefined}
              value={values.expires_on ?? ''}
              onChange={(event) => set('expires_on', event.target.value)}
            />
          </div>
        </div>
        <CheckList
          legend="المحامون المفوَّضون"
          items={(lawyers.data ?? []).map((lawyer) => ({ id: lawyer.user_id, label: lawyer.full_name }))}
          selected={values.lawyer_ids}
          onChange={(next) => set('lawyer_ids', next)}
          empty={lawyers.isPending ? 'يُحمَّل…' : 'لا محامين نشطين في المكتب.'}
        />
        <CheckList
          legend="القضايا التي يغطيها (اختياري)"
          items={(clientCases.data ?? []).map((entry) => ({ id: entry.case_id, label: <><bdi dir="ltr">{entry.case_number}</bdi> — {entry.title}</> }))}
          selected={values.case_ids}
          onChange={(next) => set('case_ids', next)}
          empty={!clientId ? 'اختر الموكّل أولاً.' : clientCases.isPending ? 'يُحمَّل…' : 'لا قضايا لهذا الموكّل.'}
        />
        <TextArea label="نطاق التوكيل" name="scope" placeholder="ما يجيزه التوكيل للمحامي…" value={values.scope ?? ''} onChange={(event) => set('scope', event.target.value)} />
        <div>
          <label htmlFor="poa-scan" className="block text-xs font-semibold text-ink-soft">
            {power?.has_scan ? 'استبدال صورة التوكيل' : 'صورة التوكيل'} (PDF أو صورة، حتى 5 ميغابايت، اختياري)
          </label>
          <input
            id="poa-scan"
            type="file"
            accept={SCAN_TYPES.join(',')}
            onChange={(event) => setScan(event.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-ink file:me-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-2 file:text-sm file:font-semibold file:text-paper"
          />
        </div>
        <FormActions error={error}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="ink" disabled={!ready || save.isPending}>
            {save.isPending ? 'يُحفظ…' : savedId && !power ? 'أعد رفع الصورة' : 'احفظ'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  )
}

/** Confirms revoking a power of attorney, or bringing a revoked one back. */
const ToggleStatus = ({ power, onClose }: { power: PowerOfAttorney | null; onClose: () => void }) => {
  const toggle = useSetPowerStatus()
  useEffect(() => {
    if (power) toggle.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [power?.poa_id])
  const revoking = power?.status !== 'revoked'
  return (
    <Modal open={power !== null} onClose={onClose} title={revoking ? 'إلغاء التوكيل' : 'إعادة تفعيل التوكيل'}>
      <p className="leading-relaxed text-ink">
        {revoking
          ? 'بعد الإلغاء لا يُعدّ هذا التوكيل سارياً في أي قضية. يبقى في السجل ويمكن إعادة تفعيله لاحقاً.'
          : 'سيعود التوكيل سارياً ما لم يكن تاريخ انتهائه قد مضى.'}
      </p>
      {power && <p className="mt-2 font-semibold text-ink" dir="auto">{power.poa_number} · {power.client_name}</p>}
      <FormActions error={toggle.isError ? messageOf(toggle.error) : null}>
        <Button variant="line" onClick={onClose}>تراجع</Button>
        <Button
          variant="ink"
          disabled={toggle.isPending}
          onClick={() => power && toggle.mutate({ poaId: power.poa_id, status: revoking ? 'revoked' : 'active' }, { onSuccess: onClose })}
        >
          {toggle.isPending ? 'يُحفظ…' : revoking ? 'ألغِ التوكيل' : 'أعد التفعيل'}
        </Button>
      </FormActions>
    </Modal>
  )
}

/** Editing and status actions for the viewer's role: assistants edit but do not revoke. */
const usePowerActions = () => {
  const role = useOfficeRole()
  const staff = role === 'admin' || role === 'lawyer' || role === 'assistant'
  const [editing, setEditing] = useState<PowerOfAttorney | 'new' | null>(null)
  const [toggling, setToggling] = useState<PowerOfAttorney | null>(null)
  return {
    staff,
    editing,
    setEditing,
    onEdit: staff ? (power: PowerOfAttorney) => setEditing(power) : undefined,
    onToggle: role === 'admin' || role === 'lawyer' ? (power: PowerOfAttorney) => setToggling(power) : undefined,
    toggleSheet: <ToggleStatus power={toggling} onClose={() => setToggling(null)} />,
  }
}

/* ───────────────────────── register page ───────────────────────── */

export const PowersOfAttorney = () => {
  const [clientParam, setClientParam] = useParam('client')
  const [stateParam, setStateParam] = useParam('state')
  const state = (POA_FILTERS.some(([key]) => key === stateParam) ? stateParam : '') as PoaFilter | ''
  const [search, setSearch] = useState('')
  const clients = useClients()
  const powers = usePowers({ clientId: clientParam ?? undefined, state: state || undefined, search: search.trim() || undefined })
  const actions = usePowerActions()
  const clientName = clients.data?.find((client) => client.client_id === clientParam)?.full_name_or_org
  const expiring = (powers.data ?? []).filter((power) => power.expiring).length

  return (
    <>
      <SheetHeader
        title="التوكيلات"
        note={powers.data ? `${powers.data.length} توكيل${clientName ? ` · ${clientName}` : ''}` : undefined}
        action={
          actions.staff && (
            <Button variant="ink" size="sm" onClick={() => actions.setEditing('new')}>
              <Plus className="size-4" aria-hidden="true" />
              توكيل جديد
            </Button>
          )
        }
      />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <SelectField
          label="الموكّل"
          name="filter_client"
          className="w-56"
          value={clientParam ?? ''}
          onChange={(event) => setClientParam(event.target.value || null)}
          options={[['', 'كل الموكّلين'], ...(clients.data ?? []).map((client) => [client.client_id, client.full_name_or_org] as const)]}
        />
        <SelectField label="الحالة" name="filter_state" className="w-44" value={state} onChange={(event) => setStateParam(event.target.value || null)} options={POA_FILTERS} />
        <Field label="بحث" name="poa_search" className="w-56" placeholder="رقم التوكيل أو جهة الإصدار" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {expiring > 0 && state !== 'expiring' && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-md border border-stamp/40 bg-stamp/5 px-3 py-2 text-sm text-ink">
          <AlertTriangle className="size-4 shrink-0 text-stamp" aria-hidden="true" />
          {expiring === 1 ? 'توكيل واحد ينتهي خلال 30 يوماً.' : `${expiring} توكيلات تنتهي خلال 30 يوماً.`}
          <button type="button" onClick={() => setStateParam('expiring')} className={cn(LINK, 'text-stamp-blue')}>اعرضها</button>
        </p>
      )}
      {powers.isPending ? (
        <Loading />
      ) : powers.isError ? (
        <Failed error={powers.error} />
      ) : powers.data.length === 0 ? (
        <Empty>لا توكيلات مطابقة.</Empty>
      ) : (
        <PowersTable rows={powers.data} onEdit={actions.onEdit} onToggle={actions.onToggle} />
      )}
      {actions.staff && (
        <PowerForm
          open={actions.editing !== null}
          onClose={() => actions.setEditing(null)}
          power={actions.editing === 'new' ? null : actions.editing}
          clientId={actions.editing === 'new' ? clientParam ?? undefined : undefined}
        />
      )}
      {actions.toggleSheet}
    </>
  )
}

/* ───────────────────────── case file tab ───────────────────────── */

/** The powers of attorney covering a case, with a warning when none is in force. */
export const CasePowers = ({ caseId }: { caseId: string }) => {
  const powers = usePowers({ caseId })
  const relationships = useQuery({
    queryKey: ['relationships', caseId],
    queryFn: async () => (await api.get<{ relationships: CaseRelationships }>(`/cases/${caseId}/relationships`)).data.relationships,
  })
  const actions = usePowerActions()
  const parties = (relationships.data?.clients ?? []).map((party) => ({ client_id: party.client_id, full_name_or_org: party.full_name_or_org }))
  const missing = powers.data !== undefined && !hasActivePower(powers.data)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">التوكيلات التي يمارس بها المكتب هذه القضية نيابة عن الموكّل.</p>
        {actions.staff && (
          <Button variant="ink" size="sm" disabled={parties.length === 0} onClick={() => actions.setEditing('new')}>
            <Upload className="size-4" aria-hidden="true" />
            توكيل لهذه القضية
          </Button>
        )}
      </div>
      {missing && (
        <p role="alert" className="flex items-center gap-2 rounded-md border border-stamp/40 bg-stamp/5 px-3 py-2 text-sm font-semibold text-stamp">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          لا يوجد توكيل ساري مرتبط بهذه القضية.
        </p>
      )}
      {powers.isPending ? (
        <Loading />
      ) : powers.isError ? (
        <Failed error={powers.error} />
      ) : powers.data.length === 0 ? (
        <Empty>لم يُربط أي توكيل بهذه القضية بعد.</Empty>
      ) : (
        <PowersTable rows={powers.data} onEdit={actions.onEdit} onToggle={actions.onToggle} />
      )}
      {actions.staff && (
        <PowerForm
          open={actions.editing !== null}
          onClose={() => actions.setEditing(null)}
          power={actions.editing === 'new' ? null : actions.editing}
          caseId={actions.editing === 'new' ? caseId : undefined}
          clients={actions.editing === 'new' ? parties : undefined}
        />
      )}
      {actions.toggleSheet}
    </div>
  )
}

/* ───────────────────────── client portal ───────────────────────── */

/** A client's own powers of attorney, read only. */
export const MyPowers = () => {
  const powers = usePowers()
  if (powers.isPending || powers.isError || powers.data.length === 0) return null
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xl text-ink">توكيلاتي</h2>
      <PowersTable rows={powers.data} showClient={false} />
    </section>
  )
}
