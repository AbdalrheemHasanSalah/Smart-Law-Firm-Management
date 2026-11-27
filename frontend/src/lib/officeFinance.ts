/**
 * Office finance: accounts, ledgers, transfers, expenses, custodies (العُهد) and profitability.
 * Types, wording, API calls and query hooks, free of DOM code so a React Native client can reuse them.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, API_URL } from './api'

export type Currency = 'ILS' | 'JOD' | 'USD'
export type AccountType = 'cash' | 'bank' | 'wallet'
export type ExpenseCategory = 'rent' | 'salaries' | 'utilities' | 'supplies' | 'transport' | 'court_costs' | 'other'

export type FinanceAccount = {
  account_id: string
  name: string
  account_type: AccountType
  currency: Currency
  opening_balance: number
  opened_on: string
  is_active: boolean
  balance: number
}

export type LedgerEntry = {
  kind: 'payment' | 'expense' | 'custody_issued' | 'custody_returned' | 'transfer_out' | 'transfer_in'
  id: string
  on_date: string
  amount: number
  reference: string | null
  party: string | null
  category: ExpenseCategory | null
  balance_after: number
}

export type Ledger = { account: FinanceAccount; from: string; to: string; balance_before: number; balance_after: number; entries: LedgerEntry[] }

export type Expense = {
  expense_id: string
  category: ExpenseCategory
  amount: number
  currency: Currency
  spent_on: string
  payee: string | null
  description: string | null
  account_id: string | null
  account_name: string | null
  custody_id: string | null
  custody_holder_name: string | null
  case_id: string | null
  case_number: string | null
  has_receipt: boolean
  status: 'active' | 'cancelled'
  created_by_name: string
  created_by_user_id: string
}

export type Custody = {
  custody_id: string
  holder_user_id: string
  holder_name: string
  account_id: string
  account_name: string
  amount: number
  currency: Currency
  issued_on: string
  purpose: string | null
  status: 'open' | 'settled'
  spent: number
  remaining: number
  settled_on: string | null
  returned_amount: number | null
  return_account_id: string | null
}

export type CurrencyResult = { currency: Currency; collected: number; spent: number; net: number }
export type Profitability = {
  from: string
  to: string
  totals: CurrencyResult[]
  months: (CurrencyResult & { month: string })[]
  by_category: { category: ExpenseCategory; currency: Currency; spent: number }[]
  cases: (CurrencyResult & { case_id: string; case_number: string; title: string })[]
}
export type CaseResult = { currency: Currency; billed: number; collected: number; spent: number; net: number }

export const ACCOUNT_TYPE: Record<AccountType, string> = { cash: 'صندوق نقدي', bank: 'حساب بنكي', wallet: 'محفظة إلكترونية' }

export const EXPENSE_CATEGORY: Record<ExpenseCategory, string> = {
  rent: 'إيجار',
  salaries: 'رواتب',
  utilities: 'كهرباء وماء واتصالات',
  supplies: 'قرطاسية ولوازم',
  transport: 'مواصلات',
  court_costs: 'رسوم ومصاريف محاكم',
  other: 'أخرى',
}

export const LEDGER_KIND: Record<LedgerEntry['kind'], string> = {
  payment: 'دفعة موكّل',
  expense: 'مصروف',
  custody_issued: 'صرف عُهدة',
  custody_returned: 'ردّ باقي عُهدة',
  transfer_out: 'تحويل إلى',
  transfer_in: 'تحويل من',
}

export const RECEIPT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024
export const expenseReceiptUrl = (expenseId: string) => `${API_URL}/finance/expenses/${expenseId}/receipt`

/** The first and last day of the current year, as YYYY-MM-DD. */
export const thisYear = () => {
  const year = new Date().getFullYear()
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

/** Open accounts that can receive or pay in `currency`. */
export const accountsIn = (accounts: FinanceAccount[] | undefined, currency: Currency) =>
  (accounts ?? []).filter((account) => account.is_active && account.currency === currency)

/* ───────────── API and hooks ───────────── */

const clean = (params: Record<string, string | undefined>) => Object.fromEntries(Object.entries(params).filter(([, value]) => value))

/** Every money view depends on the others, so a change refreshes all of them. */
export const refreshMoney = (queryClient: QueryClient) =>
  Promise.all(['accounts', 'ledger', 'expenses', 'custodies', 'profitability', 'invoices', 'finance-summary', 'statement'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))

export const useAccounts = (enabled = true) =>
  useQuery({ queryKey: ['accounts'], enabled, queryFn: async () => (await api.get<{ accounts: FinanceAccount[] }>('/finance/accounts')).data.accounts })

export const useLedger = (accountId: string | null, range: { from: string; to: string }) =>
  useQuery({
    queryKey: ['ledger', accountId, range.from, range.to],
    enabled: Boolean(accountId),
    queryFn: async () => (await api.get<Ledger>(`/finance/accounts/${accountId}/ledger`, { params: range })).data,
  })

export const useExpenses = (params: { from?: string; to?: string; category?: string; caseId?: string; custodyId?: string; status?: string } = {}) =>
  useQuery({
    queryKey: ['expenses', params],
    queryFn: async () => (await api.get<{ expenses: Expense[] }>('/finance/expenses', { params: { pageSize: 100, ...clean(params) } })).data.expenses,
  })

export const useCustodies = (params: { status?: string } = {}) =>
  useQuery({ queryKey: ['custodies', params], queryFn: async () => (await api.get<{ custodies: Custody[] }>('/finance/custodies', { params: clean(params) })).data.custodies })

export const useProfitability = (range: { from: string; to: string }) =>
  useQuery({ queryKey: ['profitability', range.from, range.to], queryFn: async () => (await api.get<Profitability>('/finance/profitability', { params: range })).data })

export const useCaseProfitability = (caseId: string, enabled = true) =>
  useQuery({
    queryKey: ['profitability', 'case', caseId],
    enabled,
    queryFn: async () => (await api.get<{ totals: CaseResult[] }>(`/finance/cases/${caseId}/profitability`)).data.totals,
  })

/** A mutation that refreshes every money view when it succeeds. */
const useMoneyMutation = <Input, Output>(work: (input: Input) => Promise<Output>) => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: work, onSuccess: () => refreshMoney(queryClient) })
}

