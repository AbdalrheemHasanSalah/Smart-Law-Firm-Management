/**
 * The professional directory (courts and colleagues) and the communication center: message
 * templates to colleagues that open prefilled in WhatsApp or the mail app. Nothing is sent by the
 * system. Types, wording, pure helpers, API and hooks; no DOM code, for the React Native port.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

/* ───────────── courts ───────────── */

export type Court = {
  court_id: string
  name: string
  court_type: string | null
  city: string | null
  location: string | null
  phone: string | null
  email: string | null
  working_hours: string | null
  is_active: boolean
  office_note: string | null
}
export type CourtInput = Partial<Pick<Court, 'name' | 'court_type' | 'city' | 'location' | 'phone' | 'email' | 'working_hours'>> & { is_active?: boolean }

export const useCourts = (search = '') =>
  useQuery({
    queryKey: ['courts', search],
    queryFn: async () => (await api.get<{ courts: Court[] }>('/courts', { params: search ? { search } : {} })).data.courts,
  })

const useCourtMutation = <Input,>(run: (input: Input) => Promise<unknown>) => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: run, onSettled: () => void queryClient.invalidateQueries({ queryKey: ['courts'] }) })
}
export const useSaveCourt = () =>
  useCourtMutation(({ courtId, input }: { courtId?: string; input: CourtInput }) => (courtId ? api.patch(`/courts/${courtId}`, input) : api.post('/courts', input)))
export const useCourtNote = () =>
  useCourtMutation(({ courtId, note }: { courtId: string; note: string }) => api.put(`/courts/${courtId}/note`, { note }))

/* ───────────── colleagues ───────────── */

export type Colleague = {
  colleague_id: string
  full_name: string
  bar_number: string | null
  phone: string | null
  email: string | null
  city: string | null
  office_name: string | null
  notes: string | null
  created_at: string
}
export type ColleagueInput = Partial<Omit<Colleague, 'colleague_id' | 'created_at'>>

export const useColleagues = (search = '') =>
  useQuery({
    queryKey: ['colleagues', search],
    queryFn: async () => (await api.get<{ colleagues: Colleague[] }>('/colleagues', { params: search ? { search } : {} })).data.colleagues,
  })

const useColleagueMutation = <Input,>(run: (input: Input) => Promise<unknown>) => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: run, onSettled: () => void queryClient.invalidateQueries({ queryKey: ['colleagues'] }) })
}
export const useSaveColleague = () =>
  useColleagueMutation(({ colleagueId, input }: { colleagueId?: string; input: ColleagueInput }) =>
    colleagueId ? api.patch(`/colleagues/${colleagueId}`, input) : api.post('/colleagues', input))
export const useDeleteColleague = () => useColleagueMutation((colleagueId: string) => api.delete(`/colleagues/${colleagueId}`))

/* ───────────── message templates ───────────── */

export type MessageTemplate = { template_id: string; title: string; body: string; builtIn?: boolean }

/** The fields a template may use, filled from the colleague, the case and the sender. */
export const PLACEHOLDERS = [
  ['{الزميل}', 'اسم الزميل'],
  ['{رقم_القضية}', 'رقم القضية'],
  ['{موضوع_القضية}', 'موضوع القضية'],
  ['{المحكمة}', 'المحكمة'],
  ['{الجلسة_القادمة}', 'موعد الجلسة القادمة'],
  ['{اسمي}', 'اسمك'],
  ['{مكتبي}', 'اسم مكتبك'],
] as const

export const BUILT_IN_TEMPLATES: readonly MessageTemplate[] = [
  {
    template_id: 'builtin-postpone',
    title: 'طلب تأجيل جلسة',
    builtIn: true,
    body: 'الزميل المحترم الأستاذ {الزميل}،\nتحية طيبة وبعد،\nأرجو التكرم بالموافقة على طلب تأجيل الجلسة المحددة بتاريخ {الجلسة_القادمة} في القضية رقم {رقم_القضية} ({موضوع_القضية}) أمام {المحكمة}، لظرف طارئ، على أن نتفق على موعد يناسبكم.\nمع الاحترام،\n{اسمي} — {مكتبي}',
  },
  {
    template_id: 'builtin-documents',
    title: 'تبادل مستندات',
    builtIn: true,
    body: 'الزميل المحترم الأستاذ {الزميل}،\nتحية طيبة وبعد،\nبالإشارة إلى القضية رقم {رقم_القضية} ({موضوع_القضية}) أمام {المحكمة}، أرجو تزويدنا بنسخة من المستندات والبيّنات التي ستقدّمونها، ونرفق لكم ما لدينا تمهيداً للجلسة القادمة بتاريخ {الجلسة_القادمة}.\nمع الاحترام،\n{اسمي} — {مكتبي}',
  },
  {
    template_id: 'builtin-settlement',
    title: 'عرض تسوية',
    builtIn: true,
    body: 'الزميل المحترم الأستاذ {الزميل}،\nتحية طيبة وبعد،\nفي القضية رقم {رقم_القضية} ({موضوع_القضية})، يرغب موكّلنا في بحث تسوية ودية تنهي النزاع. نقترح اللقاء لمناقشة الشروط قبل الجلسة القادمة بتاريخ {الجلسة_القادمة}، مع حفظ حقوق الطرفين وعدم اعتبار هذا العرض إقراراً بأي واقعة.\nمع الاحترام،\n{اسمي} — {مكتبي}',
  },
]

export const useOfficeTemplates = () =>
  useQuery({
    queryKey: ['colleague-templates'],
    queryFn: async () => (await api.get<{ templates: MessageTemplate[] }>('/colleague-templates')).data.templates,
  })

const useTemplateMutation = <Input,>(run: (input: Input) => Promise<unknown>) => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: run, onSettled: () => void queryClient.invalidateQueries({ queryKey: ['colleague-templates'] }) })
}
export const useSaveTemplate = () =>
  useTemplateMutation(({ templateId, input }: { templateId?: string; input: { title: string; body: string } }) =>
    templateId ? api.patch(`/colleague-templates/${templateId}`, input) : api.post('/colleague-templates', input))
export const useDeleteTemplate = () => useTemplateMutation((templateId: string) => api.delete(`/colleague-templates/${templateId}`))

export type TemplateValues = Partial<Record<(typeof PLACEHOLDERS)[number][0], string | null>>

/** The template with its fields filled; a field with no value stays visible as … so it is noticed. */
export const fillTemplate = (body: string, values: TemplateValues) =>
  PLACEHOLDERS.reduce((text, [key]) => text.replaceAll(key, values[key]?.trim() || '…'), body)

/** Digits for wa.me: a local 05… number becomes 9705…; anything already international is kept. */
export const internationalPhone = (phone: string, countryCode = '970') => {
  const digits = phone.replace(/[^0-9+]/g, '')
  if (digits.startsWith('+')) return digits.slice(1)
  if (digits.startsWith('00')) return digits.slice(2)
  if (digits.startsWith('0')) return countryCode + digits.slice(1)
  return digits
}

export const whatsappUrl = (phone: string, text: string) => `https://wa.me/${internationalPhone(phone)}?text=${encodeURIComponent(text)}`
export const mailtoUrl = (email: string, subject: string, body: string) =>
  `mailto:${email.trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
