import { useQuery } from '@tanstack/react-query'
import { Search, UserPlus, UserRound, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { api } from '@/lib/api'
import type { Client } from '@/lib/types'
import { ConflictNotice, useConflictCheck } from './Conflicts'
import { SelectField } from './forms'
import { cn, Field } from './kit'

/**
 * The client a case is opened for, or a client added to a case: one already in the office, or a
 * new one entered right here with the few fields a case needs. The rest of a new client's
 * details, and their portal invitation, are completed later from the Clients page.
 */
export type ClientChoice =
  | { kind: 'existing'; client_id: string; full_name_or_org: string }
  | { kind: 'new'; client_type: 'individual' | 'organization'; full_name_or_org: string; national_id: string; phone: string }

export const existingChoice = (client: Pick<Client, 'client_id' | 'full_name_or_org'>): ClientChoice => ({
  kind: 'existing',
  client_id: client.client_id,
  full_name_or_org: client.full_name_or_org,
})

/** A choice is ready to send once it names a client: picked, or a new one with a name. */
export const choiceReady = (choice: ClientChoice | null): choice is ClientChoice =>
  choice !== null && (choice.kind === 'existing' || choice.full_name_or_org.trim().length > 0)

/** The request fields for a choice: `client_id`, or `new_client` with its fields. */
export const clientBody = (choice: ClientChoice) =>
  choice.kind === 'existing'
    ? { client_id: choice.client_id }
    : {
        new_client: {
          client_type: choice.client_type,
          full_name_or_org: choice.full_name_or_org.trim(),
          national_id: choice.national_id.trim() || null,
          phone: choice.phone.trim() || null,
        },
      }

const useDebounced = (value: string, delay = 250) => {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return settled
}

const LINK = 'text-xs font-semibold text-stamp-blue underline-offset-4 hover:underline'

export const ClientChooser = ({
  value,
  onChange,
  exclude = [],
  label = 'الموكّل',
}: {
  value: ClientChoice | null
  onChange: (choice: ClientChoice | null) => void
  /** Clients that may not be picked again (already on the case). */
  exclude?: string[]
  label?: string
}) => {
  const listId = useId()
  const [typed, setTyped] = useState('')
  const search = useDebounced(typed.trim())
  const results = useQuery({
    queryKey: ['clients', 'chooser', search],
    enabled: value === null,
    queryFn: async () => (await api.get<{ clients: Client[] }>('/clients', { params: { pageSize: 6, ...(search ? { search } : {}) } })).data.clients,
  })
  const fresh = value?.kind === 'new' ? value : null
  // Taking on a new client: is this person on the other side of one of the office's cases?
  const conflicts = useConflictCheck({
    name: fresh?.full_name_or_org ?? '',
    national_id: fresh?.national_id ?? '',
    phone: fresh?.phone ?? '',
    role: 'client',
    enabled: fresh !== null,
  })

  const startNew = () => {
    // What was typed in the search becomes the name, or the ID or phone when it is a number.
    const text = typed.trim()
    const digits = text.replace(/[\s()+.-]/g, '')
    const isNumber = /^\d{4,}$/.test(digits)
    onChange({
      kind: 'new',
      client_type: 'individual',
      full_name_or_org: isNumber ? '' : text,
      national_id: isNumber && !text.startsWith('0') ? text : '',
      phone: isNumber && text.startsWith('0') ? text : '',
    })
    setTyped('')
  }

  if (value?.kind === 'existing') {
    return (
      <div>
        <p className="text-xs font-semibold text-ink-soft">{label}</p>
        <div className="mt-1 flex items-center justify-between gap-3 rounded-md border border-ink/25 bg-white/60 px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
            <UserRound className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
            <span className="truncate">{value.full_name_or_org}</span>
          </span>
          <button type="button" onClick={() => onChange(null)} className={LINK}>
            تغيير
          </button>
        </div>
      </div>
    )
  }

  if (fresh) {
    const set = (key: 'full_name_or_org' | 'national_id' | 'phone' | 'client_type') => (event: { target: { value: string } }) =>
      onChange({ ...fresh, [key]: event.target.value })
    return (
      <fieldset className="rounded-md border border-stamp-blue/40 bg-stamp-blue/4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <legend className="contents">
            <span className="flex items-center gap-2 text-sm font-semibold text-ink">
              <UserPlus className="size-4 text-stamp-blue" aria-hidden="true" />
              موكّل جديد
            </span>
          </legend>
          <button type="button" onClick={() => onChange(null)} className={LINK}>
            اختر موكّلاً موجوداً
          </button>
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="الاسم أو اسم الجهة" name="new_client_name" required autoFocus value={fresh.full_name_or_org} onChange={set('full_name_or_org')} className="sm:col-span-2" />
          <SelectField label="النوع" name="new_client_type" options={[['individual', 'فرد'], ['organization', 'شركة أو جهة']]} value={fresh.client_type} onChange={set('client_type')} />
          <Field label={fresh.client_type === 'organization' ? 'رقم التسجيل (اختياري)' : 'رقم الهوية (اختياري)'} name="new_client_id" dir="ltr" value={fresh.national_id} onChange={set('national_id')} />
          <Field label="الهاتف (اختياري)" name="new_client_phone" dir="ltr" inputMode="tel" value={fresh.phone} onChange={set('phone')} className="sm:col-span-2" />
          <ConflictNotice result={conflicts.data} role="client" className="sm:col-span-2" />
          <p className="text-xs text-ink-faint sm:col-span-2">تكمل بقية بياناته وترسل له دعوة البوابة لاحقاً من صفحة الموكّلين.</p>
        </div>
      </fieldset>
    )
  }

  const rows = (results.data ?? []).filter((client) => !exclude.includes(client.client_id))
  return (
    <div>
      <label htmlFor={`${listId}-search`} className="text-xs font-semibold text-ink-soft">
        {label}
      </label>
      <div className="mt-1 rounded-md border border-ink/25 bg-white/60 focus-within:border-stamp-blue">
        <div className="flex items-center gap-2 px-3">
          <Search className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
          <input
            id={`${listId}-search`}
            type="text"
            inputMode="search"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="ابحث بالاسم أو الهاتف أو رقم الهوية"
            aria-controls={`${listId}-list`}
            autoComplete="off"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
          {typed && (
            <button type="button" onClick={() => setTyped('')} aria-label="امسح البحث" className="text-ink-faint hover:text-ink">
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <ul id={`${listId}-list`} className="max-h-52 overflow-y-auto border-t border-rule">
          {results.isPending && <li className="px-3 py-2.5 text-xs text-ink-faint">يبحث…</li>}
          {!results.isPending && rows.length === 0 && (
            <li className="px-3 py-2.5 text-xs text-ink-faint">
              {search
                ? 'لا موكّل بهذا الاسم أو الرقم.'
                : (results.data?.length ?? 0) > 0
                  ? 'لا موكّلين آخرين: الموجودون مضافون بالفعل.'
                  : 'لا موكّلين في المكتب بعد.'}
            </li>
          )}
          {rows.map((client) => (
            <li key={client.client_id}>
              <button
                type="button"
                onClick={() => {
                  onChange(existingChoice(client))
                  setTyped('')
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start text-sm hover:bg-marker/30 focus-visible:bg-marker/30 focus-visible:outline-none"
              >
                <span className="truncate font-semibold text-ink">{client.full_name_or_org}</span>
                {(client.phone ?? client.national_id) && (
                  <bdi className="shrink-0 text-xs text-ink-soft">{client.phone ?? client.national_id}</bdi>
                )}
              </button>
            </li>
          ))}
          <li className={cn(rows.length > 0 && 'border-t border-rule')}>
            <button
              type="button"
              onClick={startNew}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm font-semibold text-stamp-blue hover:bg-stamp-blue/8 focus-visible:bg-stamp-blue/8 focus-visible:outline-none"
            >
              <UserPlus className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{typed.trim() ? `موكّل جديد: «${typed.trim()}»` : 'موكّل جديد'}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  )
}