export const useCreateAccount = () =>
  useMoneyMutation((input: { name: string; account_type: AccountType; currency: Currency; opening_balance: number; opened_on?: string }) =>
    api.post('/finance/accounts', input))

export const useUpdateAccount = () =>
  useMoneyMutation(({ accountId, patch }: { accountId: string; patch: { name?: string; is_active?: boolean } }) => api.patch(`/finance/accounts/${accountId}`, patch))

export const useTransfer = () =>
  useMoneyMutation((input: { from_account_id: string; to_account_id: string; amount: number; transferred_on: string; note?: string }) =>
    api.post('/finance/transfers', input))

export const useIssueCustody = () =>
  useMoneyMutation((input: { holder_user_id: string; account_id: string; amount: number; issued_on: string; purpose?: string }) =>
    api.post('/finance/custodies', input))

export const useSettleCustody = () =>
  useMoneyMutation(({ custodyId, ...input }: { custodyId: string; settled_on: string; return_account_id?: string }) =>
    api.post(`/finance/custodies/${custodyId}/settle`, input))

export const useCancelExpense = () => useMoneyMutation((expenseId: string) => api.post(`/finance/expenses/${expenseId}/cancel`))

export type ExpenseInput = {
  category: ExpenseCategory
  amount: number
  spent_on: string
  payee?: string
  description?: string
  case_id?: string
  account_id?: string
  custody_id?: string
}

/** Records an expense and, when given, its receipt; the expense is kept if only the upload fails. */
export const useRecordExpense = () =>
  useMoneyMutation(async ({ input, receipt }: { input: ExpenseInput; receipt?: { file: Blob; type: string } | null }) => {
    const { expense } = (await api.post<{ expense: Expense }>('/finance/expenses', input)).data
    let receiptError: unknown = null
    if (receipt) {
      try {
        await api.put(`/finance/expenses/${expense.expense_id}/receipt`, receipt.file, { headers: { 'Content-Type': receipt.type } })
      } catch (error) {
        receiptError = error
      }
    }
    return { expense, receiptError }
  })
