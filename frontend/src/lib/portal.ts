/**
 * What a client sees in their portal (upcoming hearings, documents shared with them) and how the
 * office shares a document. Free of DOM code so a React Native client can reuse it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, API_URL } from './api'
import type { DocumentRecord } from './types'

export type UpcomingHearing = {
  hearing_id: string
  hearing_at: string
  hearing_type: string
  court_room: string | null
  court_name: string | null
  case_id: string
  case_number: string
  case_title: string
}

export const documentDownloadUrl = (documentId: string) => `${API_URL}/documents/${documentId}/download`

/** Whole days from today to `at` (0 today, 1 tomorrow). */
export const daysUntil = (at: string) => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const day = new Date(at)
  day.setHours(0, 0, 0, 0)
  return Math.round((day.getTime() - start.getTime()) / 86_400_000)
}

export const useMyHearings = () =>
  useQuery({ queryKey: ['hearings', 'mine'], queryFn: async () => (await api.get<{ hearings: UpcomingHearing[] }>('/hearings/mine')).data.hearings })

/** For a client, the documents the office shared with them. */
export const useSharedDocuments = () =>
  useQuery({
    queryKey: ['documents', 'shared'],
    queryFn: async () => (await api.get<{ documents: DocumentRecord[] }>('/documents', { params: { pageSize: 50 } })).data.documents,
  })

export const useShareDocument = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId, clientId }: { documentId: string; clientId: string | null }) =>
      api.post(`/documents/${documentId}/sharing`, clientId ? { shared: true, client_id: clientId } : { shared: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  })
}
