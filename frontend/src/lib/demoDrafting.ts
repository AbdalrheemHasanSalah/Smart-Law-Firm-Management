/**
 * Drafting and printing in demo mode: a few built-in skeletons, the office's templates and drafts,
 * the letterhead, and print codes that the public check recognises. Kept in memory like the rest
 * of the demo; no model is called (an AI draft is a fixed, marked sample).
 */
import type { Draft, DraftKind, Template } from './drafting'
import type { Letterhead, PrintKind, Verification } from './printing'

type Helpers = {
  fail: (status: number, code: string, extra?: object) => Error
  uid: (prefix: string) => string
  caseFor: (user: never, caseId: string) => unknown
}
type DemoActor = { user_id: string; full_name: string; role: string | null }
type Ctx = { user: DemoActor; params: string[]; query: Record<string, unknown>; body: Record<string, unknown> }
type DraftingRoute = [method: string, pattern: RegExp, roles: readonly string[], handler: (ctx: Ctx) => unknown]

const REVIEW = '[هيكل للمراجعة: أكمل ما بين الأقواس المربعة واكتب البنود بما يناسب الحالة، وراجع المسودة كاملة قبل استعمالها.]'
const BUILTIN: Template[] = [
  { key: 'contract_lease', kind: 'contract', title: 'عقد إيجار', builtin: true, body: `عقد إيجار\n\n${REVIEW}\n\nإنه في يوم {{today}} تم الاتفاق بين كل من:\nالفريق الأول (المؤجر): {{client_name}}، رقم الهوية {{client_national_id}}.\nالفريق الثاني (المستأجر): [الاسم]، رقم الهوية [الرقم].\n\nالمادة (1): المأجور وأوصافه\n[…]\n\nالمادة (2): مدة الإيجار وبدايتها\n[…]\n\nالمادة (3): الأجرة وطريقة دفعها\n[…]` },
  { key: 'pleading_claim', kind: 'pleading', title: 'لائحة دعوى', builtin: true, body: `لدى {{court_name}} الموقرة\n\n${REVIEW}\n\nالمدّعي: {{client_name}}.\nوكيله: {{lawyer_name}} — {{office_name}}.\nالمدّعى عليه: {{opponent_name}}.\n\nالوقائع:\n1. […]\n\nالطلبات:\n1. […]` },
  { key: 'letter_notice', kind: 'letter', title: 'كتاب إنذار', builtin: true, body: `التاريخ: {{today}}\n\n${REVIEW}\n\nإلى: {{opponent_name}}\n\nالموضوع: إنذار\n\nبالوكالة عن موكّلنا {{client_name}}، نُنذركم بما يلي:\n1. […]\n\n{{lawyer_name}}\n{{office_name}}` },
]

