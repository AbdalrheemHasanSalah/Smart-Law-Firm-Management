/**
 * Client files, chat attachments and official notices in demo mode. Kept in memory like the rest
 * of the demo; push notifications are reported as not configured (there is no server to push).
 */
import type { Delivery, Notice, NoticeKind, SharedFile } from './portalLink'

type Helpers = {
  fail: (status: number, code: string, extra?: object) => Error
  uid: (prefix: string) => string
  caseFor: (user: never, caseId: string) => { case_id: string; case_number: string; title: string }
  clientsOfCase: (caseId: string) => { client_id: string; full_name_or_org: string; user_id?: string | null }[]
}
type DemoActor = { user_id: string; full_name: string; role: string | null; client_id?: string }
type Ctx = { user: DemoActor; params: string[]; query: Record<string, unknown>; body: Record<string, unknown>; headers: Record<string, unknown> }
type PortalRoute = [method: string, pattern: RegExp, roles: readonly string[], handler: (ctx: Ctx) => unknown]

const files: SharedFile[] = []
const notices: (Notice & { client_user_id: string | null })[] = []

const header = (headers: Record<string, unknown>, name: string) => {
  const value = headers[name] ?? headers[name.toLowerCase()]
  if (typeof value !== 'string') return null
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** The attachment of a demo message, by the file id it was sent with. */
export const demoAttachment = (fileId: unknown) => {
  const file = typeof fileId === 'string' ? files.find((entry) => entry.file_id === fileId) : undefined
  return file ? { file_id: file.file_id, file_name: file.file_name, mime_type: file.mime_type, size_bytes: file.size_bytes, status: file.status } : null
}

/** What one client sent and was sent, for the demo briefcase. */
export const demoClientFiles = (clientId: string) => files.filter((entry) => entry.client_id === clientId)
export const demoClientNotices = (clientId: string) => notices.filter((entry) => entry.client_id === clientId)

export const portalRoutes = ({ fail, uid, caseFor, clientsOfCase }: Helpers): PortalRoute[] => {
  const STAFF = ['admin', 'lawyer', 'assistant'] as const
  const ALL = ['admin', 'lawyer', 'assistant', 'client'] as const
  const now = () => new Date().toISOString()
  return [
    ['get', /^\/push\/settings$/, ALL, () => ({ enabled: false, public_key: null })],
    ['post', /^\/shared-files$/, ALL, ({ user, headers, body }) => {
      const purpose = header(headers, 'X-Purpose')
      if (purpose !== 'portal' && purpose !== 'message') throw fail(400, 'VALIDATION')
      const caseId = header(headers, 'X-Case-Id')
      const kase = purpose === 'portal' && caseId ? caseFor(user as never, caseId) : null
      if (purpose === 'portal' && (user.role !== 'client' || !kase)) throw fail(400, 'VALIDATION')
      const name = header(headers, 'X-File-Name') ?? 'file'
      const blob = body as unknown as Blob
      const type = (blob?.type || 'application/pdf') as SharedFile['mime_type']
      const file: SharedFile = {
        file_id: uid('sf'), purpose, file_name: name, mime_type: type, size_bytes: blob?.size ?? 1, note: header(headers, 'X-Note'),
        status: 'new', case_id: kase?.case_id ?? null, case_number: kase?.case_number ?? null,
        client_id: user.role === 'client' ? user.client_id ?? null : null, client_name: user.role === 'client' ? user.full_name : null,
        moved_document_id: null, handled_at: null, created_at: now(), uploaded_by: { user_id: user.user_id, full_name: user.full_name },
      }
      files.unshift(file)
      return { file, case_id: file.case_id }
    }],
    ['get', /^\/shared-files\/mine$/, ['client'], ({ user }) => ({ files: files.filter((entry) => entry.uploaded_by.user_id === user.user_id && entry.purpose === 'portal') })],
    ['get', /^\/cases\/([^/]+)\/incoming-files$/, STAFF, ({ user, params }) => {
      caseFor(user as never, params[0]!)
      return { files: files.filter((entry) => entry.case_id === params[0] && entry.purpose === 'portal') }
    }],
    ['post', /^\/shared-files\/([^/]+)\/(move|dismiss)$/, STAFF, ({ user, params, body }) => {
      const file = files.find((entry) => entry.file_id === params[0])
      if (!file || !file.client_id) throw fail(404, 'NOT_FOUND')
      if (file.status !== 'new') throw fail(409, 'FILE_HANDLED')
      if (params[1] === 'move') {
        const caseId = (body.case_id as string) ?? file.case_id
        if (!caseId) throw fail(400, 'VALIDATION')
        const kase = caseFor(user as never, caseId)
        Object.assign(file, { status: 'moved', case_id: kase.case_id, case_number: kase.case_number, moved_document_id: uid('d'), handled_at: now() })
      } else {
        Object.assign(file, { status: 'dismissed', handled_at: now() })
      }
      return { file_id: file.file_id }
    }],

    ['get', /^\/cases\/([^/]+)\/notices$/, STAFF, ({ user, params }) => {
      caseFor(user as never, params[0]!)
      return { notices: notices.filter((entry) => entry.case_id === params[0]) }
    }],
    ['get', /^\/cases\/([^/]+)\/notices\/draft$/, STAFF, ({ user, params, query }) => {
      const kase = caseFor(user as never, params[0]!)
      const kind = query.kind as NoticeKind
      const client = clientsOfCase(kase.case_id).find((entry) => entry.client_id === query.clientId)
      const greeting = client ? `السيد/ة ${client.full_name_or_org}،\n` : ''
      if (kind === 'hearing') return { draft: { title: `موعد جلسة في القضية ${kase.case_number}`, body: `${greeting}نُعلمكم بموعد جلسة في القضية رقم ${kase.case_number} «${kase.title}». (نص تجريبي)` } }
      if (kind === 'judgment') return { draft: { title: `صدور حكم في القضية ${kase.case_number}`, body: `${greeting}نُعلمكم بصدور حكم في القضية رقم ${kase.case_number}. (نص تجريبي)` } }
      return { draft: { title: `إشعار بشأن القضية ${kase.case_number}`, body: greeting } }
    }],
    ['post', /^\/cases\/([^/]+)\/notices$/, STAFF, ({ user, params, body }) => {
      const kase = caseFor(user as never, params[0]!)
      const client = clientsOfCase(kase.case_id).find((entry) => entry.client_id === body.client_id)
      if (!client) throw fail(400, 'VALIDATION')
      const deliveries: Delivery[] = [
        { channel: 'portal', status: client.user_id ? 'sent' : 'skipped', detail: null, recorded_at: now() },
        { channel: 'push', status: 'skipped', detail: 'no device', recorded_at: now() },
        { channel: 'email', status: 'sent', detail: null, recorded_at: now() },
        { channel: 'whatsapp', status: 'prepared', detail: null, recorded_at: now() },
      ]
      const notice = {
        notice_id: uid('nt'), case_id: kase.case_id, case_number: kase.case_number, case_title: kase.title, kind: body.kind as NoticeKind,
        title: String(body.title), body: String(body.body), sent_at: now(), acknowledged_at: null, sent_by: { user_id: user.user_id, full_name: user.full_name },
        client_id: client.client_id, client_name: client.full_name_or_org, deliveries,
        whatsapp_url: `https://wa.me/970599123456?text=${encodeURIComponent(`${String(body.title)}\n\n${String(body.body)}`)}`,
        client_user_id: client.user_id ?? null,
      }
      notices.unshift(notice)
      return { notice }
    }],
    ['post', /^\/cases\/([^/]+)\/notices\/([^/]+)\/whatsapp-sent$/, STAFF, ({ params }) => {
      const notice = notices.find((entry) => entry.notice_id === params[1])
      if (!notice) throw fail(404, 'NOT_FOUND')
      notice.deliveries = [...(notice.deliveries ?? []), { channel: 'whatsapp', status: 'sent', detail: 'sent by the lawyer', recorded_at: now() }]
      return { notice }
    }],
    ['get', /^\/notices\/mine$/, ['client'], ({ user }) => ({
      notices: notices
        .filter((entry) => entry.client_user_id === user.user_id)
        .map(({ deliveries: _deliveries, whatsapp_url: _url, client_user_id: _user, client_id: _client, client_name: _name, ...rest }) => rest),
    })],
    ['post', /^\/notices\/([^/]+)\/acknowledge$/, ['client'], ({ user, params }) => {
      const notice = notices.find((entry) => entry.notice_id === params[0] && entry.client_user_id === user.user_id)
      if (!notice) throw fail(404, 'NOT_FOUND')
      notice.acknowledged_at ??= now()
      return { acknowledged_at: notice.acknowledged_at }
    }],
  ]
}
