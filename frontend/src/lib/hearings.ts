/**
 * A case's session log and hearing outcomes: types, wording, API calls and query hooks.
 * Free of DOM code so a React Native client can reuse it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export type HearingStatus = 'scheduled' | 'completed' | 'postponed' | 'cancelled'
export type HearingOutcomeStatus = Exclude<HearingStatus, 'scheduled'>

export type HearingLogEntry = {
  hearing_id: string
  hearing_at: string
  hearing_type: string
  court_room: string | null
  court_name: string | null
  status: HearingStatus
  outcome: string | null
  notes: string | null
  postponement_reason: string | null
  next_hearing_id: string | null
  next_hearing_at: string | null
  attended_by_user_id: string | null
  attended_by_name: string | null
  outcome_recorded_at: string | null
  outcome_recorded_by_name: string | null
  case_id: string
}

export type HearingOutcomeInput = {
  status: HearingOutcomeStatus
  outcome?: string | null
  attended_by_user_id?: string | null
  postponed_to?: string | null
  postponement_reason?: string | null
  next_court_room?: string | null
}

export const HEARING_STATUS: Record<HearingStatus, { text: string; tone: 'blue' | 'green' | 'ink' | 'red' }> = {
  scheduled: { text: 'مجدولة', tone: 'blue' },
  completed: { text: 'انعقدت', tone: 'green' },
  postponed: { text: 'أُجّلت', tone: 'ink' },
  cancelled: { text: 'أُلغيت', tone: 'red' },
}

export const OUTCOME_CHOICES: readonly (readonly [HearingOutcomeStatus, string])[] = [
  ['completed', 'انعقدت'],
  ['postponed', 'أُجّلت'],
  ['cancelled', 'أُلغيت'],
]

/** A hearing whose outcome can still be recorded: not yet linked to a next session. */
export const canRecordOutcome = (hearing: HearingLogEntry) => !hearing.next_hearing_id

export const fetchCaseHearings = async (caseId: string) =>
  (await api.get<{ hearings: HearingLogEntry[] }>('/hearings', { params: { caseId } })).data.hearings

export const recordHearingOutcome = async (hearingId: string, input: HearingOutcomeInput) =>
  (await api.post<{ hearing: { hearing_id: string; next_hearing_id: string | null } }>(`/hearings/${hearingId}/outcome`, input)).data.hearing

export const useCaseHearings = (caseId: string) =>
  useQuery({ queryKey: ['hearings', caseId], queryFn: () => fetchCaseHearings(caseId) })

export const useRecordOutcome = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ hearingId, input }: { hearingId: string; input: HearingOutcomeInput }) => recordHearingOutcome(hearingId, input),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['hearings'] })
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
    },
  })
}
