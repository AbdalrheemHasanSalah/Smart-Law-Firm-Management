import { useQuery } from '@tanstack/react-query'
import { ShieldAlert, ShieldCheck, Info } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '@/lib/api'
import { PARTY_ROLE } from '@/lib/labels'
import type { ConflictResult } from '@/lib/types'
import { cn, Stamp } from './kit'

type CheckInput = {
  name: string
  national_id?: string
  phone?: string
  /** What the person would become: a new client, or a new opposing party. */
  role: 'client' | 'opponent'
  excludeClientId?: string
  enabled: boolean
}

const MATCHED_ON: Record<string, string> = { name: 'الاسم', phone: 'الهاتف', national_id: 'رقم الهوية' }

/** Waits until typing pauses, so the check runs once per pause and not on every key. */
const useSettled = <T,>(value: T, delay = 450) => {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return settled
}

/** Live conflict-of-interest check while a person is being entered. Office administrators only. */
export const useConflictCheck = ({ name, national_id = '', phone = '', role, excludeClientId, enabled }: CheckInput) => {
  const input = useSettled({ name: name.trim(), national_id: national_id.trim(), phone: phone.trim() })
  // A name needs two words to mean anything; an ID or phone number is enough on its own.
  const searchable = input.name.split(/\s+/).filter(Boolean).length >= 2 || input.national_id.length >= 4 || input.phone.replace(/\D/g, '').length >= 7
  return useQuery({
    queryKey: ['conflicts', role, excludeClientId ?? null, input],
    enabled: enabled && searchable,
    staleTime: 30_000,
    queryFn: async () =>
      (
        await api.get<ConflictResult>('/conflicts/check', {
          params: {
            role,
            ...(input.name ? { name: input.name } : {}),
            ...(input.national_id ? { national_id: input.national_id } : {}),
            ...(input.phone ? { phone: input.phone } : {}),
            ...(excludeClientId ? { exclude_client_id: excludeClientId } : {}),
          },
        })
      ).data,
  })
}

/** The result of a check, as a paper notice: red for a conflict, blue for someone already known. */
export const ConflictNotice = ({ result, role, className }: { result: ConflictResult | undefined; role: 'client' | 'opponent'; className?: string }) => {
  if (!result) return null
  if (result.matches.length === 0) {
    return (
      <p className={cn('flex items-center gap-2 text-xs text-stamp-green', className)}>
        <ShieldCheck className="size-4" aria-hidden="true" />
        لا تعارض مصالح: لم يظهر هذا الشخص بين موكّلي المكتب أو خصومه.
      </p>
    )
  }
  const Icon = result.conflict ? ShieldAlert : Info
  return (
    <div role={result.conflict ? 'alert' : 'status'} className={cn('rounded-md border-s-4 p-4', result.conflict ? 'border-stamp bg-stamp/5' : 'border-stamp-blue bg-stamp-blue/5', className)}>
      <div className="flex flex-wrap items-center gap-3">
        <Icon className={cn('size-5', result.conflict ? 'text-stamp' : 'text-stamp-blue')} aria-hidden="true" />
        <Stamp slam="mount" tone={result.conflict ? 'red' : 'blue'} className="text-sm">
          {result.conflict ? 'تعارض مصالح محتمل' : 'مسجّل من قبل'}
        </Stamp>
      </div>
      <p className="mt-2 text-sm text-ink">
        {result.conflict
          ? role === 'client'
            ? 'هذا الشخص مسجّل خصماً في قضية لدى المكتب. راجع الملف قبل قبول توكيله.'
            : 'هذا الخصم موكّل لدى المكتب. راجع الملف قبل المتابعة.'
          : 'يشبه هذا الشخص موكّلاً مسجّلاً. تأكد أنه ليس السجل نفسه قبل إضافته.'}
      </p>
      <ul className="mt-3 space-y-2">
        {result.matches.map((match) => (
          <li key={`${match.source}-${match.id}`} className="text-sm">
            <span className="font-semibold text-ink">{match.name}</span>
            <span className={cn('ms-2 text-xs font-semibold', match.conflict ? 'text-stamp' : 'text-stamp-blue')}>{match.source === 'opponent' ? 'خصم' : 'موكّل'}</span>
            <span className="ms-2 text-xs text-ink-faint">تطابق في: {match.matched_on.map((reason) => MATCHED_ON[reason]).join('، ')}</span>
            {match.cases.length > 0 && (
              <ul className="mt-0.5 ms-4 list-disc text-xs text-ink-soft">
                {match.cases.slice(0, 3).map((entry) => (
                  <li key={entry.case_id}>
                    <Link to={`/office/cases/${entry.case_id}`} className="underline-offset-4 hover:text-stamp hover:underline">
                      <bdi>{entry.case_number}</bdi> — {entry.title}
                    </Link>
                    {match.source === 'client' && entry.party_role && ` (${PARTY_ROLE[entry.party_role] ?? entry.party_role})`}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
