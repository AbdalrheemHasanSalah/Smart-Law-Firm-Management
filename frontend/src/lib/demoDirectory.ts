/**
 * The professional directory in demo mode, kept in memory. People, numbers and notes are fictional.
 */
import type { Colleague, Court, MessageTemplate } from './directory'

type DemoActor = { user_id: string; role: string | null; is_platform_admin?: boolean }
type Ctx = { user: DemoActor; params: string[]; query: Record<string, unknown>; body: Record<string, unknown> }
type DirectoryRoute = [method: string, pattern: RegExp, roles: readonly string[], handler: (ctx: Ctx) => unknown]
type Helpers = { fail: (status: number, code: string, extra?: object) => Error; uid: (prefix: string) => string }

const court = (id: string, name: string, type: string, city: string, extra: Partial<Court> & { note?: string } = {}): Court & { note: string | null } => ({
  court_id: id, name, court_type: type, city, location: null, phone: null, email: null, working_hours: '8:00 – 14:30، الأحد إلى الخميس', is_active: true, office_note: null, note: null, ...extra,
})

const courts = [
  court('ct-1', 'محكمة صلح نابلس', 'صلح', 'نابلس', { location: 'مجمع المحاكم — شارع فيصل', phone: '09 200 0001', note: 'قلم الصلح في الطابق الثاني، الدور يبدأ 8:30.' }),
  court('ct-2', 'محكمة بداية نابلس', 'بداية', 'نابلس', { location: 'مجمع المحاكم — شارع فيصل', phone: '09 200 0002' }),
  court('ct-3', 'محكمة صلح رام الله', 'صلح', 'رام الله', { location: 'مجمع المحاكم — الماصيون' }),
  court('ct-4', 'محكمة بداية رام الله', 'بداية', 'رام الله', { location: 'مجمع المحاكم — الماصيون', phone: '02 200 0004' }),
  court('ct-5', 'محكمة الاستئناف — رام الله', 'استئناف', 'رام الله'),
  court('ct-6', 'محكمة صلح جنين', 'صلح', 'جنين'),
]

const colleagues: Colleague[] = [
  { colleague_id: 'cl-1', full_name: 'أحمد عيسى', bar_number: '4471', phone: '0599 000 111', email: 'a.issa@example.ps', city: 'جنين', office_name: 'مكتب عيسى للمحاماة', notes: 'وكيل الخصم في قضية النجار.', created_at: new Date(Date.now() - 40 * 86_400_000).toISOString() },
  { colleague_id: 'cl-2', full_name: 'سلمى الطيبي', bar_number: '5120', phone: '0568 000 222', email: null, city: 'رام الله', office_name: null, notes: null, created_at: new Date(Date.now() - 12 * 86_400_000).toISOString() },
]

const templates: MessageTemplate[] = [
  { template_id: 'tp-1', title: 'تأكيد حضور جلسة', body: 'الزميل المحترم الأستاذ {الزميل}،\nأؤكد حضوري جلسة القضية رقم {رقم_القضية} بتاريخ {الجلسة_القادمة} أمام {المحكمة}.\n{اسمي} — {مكتبي}' },
]

const text = (value: unknown, max: number) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null)

