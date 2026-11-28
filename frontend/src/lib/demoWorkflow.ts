/**
 * Case stages, fee agreements and the client briefcase in demo mode, kept in memory.
 * Installment invoices are numbered here but are not added to the demo invoice list.
 */
import { previewSchedule, STAGES, type Briefcase, type CaseStage, type FeeAgreement, type Installment, type Stage, type StageHistoryEntry } from './workflow'
import { demoClientFiles, demoClientNotices } from './demoPortal'

type DemoActor = { user_id: string; full_name: string; role: string | null; client_id?: string }
type Ctx = { user: DemoActor; params: string[]; query: Record<string, unknown>; body: Record<string, unknown> }
type WorkflowRoute = [method: string, pattern: RegExp, roles: readonly string[], handler: (ctx: Ctx) => unknown]
type DemoCase = { case_id: string; case_number: string; title: string; status: string; opened_at: string }
type DemoClient = { client_id: string; client_type: string; full_name_or_org: string; phone: string | null; email: string | null; address?: string | null }

type Helpers = {
  fail: (status: number, code: string, extra?: object) => Error
  uid: (prefix: string) => string
  caseFor: (user: never, caseId: string) => DemoCase
  visibleCases: (user: never) => DemoCase[]
  clientsOfCase: (caseId: string) => { client_id: string; full_name_or_org: string; user_id?: string | null }[]
  clientById: (clientId: string) => DemoClient | undefined
  casesOfClient: (clientId: string) => string[]
  clientUserId: (clientId: string) => string | null
  thread: (userId: string, otherId: string) => { message_id: string; body: string; sent_at: string; sender_user_id: string; voice?: unknown; attachment?: unknown }[]
  documentsOfClient: (clientId: string, caseIds: string[]) => { document_id: string; file_name: string; document_type: string; created_at: string; case_id: string }[]
  nextHearing: (caseId: string) => string | null
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const at = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString()
const MIZAN_URL = 'https://mizan.example.ps/search'

const stages = new Map<string, { stage: Stage; mizan: string | null; history: StageHistoryEntry[] }>([
  ['k-1', {
    stage: 'hearings',
    mizan: '1834/2026',
    history: [
      { history_id: 'sh-1', from_stage: 'registration', to_stage: 'preparation', note: 'استُلمت المستندات من الموكّل.', changed_at: at(-115), changed_by: { user_id: 'u-lawyer', full_name: 'ليان عودة' } },
      { history_id: 'sh-2', from_stage: 'preparation', to_stage: 'hearings', note: 'قُيّدت الدعوى وتحدّدت أول جلسة.', changed_at: at(-100), changed_by: { user_id: 'u-lawyer', full_name: 'ليان عودة' } },
    ],
  }],
  ['k-3', { stage: 'preparation', mizan: null, history: [] }],
  ['k-5', { stage: 'closed', mizan: '0972/2025', history: [] }],
])

let invoiceCounter = 40
const invoiceNumber = () => `INV-2026-${String(++invoiceCounter).padStart(4, '0')}`

type StoredInstallment = Omit<Installment, 'state' | 'remaining'> & { cancelled: boolean }
type StoredAgreement = Omit<FeeAgreement, 'installments' | 'paid' | 'remaining' | 'overdue_count'> & { installments: StoredInstallment[] }

const agreements: StoredAgreement[] = [
  {
    agreement_id: 'fa-1', case_id: 'k-1', case_number: '2026/114', case_title: 'مطالبة مالية — النجار ضد شركة البناء الحديث',
    client_id: 'c-1', client_name: 'محمود النجار', currency: 'ILS', total_amount: 4500, description: 'أتعاب الدعوى حتى صدور الحكم',
    status: 'active', settled_at: null, settlement_amount: null, settlement_note: null, created_at: at(-110), created_by_name: 'سامر الخطيب',
    installments: [
      { installment_id: 'fi-1', sequence: 1, due_on: day(-100), amount: 1500, paid: 1500, invoice_id: 'inv-fa-1', invoice_number: 'INV-2026-0031', invoice_status: 'paid', cancelled: false },
      { installment_id: 'fi-2', sequence: 2, due_on: day(-9), amount: 1500, paid: 0, invoice_id: 'inv-fa-2', invoice_number: 'INV-2026-0032', invoice_status: 'unpaid', cancelled: false },
      { installment_id: 'fi-3', sequence: 3, due_on: day(21), amount: 1500, paid: 0, invoice_id: 'inv-fa-3', invoice_number: 'INV-2026-0033', invoice_status: 'unpaid', cancelled: false },
    ],
  },
]

const round = (value: number) => Math.round(value * 100) / 100

const view = (stored: StoredAgreement): FeeAgreement => {
  const today = day(0)
  const installments: Installment[] = stored.installments.map(({ cancelled, ...entry }) => {
    const state = cancelled ? 'cancelled' : entry.paid >= entry.amount ? 'paid' : entry.due_on < today ? 'overdue' : entry.paid > 0 ? 'partial' : 'due'
    return { ...entry, state, remaining: cancelled ? 0 : round(entry.amount - entry.paid) }
  })
  const live = installments.filter((entry) => entry.state !== 'cancelled')
  const settlement = stored.status === 'settled' ? stored.settlement_amount ?? 0 : 0
  const paid = round(installments.reduce((sum, entry) => sum + entry.paid, 0))
  return {
    ...stored,
    installments,
    paid,
    remaining: round(live.reduce((sum, entry) => sum + entry.remaining, 0) + settlement),
    overdue_count: installments.filter((entry) => entry.state === 'overdue').length,
  }
}

export const workflowRoutes = (helpers: Helpers): WorkflowRoute[] => {
  const { fail, uid } = helpers
  const STAFF = ['admin', 'lawyer', 'assistant'] as const
  const ALL = [...STAFF, 'client'] as const
  const stageOf = (caseId: string) => {
    if (!stages.has(caseId)) stages.set(caseId, { stage: 'registration', mizan: null, history: [] })
    return stages.get(caseId)!
  }
  const stageView = (user: DemoActor, caseId: string): CaseStage => {
    const entry = stageOf(caseId)
    if (user.role === 'client') return { stage: entry.stage }
    return { stage: entry.stage, mizan_number: entry.mizan, mizan_url: MIZAN_URL, history: [...entry.history].reverse() }
  }
  const mover = (user: DemoActor, caseId: string) => {
    helpers.caseFor(user as never, caseId)
    if (user.role !== 'admin' && user.role !== 'lawyer') throw fail(403, 'FORBIDDEN')
  }

  return [
    ['get', /^\/cases\/([^/]+)\/stage$/, ALL, ({ user, params }) => {
      helpers.caseFor(user as never, params[0]!)
      return stageView(user, params[0]!)
    }],
    ['put', /^\/cases\/([^/]+)\/stage$/, STAFF, ({ user, params, body }) => {
      const caseId = params[0]!
      mover(user, caseId)
      const next = body.stage as Stage
      if (!STAGES.includes(next)) throw fail(400, 'VALIDATION')
      const entry = stageOf(caseId)
      if (entry.stage === next) throw fail(409, 'SAME_STAGE')
      entry.history.push({ history_id: uid('sh'), from_stage: entry.stage, to_stage: next, note: typeof body.note === 'string' ? body.note : null, changed_at: new Date().toISOString(), changed_by: { user_id: user.user_id, full_name: user.full_name } })
      entry.stage = next
      return stageView(user, caseId)
    }],
    ['put', /^\/cases\/([^/]+)\/mizan$/, STAFF, ({ user, params, body }) => {
      mover(user, params[0]!)
      const value = typeof body.mizan_number === 'string' ? body.mizan_number.trim() : ''
      stageOf(params[0]!).mizan = value || null
      return stageView(user, params[0]!)
    }],

    ['get', /^\/fee-agreements$/, ['admin'], ({ query }) => ({
      agreements: agreements
        .filter((entry) => (!query.caseId || entry.case_id === query.caseId) && (!query.clientId || entry.client_id === query.clientId))
        .map(view),
    })],
    ['post', /^\/fee-agreements$/, ['admin'], ({ user, body }) => {
      const kase = helpers.caseFor(user as never, String(body.case_id))
      const client = helpers.clientsOfCase(kase.case_id).find((entry) => entry.client_id === body.client_id)
      if (!client) throw fail(400, 'VALIDATION')
      const total = Number(body.total_amount)
      const plan = body.plan as { count: number; first_due_on: string; every_months?: number } | undefined
      const schedule = plan ? previewSchedule(total, Number(plan.count), plan.first_due_on, Number(plan.every_months ?? 1)) : (body.installments as { due_on: string; amount: number }[] | undefined) ?? []
      const sum = Math.round(schedule.reduce((acc, entry) => acc + Number(entry.amount) * 100, 0))
      if (!(total > 0) || schedule.length === 0 || sum !== Math.round(total * 100)) throw fail(400, 'VALIDATION')
      const agreement: StoredAgreement = {
        agreement_id: uid('fa'), case_id: kase.case_id, case_number: kase.case_number, case_title: kase.title,
        client_id: client.client_id, client_name: client.full_name_or_org, currency: body.currency as FeeAgreement['currency'], total_amount: total,
        description: typeof body.description === 'string' ? body.description : null, status: 'active', settled_at: null, settlement_amount: null,
        settlement_note: null, created_at: new Date().toISOString(), created_by_name: user.full_name,
        installments: schedule.map((entry, index) => ({
          installment_id: uid('fi'), sequence: index + 1, due_on: entry.due_on, amount: Number(entry.amount), paid: 0,
          invoice_id: uid('inv'), invoice_number: invoiceNumber(), invoice_status: 'unpaid', cancelled: false,
        })),
      }
      agreements.unshift(agreement)
      return { agreement: view(agreement) }
    }],
    ['post', /^\/fee-agreements\/([^/]+)\/settle$/, ['admin'], ({ params, body }) => {
      const agreement = agreements.find((entry) => entry.agreement_id === params[0])
      if (!agreement) throw fail(404, 'NOT_FOUND')
      if (agreement.status === 'settled') throw fail(409, 'AGREEMENT_SETTLED')
      const amount = Number(body.amount)
      if (!(amount >= 0) || typeof body.note !== 'string' || !body.note.trim()) throw fail(400, 'VALIDATION')
      for (const entry of agreement.installments) {
        if (entry.paid === 0 && !entry.cancelled) {
          entry.cancelled = true
          entry.invoice_status = 'cancelled'
        }
      }
      Object.assign(agreement, { status: 'settled', settled_at: new Date().toISOString(), settlement_amount: amount, settlement_note: body.note.trim() })
      return { agreement: view(agreement) }
    }],

    ['get', /^\/clients\/([^/]+)\/briefcase$/, STAFF, ({ user, params }) => {
      const clientId = params[0]!
      const client = helpers.clientById(clientId)
      if (!client) throw fail(404, 'NOT_FOUND')
      const caseIds = helpers.casesOfClient(clientId)
      const visible = helpers.visibleCases(user as never).filter((row) => caseIds.includes(row.case_id))
      const clientUser = helpers.clientUserId(clientId)
      const numberOf = (caseId: string) => visible.find((row) => row.case_id === caseId)?.case_number ?? ''
      const visibleIds = visible.map((row) => row.case_id)
      const briefcase: Briefcase = {
        client: { ...client, address: client.address ?? null },
        has_portal: clientUser !== null,
        client_user_id: clientUser,
        cases: visible.map((row) => ({ case_id: row.case_id, case_number: row.case_number, title: row.title, status: row.status, stage: stageOf(row.case_id).stage, opened_at: row.opened_at, next_hearing_at: helpers.nextHearing(row.case_id) })),
        messages: clientUser
          ? helpers.thread(user.user_id, clientUser).slice(-5).reverse().map((message) => ({
            message_id: message.message_id, body: message.body, sent_at: message.sent_at, mine: message.sender_user_id === user.user_id,
            has_voice: Boolean(message.voice), has_attachment: Boolean(message.attachment),
          }))
          : [],
        files: demoClientFiles(clientId).map((file) => ({ file_id: file.file_id, purpose: file.purpose, file_name: file.file_name, size_bytes: file.size_bytes, note: file.note, status: file.status, created_at: file.created_at, case_number: file.case_number })),
        documents: helpers.documentsOfClient(clientId, visibleIds).map((document) => ({ ...document, case_number: numberOf(document.case_id) })),
        notices: demoClientNotices(clientId).filter((notice) => visibleIds.includes(notice.case_id)).map((notice) => ({ notice_id: notice.notice_id, kind: notice.kind, title: notice.title, sent_at: notice.sent_at, acknowledged_at: notice.acknowledged_at, case_number: notice.case_number })),
        money: user.role === 'admin'
          ? {
            currencies: (() => {
              const own = agreements.filter((entry) => entry.client_id === clientId).map(view)
              const byCurrency = new Map<FeeAgreement['currency'], { billed: number; paid: number }>()
              for (const entry of own) {
                const billed = entry.installments.filter((part) => part.state !== 'cancelled').reduce((sum, part) => sum + part.amount, 0) + (entry.settlement_amount ?? 0)
                const totals = byCurrency.get(entry.currency) ?? { billed: 0, paid: 0 }
                byCurrency.set(entry.currency, { billed: totals.billed + billed, paid: totals.paid + entry.paid })
              }
              return [...byCurrency].map(([currency, totals]) => ({ currency, billed: round(totals.billed), paid: round(totals.paid), balance: round(totals.billed - totals.paid) }))
            })(),
            agreements: agreements.filter((entry) => entry.client_id === clientId).map(view),
          }
          : null,
      }
      return briefcase
    }],
  ]
}
