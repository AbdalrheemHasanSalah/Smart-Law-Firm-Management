/**
 * Court notices (أوراق المحضرين): types, wording, API calls and query hooks.
 * Free of DOM code so a React Native client can reuse it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, API_URL } from './api'

export type NoticeType = 'notification' | 'summons' | 'judgment_service' | 'execution'
export type DeliveryStatus = 'pending' | 'delivered' | 'returned' | 'refused'

export type CourtNotice = {
  notice_id: string
  notice_type: NoticeType
  recipient: string | null
  bailiff_office: string | null
  sent_on: string
  delivery_status: DeliveryStatus
  delivered_on: string | null
  notes: string | null
  has_attachment: boolean
  case_id: string
  case_number: string
  case_title: string
  created_by_name: string
  created_at: string
  updated_at: string
}

export type CourtNoticeInput = {
  case_id: string
  notice_type: NoticeType
  recipient: string | null
  bailiff_office: string | null
  sent_on: string
  delivery_status: DeliveryStatus
  delivered_on: string | null
  notes: string | null
}

export const NOTICE_TYPE: Record<NoticeType, string> = {
  notification: 'تبليغ',
  summons: 'مذكرة حضور',
  judgment_service: 'تبليغ حكم',
  execution: 'ورقة تنفيذ',
}

export const DELIVERY_STATUS: Record<DeliveryStatus, { text: string; tone: 'blue' | 'green' | 'ink' | 'red' }> = {
  pending: { text: 'بانتظار التبليغ', tone: 'blue' },
  delivered: { text: 'بُلِّغ', tone: 'green' },
  returned: { text: 'أُعيد دون تبليغ', tone: 'ink' },
  refused: { text: 'رُفض الاستلام', tone: 'red' },
}

/** The label of the date that closes a notice, by its delivery status. */
export const closingDateLabel = (status: DeliveryStatus) =>
  status === 'delivered' ? 'تاريخ التبليغ' : status === 'returned' ? 'تاريخ الإعادة' : status === 'refused' ? 'تاريخ الرفض' : null

export const ATTACHMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const attachmentUrl = (noticeId: string) => `${API_URL}/court-notices/${noticeId}/attachment`

export const fetchCourtNotices = async (params: { caseId?: string; status?: DeliveryStatus } = {}) => {
  const clean = Object.fromEntries(Object.entries(params).filter(([, value]) => value))
  return (await api.get<{ court_notices: CourtNotice[] }>('/court-notices', { params: { pageSize: 50, ...clean } })).data.court_notices
}

export const createCourtNotice = async (input: CourtNoticeInput) =>
  (await api.post<{ court_notice: CourtNotice }>('/court-notices', input)).data.court_notice

export const updateCourtNotice = async (noticeId: string, patch: Partial<Omit<CourtNoticeInput, 'case_id'>>) =>
  (await api.patch<{ court_notice: CourtNotice }>(`/court-notices/${noticeId}`, patch)).data.court_notice

export const uploadNoticeAttachment = async (noticeId: string, file: Blob, type: string) =>
  (await api.put<{ notice_id: string; has_attachment: boolean }>(`/court-notices/${noticeId}/attachment`, file, { headers: { 'Content-Type': type } })).data

const KEY = 'court-notices'

export const useCourtNotices = (params: { caseId?: string; status?: DeliveryStatus } = {}) =>
  useQuery({ queryKey: [KEY, params], queryFn: () => fetchCourtNotices(params) })

/** Saves a notice (new or edited) and, when given, its attachment; the record is kept if only the upload fails. */
export const useSaveCourtNotice = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ noticeId, input, file }: { noticeId?: string; input: CourtNoticeInput; file?: { blob: Blob; type: string } | null }) => {
      const { case_id: _case, ...patch } = input
      const saved = noticeId ? await updateCourtNotice(noticeId, patch) : await createCourtNotice(input)
      let uploadError: unknown = null
      if (file) {
        try {
          await uploadNoticeAttachment(saved.notice_id, file.blob, file.type)
        } catch (error) {
          uploadError = error
        }
      }
      return { saved, uploadError }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: [KEY] })
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
    },
  })
}