export const directoryRoutes = ({ fail, uid }: Helpers): DirectoryRoute[] => {
  const STAFF = ['admin', 'lawyer', 'assistant'] as const
  const view = (entry: (typeof courts)[number]): Court => {
    const { note, ...rest } = entry
    return { ...rest, office_note: note }
  }
  const pick = <T extends object>(body: Record<string, unknown>, keys: readonly (keyof T & string)[], max = 150) =>
    Object.fromEntries(keys.filter((key) => key in body).map((key) => [key, text(body[key], key === 'notes' ? 1000 : max)])) as Partial<T>
  const matches = (search: unknown, ...values: (string | null)[]) =>
    typeof search !== 'string' || !search.trim() || values.some((value) => value?.includes(search.trim()))

  return [
    ['get', /^\/courts$/, [...STAFF, 'platform'], ({ user, query }) => ({
      courts: courts.filter((entry) => (user.role ? entry.is_active : true) && matches(query.search, entry.name, entry.city)).map(view),
    })],
    ['post', /^\/courts$/, ['platform'], ({ body }) => {
      if (!text(body.name, 150)) throw fail(400, 'VALIDATION')
      const entry = court(uid('ct'), String(body.name).trim(), '', '', pick<Court>(body, ['court_type', 'city', 'location', 'phone', 'email', 'working_hours']))
      courts.push(entry)
      return { court: view(entry) }
    }],
    ['patch', /^\/courts\/([^/]+)$/, ['platform'], ({ params, body }) => {
      const entry = courts.find((row) => row.court_id === params[0])
      if (!entry) throw fail(404, 'NOT_FOUND')
      Object.assign(entry, pick<Court>(body, ['name', 'court_type', 'city', 'location', 'phone', 'email', 'working_hours']))
      if (typeof body.is_active === 'boolean') entry.is_active = body.is_active
      return { court: view(entry) }
    }],
    ['put', /^\/courts\/([^/]+)\/note$/, STAFF, ({ params, body }) => {
      const entry = courts.find((row) => row.court_id === params[0] && row.is_active)
      if (!entry) throw fail(404, 'NOT_FOUND')
      entry.note = text(body.note, 1000)
      return { court_id: entry.court_id, office_note: entry.note }
    }],

    ['get', /^\/colleagues$/, STAFF, ({ query }) => ({
      colleagues: colleagues
        .filter((entry) => matches(query.search, entry.full_name, entry.bar_number, entry.city, entry.office_name, entry.phone))
        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar')),
    })],
    ['post', /^\/colleagues$/, STAFF, ({ body }) => {
      if (!text(body.full_name, 150)) throw fail(400, 'VALIDATION')
      const colleague: Colleague = {
        colleague_id: uid('cl'), full_name: '', bar_number: null, phone: null, email: null, city: null, office_name: null, notes: null, created_at: new Date().toISOString(),
        ...pick<Colleague>(body, ['full_name', 'bar_number', 'phone', 'email', 'city', 'office_name', 'notes']),
      } as Colleague
      colleagues.push(colleague)
      return { colleague }
    }],
    ['patch', /^\/colleagues\/([^/]+)$/, STAFF, ({ params, body }) => {
      const colleague = colleagues.find((entry) => entry.colleague_id === params[0])
      if (!colleague) throw fail(404, 'NOT_FOUND')
      if ('full_name' in body && !text(body.full_name, 150)) throw fail(400, 'VALIDATION')
      Object.assign(colleague, pick<Colleague>(body, ['full_name', 'bar_number', 'phone', 'email', 'city', 'office_name', 'notes']))
      return { colleague }
    }],
    ['delete', /^\/colleagues\/([^/]+)$/, ['admin'], ({ params }) => {
      const index = colleagues.findIndex((entry) => entry.colleague_id === params[0])
      if (index < 0) throw fail(404, 'NOT_FOUND')
      colleagues.splice(index, 1)
      return { deleted: true }
    }],

    ['get', /^\/colleague-templates$/, STAFF, () => ({ templates: [...templates].sort((a, b) => a.title.localeCompare(b.title, 'ar')) })],
    ['post', /^\/colleague-templates$/, ['admin'], ({ body }) => {
      const title = text(body.title, 120)
      const content = text(body.body, 3000)
      if (!title || !content) throw fail(400, 'VALIDATION')
      const template = { template_id: uid('tp'), title, body: content }
      templates.push(template)
      return { template }
    }],
    ['patch', /^\/colleague-templates\/([^/]+)$/, ['admin'], ({ params, body }) => {
      const template = templates.find((entry) => entry.template_id === params[0])
      if (!template) throw fail(404, 'NOT_FOUND')
      if ('title' in body) template.title = text(body.title, 120) ?? template.title
      if ('body' in body) template.body = text(body.body, 3000) ?? template.body
      return { template }
    }],
    ['delete', /^\/colleague-templates\/([^/]+)$/, ['admin'], ({ params }) => {
      const index = templates.findIndex((entry) => entry.template_id === params[0])
      if (index < 0) throw fail(404, 'NOT_FOUND')
      templates.splice(index, 1)
      return { deleted: true }
    }],
  ]
}
