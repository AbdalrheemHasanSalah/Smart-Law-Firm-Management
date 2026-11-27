/**
 * Team HR: staff records, advances, payslips and leave. Types, wording, API calls and query hooks,
 * free of DOM code so a React Native client can reuse them.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { Currency } from './officeFinance'

export type LeaveType = 'annual' | 'sick' | 'unpaid' | 'other'
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export type StaffRecord = {
  user_id: string
  full_name: string
  email: string
  role: 'admin' | 'lawyer' | 'assistant'
  membership_status: 'active' | 'suspended'
  job_title: string | null
  hire_date: string | null
  phone: string | null
  national_id?: string | null
  monthly_salary: number | null
  salary_currency: Currency
  annual_leave_days: number
  show_on_public_page: boolean
  has_record: boolean
  advances_owed: number
  annual_used: number
  annual_pending: number
  annual_remaining: number
}

export type Advance = { advance_id: string; user_id: string; full_name: string; amount: number; currency: Currency; given_on: string; note: string | null; account_name: string | null }

export type Payslip = {
  payslip_id: string
  user_id: string
  full_name: string
  period: string
  salary: number
  advance_deduction: number
  other_deductions: number
  deduction_note: string | null
  net: number
  currency: Currency
  status: 'draft' | 'paid'
  paid_on: string | null
  account_name: string | null
  advances_owed: number
}

export type LeaveRequest = {
  leave_id: string
  user_id: string
  full_name: string
  leave_type: LeaveType
  starts_on: string
  ends_on: string
  days: number
  reason: string | null
  status: LeaveStatus
  decision_note: string | null
  decided_by_name: string | null
  created_at: string
}

export const LEAVE_TYPE: Record<LeaveType, string> = { annual: 'سنوية', sick: 'مرضية', unpaid: 'بلا راتب', other: 'أخرى' }

export const LEAVE_STATUS: Record<LeaveStatus, { text: string; tone: 'blue' | 'green' | 'red' | 'ink' }> = {
  pending: { text: 'بانتظار القرار', tone: 'blue' },
  approved: { text: 'موافق عليها', tone: 'green' },
  rejected: { text: 'مرفوضة', tone: 'red' },
  cancelled: { text: 'ملغاة', tone: 'ink' },
}

/** Working days between two dates (YYYY-MM-DD), both included, Fridays not counted: as the server counts. */
export const leaveDays = (startsOn: string, endsOn: string) => {
  if (!startsOn || !endsOn || endsOn < startsOn) return 0
  let days = 0
  for (const day = new Date(`${startsOn}T00:00:00Z`); day.toISOString().slice(0, 10) <= endsOn; day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() !== 5) days += 1
  }
  return days
}

/** The current month as YYYY-MM. */
export const thisMonth = () => new Date().toISOString().slice(0, 7)

/* ───────────── hooks ───────────── */

const useRefresh = () => {
  const queryClient = useQueryClient()
  return () =>
    Promise.all(['hr', 'accounts', 'ledger', 'expenses', 'profitability', 'calendar'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
}

const useHrMutation = <Input, Output>(work: (input: Input) => Promise<Output>) => {
  const refresh = useRefresh()
  return useMutation({ mutationFn: work, onSuccess: () => refresh() })
}

export const useMyHr = () =>
  useQuery({
    queryKey: ['hr', 'me'],
    queryFn: async () => (await api.get<{ profile: StaffRecord; payslips: Payslip[]; leave: LeaveRequest[]; advances: Advance[] }>('/hr/me')).data,
  })

export const useStaffRecords = () =>
  useQuery({ queryKey: ['hr', 'staff'], queryFn: async () => (await api.get<{ staff: StaffRecord[] }>('/hr/staff')).data.staff })

export const useAdvances = () =>
  useQuery({ queryKey: ['hr', 'advances'], queryFn: async () => (await api.get<{ advances: Advance[] }>('/hr/advances')).data.advances })

export const usePayslips = (period: string) =>
  useQuery({ queryKey: ['hr', 'payslips', period], queryFn: async () => (await api.get<{ payslips: Payslip[] }>('/hr/payslips', { params: { period } })).data.payslips })

export const useLeaveRequests = (status?: LeaveStatus) =>
  useQuery({
    queryKey: ['hr', 'leave', status ?? 'all'],
    queryFn: async () => (await api.get<{ leave: LeaveRequest[] }>('/hr/leave', { params: status ? { status } : {} })).data.leave,
  })

export type StaffRecordInput = {
  job_title: string | null
  hire_date: string | null
  phone: string | null
  national_id: string | null
  monthly_salary: number | null
  salary_currency: Currency
  annual_leave_days: number
  show_on_public_page: boolean
}

export const useSaveStaffRecord = () =>
  useHrMutation(({ userId, input }: { userId: string; input: StaffRecordInput }) => api.put(`/hr/staff/${userId}`, input))

export const useGiveAdvance = () =>
  useHrMutation((input: { user_id: string; amount: number; account_id: string; given_on: string; note?: string }) => api.post('/hr/advances', input))

export const usePreparePayroll = () =>
  useHrMutation(async (period: string) => (await api.post<{ created: number }>('/hr/payroll', { period })).data)

export const useUpdatePayslip = () =>
  useHrMutation(({ payslipId, patch }: { payslipId: string; patch: { advance_deduction?: number; other_deductions?: number; deduction_note?: string | null } }) =>
    api.patch(`/hr/payslips/${payslipId}`, patch))

export const useDeletePayslip = () => useHrMutation((payslipId: string) => api.delete(`/hr/payslips/${payslipId}`))

export const usePayPayslip = () =>
  useHrMutation(({ payslipId, ...input }: { payslipId: string; account_id?: string; paid_on: string }) => api.post(`/hr/payslips/${payslipId}/pay`, input))

export const useRequestLeave = () =>
  useHrMutation((input: { leave_type: LeaveType; starts_on: string; ends_on: string; reason?: string }) => api.post('/hr/leave', input))

export const useDecideLeave = () =>
  useHrMutation(({ leaveId, ...input }: { leaveId: string; status: 'approved' | 'rejected'; decision_note?: string }) => api.post(`/hr/leave/${leaveId}/decision`, input))

export const useCancelLeave = () => useHrMutation((leaveId: string) => api.post(`/hr/leave/${leaveId}/cancel`))
