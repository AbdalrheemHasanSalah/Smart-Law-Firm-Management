/**
 * Drafting (الصياغة): templates and the drafts written on a case. Types, wording, API and hooks,
 * free of DOM code so a React Native client can reuse them.
 *
 * A draft is edited by the case team until it is finalized; then it is frozen, carries a
 * verification code, and stays with the case. Only the office admin revokes a final document.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export type DraftKind = 'contract' | 'pleading' | 'letter' | 'other'
export type DraftStatus = 'draft' | 'final' | 'revoked'
export type DraftSource = 'builtin' | 'template' | 'ai' | 'blank'

export type Template = { key?: string; template_id?: string; kind: DraftKind; title: string; body: string; builtin: boolean; updated_at?: string }

export type Draft = {
  draft_id: string
  case_id: string
  kind: DraftKind
  title: string
  body?: string
  source: DraftSource
  source_ref: string | null
  status: DraftStatus
  finalized_at: string | null
  revoked_at: string | null
  created_at: string
  updated_at: string
  created_by: { user_id: string; full_name: string }
  finalized_by: { user_id: string; full_name: string } | null
  verification_code: string | null
  fingerprint: string | null
}

export const DRAFT_KIND: Record<DraftKind, string> = { contract: 'عقد', pleading: 'لائحة', letter: 'كتاب', other: 'مستند' }

export const DRAFT_STATUS: Record<DraftStatus, { text: string; tone: 'blue' | 'green' | 'red' }> = {
  draft: { text: 'مسودة', tone: 'blue' },
  final: { text: 'معتمد', tone: 'green' },
  revoked: { text: 'مسحوب', tone: 'red' },
}

export const DRAFT_SOURCE: Record<DraftSource, string> = {
  builtin: 'من هيكل جاهز',
  template: 'من نموذج المكتب',
  ai: 'صاغه الذكاء الاصطناعي',
  blank: 'صفحة فارغة',
}

/** The fields a template can use, with their Arabic names, for the template editor's help. */
export const TEMPLATE_FIELDS: [field: string, label: string][] = [
  ['client_name', 'اسم الموكّل'],
  ['client_national_id', 'رقم هوية الموكّل'],
  ['client_address', 'عنوان الموكّل'],
  ['client_phone', 'هاتف الموكّل'],
  ['opponent_name', 'اسم الخصم'],
  ['opponent_national_id', 'رقم هوية الخصم'],
  ['case_number', 'رقم القضية'],
  ['case_title', 'عنوان القضية'],
  ['court_name', 'المحكمة'],
  ['office_name', 'اسم المكتب'],
  ['lawyer_name', 'اسم المحامي'],
  ['today', 'تاريخ اليوم'],
]

/** Gaps the lawyer still has to fill: […] and anything else in square brackets. */
export const openGaps = (body: string) => (body.match(/\[[^\]\n]{0,80}\]/g) ?? []).length

export const MAX_DESCRIPTION = 4000

/* ───────────── API and hooks ───────────── */

const draftsKey = (caseId: string) => ['drafts', caseId]

export const useTemplates = () =>
  useQuery({
    queryKey: ['templates'],
    queryFn: async () => (await api.get<{ builtin: Template[]; templates: Template[] }>('/templates')).data,
    staleTime: 60_000,
  })

export const useSaveTemplate = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ templateId, ...input }: { templateId?: string; kind: DraftKind; title: string; body: string }) =>
      templateId ? api.patch(`/templates/${templateId}`, input) : api.post('/templates', input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export const useArchiveTemplate = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (templateId: string) => api.delete(`/templates/${templateId}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export const useDrafts = (caseId: string) =>
  useQuery({ queryKey: draftsKey(caseId), queryFn: async () => (await api.get<{ drafts: Draft[] }>(`/cases/${caseId}/drafts`)).data.drafts })

export const useDraft = (caseId: string, draftId: string | null) =>
  useQuery({
    queryKey: [...draftsKey(caseId), draftId],
    enabled: draftId !== null,
    queryFn: async () => (await api.get<{ draft: Draft }>(`/cases/${caseId}/drafts/${draftId}`)).data.draft,
  })

const useDraftMutation = <Input,>(caseId: string, run: (input: Input) => Promise<Draft>) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: (draft) => queryClient.setQueryData([...draftsKey(caseId), draft.draft_id], draft),
    onSettled: () => queryClient.invalidateQueries({ queryKey: draftsKey(caseId) }),
  })
}

export const useCreateDraft = (caseId: string) =>
  useDraftMutation(caseId, async (input: { template_key?: string; template_id?: string; kind?: DraftKind; title?: string }) =>
    (await api.post<{ draft: Draft }>(`/cases/${caseId}/drafts`, input)).data.draft)

export const useGenerateDraft = (caseId: string) =>
  useDraftMutation(caseId, async (input: { kind: DraftKind; description: string }) =>
    (await api.post<{ draft: Draft }>(`/cases/${caseId}/drafts/generate`, input, { timeout: 180_000 })).data.draft)

export const useUpdateDraft = (caseId: string) =>
  useDraftMutation(caseId, async ({ draftId, ...input }: { draftId: string; title?: string; body?: string; kind?: DraftKind }) =>
    (await api.patch<{ draft: Draft }>(`/cases/${caseId}/drafts/${draftId}`, input)).data.draft)

export const useFinalizeDraft = (caseId: string) =>
  useDraftMutation(caseId, async (draftId: string) => (await api.post<{ draft: Draft }>(`/cases/${caseId}/drafts/${draftId}/finalize`)).data.draft)

export const useRevokeDraft = (caseId: string) =>
  useDraftMutation(caseId, async (draftId: string) => (await api.post<{ draft: Draft }>(`/cases/${caseId}/drafts/${draftId}/revoke`)).data.draft)

export const useDeleteDraft = (caseId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (draftId: string) => api.delete(`/cases/${caseId}/drafts/${draftId}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: draftsKey(caseId) }),
  })
}
