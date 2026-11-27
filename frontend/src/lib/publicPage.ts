/**
 * The office's public page and its consultation requests: types, wording, API calls and query
 * hooks, free of DOM code so a React Native client can reuse them.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, API_URL } from './api'

export type PageSettings = {
  slug: string
  is_published: boolean
  tagline: string | null
  about: string | null
  practice_areas: string[]
  whatsapp: string | null
  working_hours: string | null
  map_url: string | null
  has_logo: boolean
}

export type PublishedPage = Omit<PageSettings, 'is_published'> & {
  office: { name: string; phone: string | null; email: string | null; city: string | null; address: string | null }
  lawyers: { full_name: string; job_title: string | null }[]
}

export type ConsultationStatus = 'new' | 'contacted' | 'converted' | 'rejected'

export type Consultation = {
  request_id: string
  full_name: string
  phone: string
  email: string | null
  case_type: string | null
  message: string
  preferred_time: string | null
  status: ConsultationStatus
  notes: string | null
  assigned_to_user_id: string | null
  assigned_to_name: string | null
  client_id: string | null
  client_name: string | null
  created_at: string
}

export const CONSULTATION_STATUS: Record<ConsultationStatus, { text: string; tone: 'blue' | 'green' | 'red' | 'ink' }> = {
  new: { text: 'جديد', tone: 'red' },
  contacted: { text: 'تواصلنا معه', tone: 'blue' },
  converted: { text: 'أصبح موكّلاً', tone: 'green' },
  rejected: { text: 'مُستبعَد', tone: 'ink' },
}

/** The page's address on this site. */
export const pagePath = (slug: string) => `/o/${slug}`
export const logoUrl = (slug: string, version = '') => `${API_URL}/public/offices/${slug}/logo${version ? `?v=${encodeURIComponent(version)}` : ''}`

/** A wa.me link for a phone number, digits only. */
export const whatsappLink = (phone: string) => `https://wa.me/${phone.replace(/[^0-9]/g, '')}`

/** A slug suggestion from a Latin office name: lower case, hyphens between words. */
export const suggestSlug = (text: string) =>
  text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

/* ───────────── visitors ───────────── */

export const usePublishedPage = (slug: string) =>
  useQuery({
    queryKey: ['public-page', slug],
    retry: false,
    queryFn: async () => (await api.get<{ page: PublishedPage }>(`/public/offices/${slug}`)).data.page,
  })

export type ConsultationInput = {
  full_name: string
  phone: string
  email?: string
  case_type?: string
  message: string
  preferred_time?: string
  /** Left empty by people; filled by bots that complete every field. */
  website: string
  /** When the form was opened, in milliseconds. */
  opened_at: number
}

export const useSendConsultation = (slug: string) =>
  useMutation({ mutationFn: async (input: ConsultationInput) => (await api.post(`/public/offices/${slug}/consultations`, input)).data })

/* ───────────── the office ───────────── */

export const usePageSettings = () =>
  useQuery({ queryKey: ['page-settings'], queryFn: async () => (await api.get<{ page: PageSettings | null }>('/offices/current/public-page')).data.page })

export const useSavePageSettings = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ settings, logo }: { settings: Omit<PageSettings, 'has_logo'>; logo?: { file: Blob; type: string } | null }) => {
      const { page } = (await api.put<{ page: PageSettings }>('/offices/current/public-page', settings)).data
      let logoError: unknown = null
      if (logo) {
        try {
          await api.put('/offices/current/public-page/logo', logo.file, { headers: { 'Content-Type': logo.type } })
        } catch (error) {
          logoError = error
        }
      }
      return { page, logoError }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['page-settings'] }),
  })
}

export const useConsultations = (status?: ConsultationStatus) =>
  useQuery({
    queryKey: ['consultations', status ?? 'all'],
    queryFn: async () => (await api.get<{ requests: Consultation[] }>('/consultations', { params: status ? { status } : {} })).data.requests,
  })

const useConsultationMutation = <Input, Output>(work: (input: Input) => Promise<Output>) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: work,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['consultations'] })
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
  })
}

export const useUpdateConsultation = () =>
  useConsultationMutation(({ requestId, patch }: { requestId: string; patch: { status?: 'new' | 'contacted' | 'rejected'; notes?: string | null; assigned_to_user_id?: string | null } }) =>
    api.patch(`/consultations/${requestId}`, patch))

export const useConvertConsultation = () =>
  useConsultationMutation(async ({ requestId, clientType }: { requestId: string; clientType: 'individual' | 'organization' }) =>
    (await api.post<{ client: { client_id: string; full_name_or_org: string } }>(`/consultations/${requestId}/convert`, { client_type: clientType })).data.client)
