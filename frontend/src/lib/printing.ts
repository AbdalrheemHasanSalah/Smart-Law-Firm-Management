/**
 * The unified print engine: the office letterhead, dual Hijri and Gregorian dates, and the
 * verification code every printed document carries. Logic and API only; the paper itself is
 * drawn by ui/PrintSheet.tsx. No DOM code here, so a React Native client can reuse it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, API_URL, DEMO } from './api'
import { IS_EN } from './i18n'

export type Letterhead = {
  saved: Record<'display_name' | 'subtitle' | 'address' | 'phone' | 'email' | 'license_number' | 'footer_text', string | null>
  display_name: string
  subtitle: string | null
  address: string | null
  phone: string | null
  email: string | null
  license_number: string | null
  footer_text: string | null
  has_logo: boolean
  updated_at: string | null
}

export type PrintKind = 'contract' | 'pleading' | 'letter' | 'other' | 'statement' | 'hearing_prep' | 'analysis' | 'invoice' | 'report'
export type IssuedPrint = { code: string; issued_at: string; fingerprint: string }
export type Verification =
  | { status: 'not_found' }
  | { status: 'valid' | 'revoked'; office_name: string; kind: PrintKind; issued_at: string; revoked_at: string | null }

export const PRINT_KIND: Record<PrintKind, string> = {
  contract: 'عقد',
  pleading: 'لائحة',
  letter: 'كتاب',
  other: 'مستند',
  statement: 'كشف حساب',
  hearing_prep: 'ورقة تحضير جلسة',
  analysis: 'ورقة تحليل',
  invoice: 'فاتورة',
  report: 'تقرير',
}

/* ───────────── dates ───────────── */

const gregorian = new Intl.DateTimeFormat(IS_EN ? 'en-GB' : 'ar-PS-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' })
const hijri = new Intl.DateTimeFormat(IS_EN ? 'en-GB-u-ca-islamic-umalqura' : 'ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' })

/** "28 تشرين الثاني 2026 م · 8 جمادى الآخرة 1448 هـ", or "28 November 2026 AD · 8 Jumada II 1448 AH". */
export const dualDate = (value: Date | string = new Date()) => {
  const date = typeof value === 'string' ? new Date(value) : value
  // Engines differ on whether the era is already written; keep exactly one.
  const hijriText = hijri.format(date).replace(/\s*(هـ|AH)$/, '')
  return IS_EN
    ? { gregorian: `${gregorian.format(date)} AD`, hijri: `${hijriText} AH` }
    : { gregorian: `${gregorian.format(date)} م`, hijri: `${hijriText} هـ` }
}

/* ───────────── verification ───────────── */

/** The public address a printed QR code points to. */
export const verifyUrl = (code: string) => `${typeof window === 'undefined' ? '' : window.location.origin}/v/${code}`

/** "MR9T U75C FD", easier to read and type from paper. */
export const formatCode = (code: string) => code.replace(/(.{4})(.{4})(.*)/, '$1 $2 $3').trim()

export const logoUrl = () => `${API_URL}/letterhead/logo`

/* ───────────── API and hooks ───────────── */

const KEY = ['letterhead']

export const useLetterhead = () =>
  useQuery({ queryKey: KEY, queryFn: async () => (await api.get<{ letterhead: Letterhead }>('/letterhead')).data.letterhead, staleTime: 5 * 60_000 })

export const useSaveLetterhead = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: Partial<Letterhead['saved']>) => (await api.put<{ letterhead: Letterhead }>('/letterhead', input)).data.letterhead,
    onSuccess: (letterhead) => queryClient.setQueryData(KEY, letterhead),
  })
}

export const useLetterheadLogo = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File | null) =>
      file
        ? (await api.put<{ has_logo: boolean }>('/letterhead/logo', file, { headers: { 'Content-Type': file.type } })).data
        : (await api.delete<{ has_logo: boolean }>('/letterhead/logo')).data,
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}

/** Fingerprints the printed text and returns the code to print on it. */
export const registerPrint = async (kind: PrintKind, content: string) =>
  (await api.post<IssuedPrint>('/prints', { kind, content })).data

export const fetchVerification = async (code: string) => (await api.get<Verification>(`/public/verify/${encodeURIComponent(code)}`)).data

/** In demo mode the logo is served by no backend. */
export const LOGO_AVAILABLE = !DEMO
