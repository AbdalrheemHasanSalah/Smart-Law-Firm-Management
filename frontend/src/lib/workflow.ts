/**
 * Case workflow (stages and Mizan), fee agreements with installments, and the client briefcase.
 * Types, wording, pure helpers, API and hooks; no DOM code, for the React Native port.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

/* ───────────── stages ───────────── */

export type Stage = 'registration' | 'preparation' | 'hearings' | 'judgment' | 'appeal' | 'execution' | 'closed'
export const STAGES: Stage[] = ['registration', 'preparation', 'hearings', 'judgment', 'appeal', 'execution', 'closed']
export const STAGE: Record<Stage, string> = {
  registration: 'التسجيل',
  preparation: 'التحضير',
  hearings: 'الجلسات',
  judgment: 'الحكم',
  appeal: 'الاستئناف',
  execution: 'التنفيذ',
  closed: 'الإقفال',
}

export type StageHistoryEntry = { history_id: string; from_stage: Stage | null; to_stage: Stage; note: string | null; changed_at: string; changed_by: { user_id: string; full_name: string } }
export type CaseStage = { stage: Stage; mizan_number?: string | null; mizan_url?: string | null; history?: StageHistoryEntry[] }

const stageKey = (caseId: string) => ['case-stage', caseId]

export const useCaseStage = (caseId: string) =>
  useQuery({ queryKey: stageKey(caseId), queryFn: async () => (await api.get<CaseStage>(`/cases/${caseId}/stage`)).data })

export const useChangeStage = (caseId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { stage: Stage; note?: string }) => (await api.put<CaseStage>(`/cases/${caseId}/stage`, input)).data,
    onSuccess: (data) => queryClient.setQueryData(stageKey(caseId), data),
  })
}

export const useSetMizan = (caseId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (mizan: string | null) => (await api.put<CaseStage>(`/cases/${caseId}/mizan`, { mizan_number: mizan })).data,
    onSuccess: (data) => queryClient.setQueryData(stageKey(caseId), data),
  })
}

/* ───────────── fee agreements ───────────── */

export type Currency = 'ILS' | 'JOD' | 'USD'
export type InstallmentState = 'paid' | 'partial' | 'overdue' | 'due' | 'cancelled'

export type Installment = {
  installment_id: string
  sequence: number
  due_on: string
  amount: number
  paid: number
  remaining: number
  invoice_id: string
  invoice_number: string
  invoice_status: string
  state: InstallmentState
}

export type FeeAgreement = {
  agreement_id: string
  case_id: string
  case_number: string
  case_title: string
  client_id: string
  client_name: string
  currency: Currency
  total_amount: number
  description: string | null
  status: 'active' | 'settled'
  settled_at: string | null
  settlement_amount: number | null
  settlement_note: string | null
  created_at: string
  created_by_name: string
  paid: number
  remaining: number
  overdue_count: number
  installments: Installment[]
}

export const INSTALLMENT_STATE: Record<InstallmentState, { text: string; tone: 'green' | 'blue' | 'red' | 'ink' }> = {
  paid: { text: 'مدفوع', tone: 'green' },
  partial: { text: 'مدفوع جزئياً', tone: 'blue' },
  overdue: { text: 'متأخر', tone: 'red' },
  due: { text: 'قادم', tone: 'ink' },
  cancelled: { text: 'ملغى', tone: 'ink' },
}

/** The same even split as the server: cents that do not divide evenly go to the last installment. */
export const previewSchedule = (total: number, count: number, firstDue: string, everyMonths = 1) => {
  if (!total || !count || !firstDue || !/^\d{4}-\d{2}-\d{2}$/.test(firstDue)) return []
  const cents = Math.round(total * 100)
  const base = Math.floor(cents / count)
  return Array.from({ length: count }, (_, index) => {
    const [year, month, day] = firstDue.split('-').map(Number) as [number, number, number]
    const target = new Date(Date.UTC(year, month - 1 + index * everyMonths, 1))
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
    target.setUTCDate(Math.min(day, last))
    return { due_on: target.toISOString().slice(0, 10), amount: (index === count - 1 ? cents - base * (count - 1) : base) / 100 }
  })
}

const agreementsKey = ['fee-agreements']

export const useAgreements = (filters: { caseId?: string; clientId?: string }, enabled = true) =>
  useQuery({
    queryKey: [...agreementsKey, filters],
    enabled,
    queryFn: async () => (await api.get<{ agreements: FeeAgreement[] }>('/fee-agreements', { params: filters })).data.agreements,
  })

const useAgreementMutation = <Input,>(run: (input: Input) => Promise<unknown>) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: agreementsKey })
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['briefcase'] })
    },
  })
}

export type AgreementInput = {
  case_id: string
  client_id: string
  currency: Currency
  total_amount: number
  description?: string
} & ({ plan: { count: number; first_due_on: string; every_months: number } } | { installments: { due_on: string; amount: number }[] })

export const useCreateAgreement = () => useAgreementMutation((input: AgreementInput) => api.post('/fee-agreements', input))
export const useSettleAgreement = () =>
  useAgreementMutation(({ agreementId, amount, note }: { agreementId: string; amount: number; note: string }) => api.post(`/fee-agreements/${agreementId}/settle`, { amount, note }))

/* ───────────── briefcase ───────────── */

export type Briefcase = {
  client: { client_id: string; client_type: string; full_name_or_org: string; phone: string | null; email: string | null; address?: string | null; national_id?: string | null }
  has_portal: boolean
  client_user_id: string | null
  cases: { case_id: string; case_number: string; title: string; status: string; stage: Stage; opened_at: string; next_hearing_at: string | null }[]
  messages: { message_id: string; body: string; sent_at: string; mine: boolean; has_voice: boolean; has_attachment: boolean }[]
  files: { file_id: string; purpose: string; file_name: string; size_bytes: number; note: string | null; status: 'new' | 'moved' | 'dismissed'; created_at: string; case_number: string | null }[]
  documents: { document_id: string; file_name: string; document_type: string; created_at: string; case_number: string }[]
  notices: { notice_id: string; kind: 'hearing' | 'judgment' | 'other'; title: string; sent_at: string; acknowledged_at: string | null; case_number: string }[]
  money: null | { currencies: { currency: Currency; billed: number; paid: number; balance: number }[]; agreements: FeeAgreement[] }
}

export const useBriefcase = (clientId: string) =>
  useQuery({ queryKey: ['briefcase', clientId], queryFn: async () => (await api.get<Briefcase>(`/clients/${clientId}/briefcase`)).data })