const templates: Template[] = []
const drafts: (Draft & { body: string })[] = []
const issued = new Map<string, { kind: PrintKind; issued_at: string; revoked_at: string | null }>()
const letterhead: Letterhead = {
  saved: { display_name: null, subtitle: 'محامون ومستشارون قانونيون', address: null, phone: null, email: null, license_number: null, footer_text: 'نسخة تجريبية — لا تُعتمد' },
  display_name: 'مكتب الخطيب للمحاماة (تجريبي)',
  subtitle: 'محامون ومستشارون قانونيون',
  address: 'رام الله، شارع الإرسال',
  phone: '02-2981234',
  email: 'office@demo.ps',
  license_number: null,
  footer_text: 'نسخة تجريبية — لا تُعتمد',
  has_logo: false,
  updated_at: null,
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const newCode = () => Array.from({ length: 10 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('')
const issue = (kind: PrintKind) => {
  const code = newCode()
  issued.set(code, { kind, issued_at: new Date().toISOString(), revoked_at: null })
  return code
}

/** The public check, answered before the demo looks for a signed-in user. */
export const demoVerification = (code: string): Verification => {
  const entry = issued.get(code.toUpperCase())
  if (!entry) return { status: 'not_found' }
  return { status: entry.revoked_at ? 'revoked' : 'valid', office_name: letterhead.display_name, kind: entry.kind, issued_at: entry.issued_at, revoked_at: entry.revoked_at }
}

const fill = (body: string, user: DemoActor) =>
  body.replace(/\{\{([a-z_]+)\}\}/g, (_, field: string) => ({
    client_name: 'يوسف دراغمة', client_national_id: '[…]', opponent_name: '[…]', court_name: 'محكمة بداية رام الله',
    office_name: letterhead.display_name, lawyer_name: user.full_name, today: new Date().toISOString().slice(0, 10),
  } as Record<string, string>)[field] ?? '[…]')

export const draftingRoutes = ({ fail, uid, caseFor }: Helpers): DraftingRoute[] => {
  const STAFF = ['admin', 'lawyer', 'assistant'] as const
  const now = () => new Date().toISOString()
  const find = (caseId: string, draftId: string) => {
    const draft = drafts.find((entry) => entry.case_id === caseId && entry.draft_id === draftId)
    if (!draft) throw fail(404, 'NOT_FOUND')
    return draft
  }
  const create = (user: DemoActor, caseId: string, values: { kind: DraftKind; title: string; body: string; source: Draft['source'] }) => {
    const draft: Draft & { body: string } = {
      draft_id: uid('dr'), case_id: caseId, ...values, source_ref: null, status: 'draft', finalized_at: null, revoked_at: null,
      created_at: now(), updated_at: now(), created_by: { user_id: user.user_id, full_name: user.full_name }, finalized_by: null, verification_code: null, fingerprint: null,
    }
    drafts.unshift(draft)
    return { draft }
  }
  return [
    ['get', /^\/letterhead$/, STAFF, () => ({ letterhead })],
    ['put', /^\/letterhead$/, ['admin'], ({ body }) => {
      for (const [key, value] of Object.entries(body)) {
        if (key in letterhead.saved) (letterhead.saved as Record<string, string | null>)[key] = (value as string) || null
      }
      Object.assign(letterhead, {
        display_name: letterhead.saved.display_name || 'مكتب الخطيب للمحاماة (تجريبي)',
        subtitle: letterhead.saved.subtitle, footer_text: letterhead.saved.footer_text,
        address: letterhead.saved.address || 'رام الله، شارع الإرسال', phone: letterhead.saved.phone || '02-2981234',
        email: letterhead.saved.email || 'office@demo.ps', license_number: letterhead.saved.license_number, updated_at: now(),
      })
      return { letterhead }
    }],
    ['put', /^\/letterhead\/logo$/, ['admin'], () => { throw fail(400, 'VALIDATION') }],
    ['get', /^\/templates$/, STAFF, () => ({ builtin: BUILTIN, templates })],
    ['post', /^\/templates$/, ['admin', 'lawyer'], ({ body }) => {
      const template: Template = { template_id: uid('tp'), kind: body.kind as DraftKind, title: String(body.title), body: String(body.body), builtin: false, updated_at: now() }
      templates.unshift(template)
      return { template }
    }],
    ['patch', /^\/templates\/([^/]+)$/, ['admin', 'lawyer'], ({ params, body }) => {
      const template = templates.find((entry) => entry.template_id === params[0])
      if (!template) throw fail(404, 'NOT_FOUND')
      Object.assign(template, body, { updated_at: now() })
      return { template }
    }],
    ['delete', /^\/templates\/([^/]+)$/, ['admin', 'lawyer'], ({ params }) => {
      const index = templates.findIndex((entry) => entry.template_id === params[0])
      if (index >= 0) templates.splice(index, 1)
      return { archived: true }
    }],
    ['get', /^\/cases\/([^/]+)\/drafts$/, STAFF, ({ user, params }) => {
      caseFor(user as never, params[0]!)
      return { drafts: drafts.filter((entry) => entry.case_id === params[0]).map(({ body: _body, ...rest }) => rest) }
    }],
    ['post', /^\/cases\/([^/]+)\/drafts$/, STAFF, ({ user, params, body }) => {
      caseFor(user as never, params[0]!)
      const template = body.template_key ? BUILTIN.find((entry) => entry.key === body.template_key) : body.template_id ? templates.find((entry) => entry.template_id === body.template_id) : null
      if ((body.template_key || body.template_id) && !template) throw fail(404, 'NOT_FOUND')
      return create(user, params[0]!, {
        kind: (body.kind as DraftKind) ?? template?.kind ?? 'other',
        title: (body.title as string) || template?.title || 'مستند',
        body: template ? fill(template.body, user) : '',
        source: body.template_key ? 'builtin' : body.template_id ? 'template' : 'blank',
      })
    }],
    ['post', /^\/cases\/([^/]+)\/drafts\/generate$/, STAFF, ({ user, params, body }) => {
      caseFor(user as never, params[0]!)
      return create(user, params[0]!, {
        kind: body.kind as DraftKind,
        title: 'مسودة تجريبية مصطنعة',
        body: `مسودة تجريبية مصطنعة لعرض الشاشة فقط: في النظام الحقيقي يصوغها الذكاء الاصطناعي من وصفك بعد حجب الأسماء والأرقام.\n\nالوصف: ${String(body.description ?? '')}\n\nالمادة (1): […]\nالمادة (2): الأجرة [المبلغ] تُدفع [المواعيد].\nالمادة (3): […]`,
        source: 'ai',
      })
    }],
    ['get', /^\/cases\/([^/]+)\/drafts\/([^/]+)$/, STAFF, ({ user, params }) => {
      caseFor(user as never, params[0]!)
      return { draft: find(params[0]!, params[1]!) }
    }],
    ['patch', /^\/cases\/([^/]+)\/drafts\/([^/]+)$/, STAFF, ({ user, params, body }) => {
      caseFor(user as never, params[0]!)
      const draft = find(params[0]!, params[1]!)
      if (draft.status !== 'draft') throw fail(409, 'DRAFT_FINAL')
      Object.assign(draft, body, { updated_at: now() })
      return { draft }
    }],
    ['delete', /^\/cases\/([^/]+)\/drafts\/([^/]+)$/, STAFF, ({ user, params }) => {
      caseFor(user as never, params[0]!)
      const draft = find(params[0]!, params[1]!)
      if (draft.status !== 'draft') throw fail(409, 'DRAFT_FINAL')
      drafts.splice(drafts.indexOf(draft), 1)
      return { removed: true }
    }],
    ['post', /^\/cases\/([^/]+)\/drafts\/([^/]+)\/finalize$/, STAFF, ({ user, params }) => {
      caseFor(user as never, params[0]!)
      const draft = find(params[0]!, params[1]!)
      if (draft.status !== 'draft') throw fail(409, 'DRAFT_FINAL')
      Object.assign(draft, { status: 'final', finalized_at: now(), finalized_by: { user_id: user.user_id, full_name: user.full_name }, verification_code: issue(draft.kind), fingerprint: 'demo', updated_at: now() })
      return { draft }
    }],
    ['post', /^\/cases\/([^/]+)\/drafts\/([^/]+)\/revoke$/, ['admin'], ({ user, params }) => {
      caseFor(user as never, params[0]!)
      const draft = find(params[0]!, params[1]!)
      if (draft.status !== 'final') throw fail(409, 'VALIDATION')
      Object.assign(draft, { status: 'revoked', revoked_at: now(), updated_at: now() })
      const entry = draft.verification_code ? issued.get(draft.verification_code) : undefined
      if (entry) entry.revoked_at = now()
      return { draft }
    }],
    ['post', /^\/prints$/, STAFF, ({ body }) => {
      if (typeof body.content !== 'string' || !body.content.trim()) throw fail(400, 'VALIDATION')
      const code = issue(body.kind as PrintKind)
      return { code, issued_at: now(), fingerprint: 'demo' }
    }],
  ]
}
