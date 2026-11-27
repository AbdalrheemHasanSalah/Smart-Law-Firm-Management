/**
 * Powers of attorney (التوكيلات): types, wording, API calls and query hooks.
 *
 * Kept apart from the screens and free of DOM code, so a React Native client can reuse it as is:
 * only the components that draw it are web-specific.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, API_URL } from './api'

export type PoaType = 'general' | 'special' | 'litigation'
export type PoaState = 'active' | 'expired' | 'revoked'
export type PoaFilter = PoaState | 'expiring'

export type PowerOfAttorney = {
  poa_id: string
  poa_number: string
  poa_type: PoaType
  issuing_authority: string | null
  issued_on: string
  expires_on: string | null
  scope: string | null
  status: 'active' | 'revoked'
  /** Derived by the server: revoked, expired (past its expiry date) or active. */
  state: PoaState
  /** Days until it expires (negative once expired), or null when it has no expiry date. */
  days_left: number | null
  /** Active and expiring within EXPIRING_WITHIN_DAYS. */
  expiring: boolean
  revoked_at: string | null
  has_scan: boolean
  client_id: string
  client_name: string
  lawyers: { user_id: string; full_name: string }[]
  cases: { case_id: string; case_number: string; title: string }[]
  created_at: string
  updated_at: string
}

export type AuthorizableLawyer = { user_id: string; full_name: string; role: 'admin' | 'lawyer' }

export type PoaInput = {
  client_id: string
  poa_number: string
  poa_type: PoaType
  issuing_authority: string | null
  issued_on: string
  expires_on: string | null
  scope: string | null
  lawyer_ids: string[]
  case_ids: string[]
}

export const EXPIRING_WITHIN_DAYS = 30

export const POA_TYPE: Record<PoaType, string> = {
  general: 'توكيل عام',
  special: 'توكيل خاص',
  litigation: 'توكيل خصومة',
}

export const POA_STATE: Record<PoaState, { text: string; tone: 'green' | 'red' | 'ink' }> = {
  active: { text: 'ساري', tone: 'green' },
  expired: { text: 'منتهٍ', tone: 'red' },
  revoked: { text: 'ملغى', tone: 'ink' },
}

export const POA_FILTERS: readonly (readonly [PoaFilter | '', string])[] = [
  ['', 'الكل'],
  ['active', 'السارية'],
  ['expiring', 'تنتهي قريباً'],
  ['expired', 'المنتهية'],
  ['revoked', 'الملغاة'],
]

/** How the expiry reads: "ينتهي خلال 5 أيام", "انتهى", or nothing when there is no expiry date. */
export const expiryNote = (power: Pick<PowerOfAttorney, 'state' | 'days_left'>): string | null => {
  if (power.state !== 'active' || power.days_left === null) return null
  if (power.days_left === 0) return 'ينتهي اليوم'
  if (power.days_left === 1) return 'ينتهي غداً'
  if (power.days_left <= EXPIRING_WITHIN_DAYS) return `ينتهي خلال ${power.days_left} يوماً`
  return null
}

/** Whether a case is covered by at least one power of attorney that is still in force. */
export const hasActivePower = (powers: PowerOfAttorney[]) => powers.some((power) => power.state === 'active')

/** The scan's address. On the web it is opened directly; a native client fetches it with the session cookie. */
export const scanUrl = (poaId: string) => `${API_URL}/powers-of-attorney/${poaId}/scan`

export const SCAN_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const
export const MAX_SCAN_BYTES = 5 * 1024 * 1024

/* ───────────── API ───────────── */

type ListParams = { clientId?: string; caseId?: string; state?: PoaFilter; search?: string }

export const fetchPowers = async (params: ListParams = {}) => {
  const clean = Object.fromEntries(Object.entries(params).filter(([, value]) => value))
  const { data } = await api.get<{ powers_of_attorney: PowerOfAttorney[] }>('/powers-of-attorney', { params: { pageSize: 50, ...clean } })
  return data.powers_of_attorney
}

export const fetchAuthorizableLawyers = async () =>
  (await api.get<{ lawyers: AuthorizableLawyer[] }>('/powers-of-attorney/lawyers')).data.lawyers

export const createPower = async (input: PoaInput) =>
  (await api.post<{ power_of_attorney: PowerOfAttorney }>('/powers-of-attorney', input)).data.power_of_attorney

export const updatePower = async (poaId: string, patch: Partial<Omit<PoaInput, 'client_id'>> & { status?: 'active' | 'revoked' }) =>
  (await api.patch<{ power_of_attorney: PowerOfAttorney }>(`/powers-of-attorney/${poaId}`, patch)).data.power_of_attorney

/** Uploads the scan as the raw request body; `type` is its MIME type (PDF, PNG or JPEG). */
export const uploadScan = async (poaId: string, file: Blob, type: string) =>
  (await api.put<{ poa_id: string; has_scan: boolean }>(`/powers-of-attorney/${poaId}/scan`, file, { headers: { 'Content-Type': type } })).data

/* ───────────── hooks ───────────── */

const KEY = 'powers-of-attorney'

export const usePowers = (params: ListParams = {}, enabled = true) =>
  useQuery({ queryKey: [KEY, params], enabled, queryFn: () => fetchPowers(params) })

export const useAuthorizableLawyers = (enabled = true) =>
  useQuery({ queryKey: [KEY, 'lawyers'], enabled, queryFn: fetchAuthorizableLawyers, staleTime: 60_000 })

/** Saves a power of attorney (new or edited) and, when given, its scan; then refreshes every list. */
export const useSavePower = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ poaId, input, scan }: { poaId?: string; input: PoaInput; scan?: { file: Blob; type: string } | null }) => {
      const { client_id: _client, ...patch } = input
      const saved = poaId ? await updatePower(poaId, patch) : await createPower(input)
      // The record is kept even when the scan fails, so the form can retry the upload alone.
      let scanError: unknown = null
      if (scan) {
        try {
          await uploadScan(saved.poa_id, scan.file, scan.type)
        } catch (error) {
          scanError = error
        }
      }
      return { saved, scanError }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  })
}

export const useSetPowerStatus = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ poaId, status }: { poaId: string; status: 'active' | 'revoked' }) => updatePower(poaId, { status }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  })
}
