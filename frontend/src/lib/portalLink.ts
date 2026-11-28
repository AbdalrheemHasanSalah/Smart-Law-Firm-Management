/**
 * The link between client and office (phase 5): files the client sends, chat attachments,
 * official notices, and push notifications on this device. Types, wording, API and hooks; the
 * browser's push subscription sits behind one adapter (`browserPush`) for the React Native port.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, API_URL, DEMO } from './api'

/* ───────────── files ───────────── */

export type SharedFile = {
  file_id: string
  purpose: 'portal' | 'message'
  file_name: string
  mime_type: 'application/pdf' | 'image/png' | 'image/jpeg'
  size_bytes: number
  note: string | null
  status: 'new' | 'moved' | 'dismissed'
  case_id: string | null
  case_number: string | null
  client_id: string | null
  client_name: string | null
  moved_document_id: string | null
  handled_at: string | null
  created_at: string
  uploaded_by: { user_id: string; full_name: string }
}

export type Attachment = { file_id: string; file_name: string; mime_type: SharedFile['mime_type']; size_bytes: number; status: SharedFile['status'] }

export const FILE_STATUS: Record<SharedFile['status'], { text: string; tone: 'blue' | 'green' | 'ink' }> = {
  new: { text: 'بانتظار المكتب', tone: 'blue' },
  moved: { text: 'أُضيف إلى مستندات القضية', tone: 'green' },
  dismissed: { text: 'استبعده المكتب', tone: 'ink' },
}

export const FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const
export const MAX_FILE_BYTES = 10 * 1024 * 1024

