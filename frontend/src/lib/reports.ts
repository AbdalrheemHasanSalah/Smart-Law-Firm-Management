/**
 * Office reports: the report's shape, its wording, the query hook and a CSV builder.
 * Free of DOM code so a React Native client can reuse it (saving the file is the screen's job).
 */
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { Currency, ExpenseCategory } from './officeFinance'

type Counts = Record<string, number>

export type OfficeReport = {
  from: string
  to: string
  scope: 'office' | 'member'
  user_id: string | null
  cases: {
    by_status: Counts
    by_type: { case_type: string; count: number }[]
    opened: number
    closed: number
    per_lawyer: { user_id: string; full_name: string; open: number; closed: number }[] | null
  }
  hearings: {
    by_status: Counts
    missed: { hearing_id: string; hearing_at: string; hearing_type: string; case_id: string; case_number: string; title: string }[]
  }
  tasks: {
    by_status: Counts
    overdue: { task_id: string; title: string; due_at: string; priority: string; assignee_name: string; case_id: string | null; case_number: string | null }[]
  }
  finance: {
    billed_vs_collected: { currency: Currency; billed: number; collected: number }[]
    aging: ({ currency: Currency; total: number } & Record<AgingBucket, number>)[]
    debtors: { client_id: string; client_name: string; currency: Currency; outstanding: number; invoices: number; oldest_days_late: number }[]
    expenses_by_category: { category: ExpenseCategory; currency: Currency; spent: number }[]
    profit_by_month: { month: string; currency: Currency; collected: number; spent: number; net: number }[]
    profit_totals: { currency: Currency; collected: number; spent: number; net: number }[]
  } | null
}

export type AgingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus'

export const AGING: readonly (readonly [AgingBucket, string])[] = [
  ['current', 'غير مستحق بعد'],
  ['d1_30', 'متأخر حتى 30 يوماً'],
  ['d31_60', '31–60 يوماً'],
  ['d61_90', '61–90 يوماً'],
  ['d90_plus', 'أكثر من 90 يوماً'],
]

const pad = (value: number) => String(value).padStart(2, '0')
const day = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** Ready-made periods: this month, this quarter, this year, the last 12 months. */
export const PERIODS = {
  month: () => {
    const now = new Date()
    return { from: day(new Date(now.getFullYear(), now.getMonth(), 1)), to: day(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
  },
  quarter: () => {
    const now = new Date()
    const start = Math.floor(now.getMonth() / 3) * 3
    return { from: day(new Date(now.getFullYear(), start, 1)), to: day(new Date(now.getFullYear(), start + 3, 0)) }
  },
  year: () => {
    const now = new Date()
    return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` }
  },
  last12: () => {
    const now = new Date()
    return { from: day(new Date(now.getFullYear() - 1, now.getMonth() + 1, 1)), to: day(now) }
  },
} as const
export type PeriodKey = keyof typeof PERIODS
export const PERIOD_LABELS: readonly (readonly [PeriodKey | 'custom', string])[] = [
  ['month', 'هذا الشهر'],
  ['quarter', 'هذا الربع'],
  ['year', 'هذه السنة'],
  ['last12', 'آخر 12 شهراً'],
  ['custom', 'فترة مخصّصة'],
]

export const useReport = (params: { from: string; to: string; userId?: string | null }) =>
  useQuery({
    queryKey: ['report', params.from, params.to, params.userId ?? null],
    queryFn: async () => (await api.get<OfficeReport>('/reports', { params: { from: params.from, to: params.to, ...(params.userId ? { userId: params.userId } : {}) } })).data,
  })

/**
 * A CSV document (comma separated, quoted where needed) that Excel opens with Arabic intact:
 * it starts with a byte-order mark and uses CRLF line ends.
 */
export function toCsv<Row>(rows: Row[], columns: readonly (readonly [string, (row: Row) => string | number | null | undefined])[]) {
  const cell = (value: string | number | null | undefined) => {
    const text = value === null || value === undefined ? '' : String(value)
    // A leading =, +, - or @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  const lines = [columns.map(([title]) => cell(title)).join(','), ...rows.map((row) => columns.map(([, read]) => cell(read(row))).join(','))]
  return `﻿${lines.join('\r\n')}\r\n`
}