export const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`)

/** Demo mode keeps uploaded files in this page. */
const demoFiles = new Map<string, string>()
export const sharedFileUrl = (fileId: string) => (DEMO ? demoFiles.get(fileId) ?? '' : `${API_URL}/shared-files/${fileId}`)

export const checkFile = (file: File) =>
  !(FILE_TYPES as readonly string[]).includes(file.type) ? 'الملف يجب أن يكون صورة (JPG أو PNG) أو PDF.' : file.size > MAX_FILE_BYTES ? 'الملف أكبر من 10 ميغابايت.' : null

/** Uploads a file: to the office for a case (portal), or as a chat attachment (message). */
export const uploadSharedFile = async (file: File, purpose: 'portal' | 'message', extra: { caseId?: string; note?: string } = {}) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'X-Purpose': purpose,
    'X-File-Name': encodeURIComponent(file.name.slice(0, 180)),
    ...(extra.caseId ? { 'X-Case-Id': extra.caseId } : {}),
    ...(extra.note ? { 'X-Note': encodeURIComponent(extra.note.slice(0, 1000)) } : {}),
  }
  const { data } = await api.post<{ file: SharedFile }>('/shared-files', file, { headers, timeout: 120_000 })
  if (DEMO) demoFiles.set(data.file.file_id, URL.createObjectURL(file))
  return data.file
}

export const useMyFiles = (enabled = true) =>
  useQuery({ queryKey: ['shared-files', 'mine'], enabled, queryFn: async () => (await api.get<{ files: SharedFile[] }>('/shared-files/mine')).data.files })

export const useSendToOffice = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ file, caseId, note }: { file: File; caseId: string; note?: string }) => uploadSharedFile(file, 'portal', { caseId, note }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['shared-files'] }),
  })
}

export const useIncomingFiles = (caseId: string) =>
  useQuery({ queryKey: ['shared-files', 'case', caseId], queryFn: async () => (await api.get<{ files: SharedFile[] }>(`/cases/${caseId}/incoming-files`)).data.files })

export const useHandleFile = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ fileId, action, caseId }: { fileId: string; action: 'move' | 'dismiss'; caseId?: string }) =>
      action === 'move' ? api.post(`/shared-files/${fileId}/move`, caseId ? { case_id: caseId } : {}) : api.post(`/shared-files/${fileId}/dismiss`),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['shared-files'] })
      void queryClient.invalidateQueries({ queryKey: ['documents'] })
      void queryClient.invalidateQueries({ queryKey: ['messages'] })
    },
  })
}

/* ───────────── official notices ───────────── */

export type NoticeKind = 'hearing' | 'judgment' | 'other'
export type Delivery = { channel: 'portal' | 'push' | 'email' | 'whatsapp'; status: 'prepared' | 'sent' | 'failed' | 'skipped'; detail: string | null; recorded_at: string }

export type Notice = {
  notice_id: string
  case_id: string
  case_number: string
  case_title: string
  kind: NoticeKind
  title: string
  body: string
  sent_at: string
  acknowledged_at: string | null
  sent_by: { user_id: string; full_name: string }
  /** Staff only. */
  client_id?: string
  client_name?: string
  deliveries?: Delivery[]
  whatsapp_url?: string | null
}

export const NOTICE_KIND: Record<NoticeKind, string> = { hearing: 'موعد جلسة', judgment: 'صدور حكم', other: 'إشعار آخر' }
export const CHANNEL: Record<Delivery['channel'], string> = { portal: 'البوابة', push: 'إشعار الجهاز', email: 'البريد', whatsapp: 'واتساب' }
export const DELIVERY_STATUS: Record<Delivery['status'], { text: string; tone: 'green' | 'blue' | 'red' | 'ink' }> = {
  sent: { text: 'أُرسل', tone: 'green' },
  prepared: { text: 'جاهز للإرسال', tone: 'blue' },
  failed: { text: 'فشل', tone: 'red' },
  skipped: { text: 'غير متاح', tone: 'ink' },
}

/** The latest outcome of each channel, in a fixed order. */
export const latestDeliveries = (deliveries: Delivery[] = []) =>
  (['portal', 'push', 'email', 'whatsapp'] as const).flatMap((channel) => {
    const last = deliveries.filter((entry) => entry.channel === channel).at(-1)
    return last ? [last] : []
  })

export const useCaseNotices = (caseId: string) =>
  useQuery({ queryKey: ['notices', caseId], queryFn: async () => (await api.get<{ notices: Notice[] }>(`/cases/${caseId}/notices`)).data.notices })

export const fetchNoticeDraft = async (caseId: string, params: { kind: NoticeKind; clientId?: string; hearingId?: string }) =>
  (await api.get<{ draft: { title: string; body: string } }>(`/cases/${caseId}/notices/draft`, { params })).data.draft

export const useSendNotice = (caseId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { client_id: string; kind: NoticeKind; hearing_id?: string; title: string; body: string }) =>
      (await api.post<{ notice: Notice }>(`/cases/${caseId}/notices`, input)).data.notice,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notices', caseId] }),
  })
}

export const useRecordWhatsApp = (caseId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (noticeId: string) => api.post(`/cases/${caseId}/notices/${noticeId}/whatsapp-sent`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notices', caseId] }),
  })
}

export const useMyNotices = (enabled = true) =>
  useQuery({ queryKey: ['notices', 'mine'], enabled, queryFn: async () => (await api.get<{ notices: Notice[] }>('/notices/mine')).data.notices })

export const useAcknowledge = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (noticeId: string) => api.post(`/notices/${noticeId}/acknowledge`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notices', 'mine'] }),
  })
}

/* ───────────── push on this device (web adapter) ───────────── */

export type PushState = 'unsupported' | 'off-server' | 'denied' | 'off' | 'on'

const urlBase64ToBytes = (base64: string) => {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

export const browserPush = {
  supported: () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  registration: () => navigator.serviceWorker.register('/sw.js'),
  async current() {
    if (!browserPush.supported()) return null
    const registration = await navigator.serviceWorker.getRegistration('/sw.js')
    return registration ? registration.pushManager.getSubscription() : null
  },
}

/** Where push stands on this device for the signed-in person. */
export const usePushState = () =>
  useQuery({
    queryKey: ['push', 'state'],
    queryFn: async (): Promise<{ state: PushState; publicKey: string | null }> => {
      if (DEMO || !browserPush.supported()) return { state: 'unsupported', publicKey: null }
      const settings = (await api.get<{ enabled: boolean; public_key: string | null }>('/push/settings')).data
      if (!settings.enabled || !settings.public_key) return { state: 'off-server', publicKey: null }
      if (Notification.permission === 'denied') return { state: 'denied', publicKey: settings.public_key }
      return { state: (await browserPush.current()) ? 'on' : 'off', publicKey: settings.public_key }
    },
  })

export const useTogglePush = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ enable, publicKey }: { enable: boolean; publicKey: string | null }) => {
      if (!enable) {
        const subscription = await browserPush.current()
        if (subscription) {
          await api.delete('/push/subscriptions', { data: { endpoint: subscription.endpoint } })
          await subscription.unsubscribe()
        }
        return
      }
      if (!publicKey) throw new Error('push-off')
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('push-denied')
      const registration = await browserPush.registration()
      await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(publicKey) })
      await api.post('/push/subscriptions', subscription.toJSON())
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['push'] }),
  })
}
