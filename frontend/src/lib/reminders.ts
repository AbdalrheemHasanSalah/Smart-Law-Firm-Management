/**
 * The signed-in person's reminder settings, kept on the server: whether hearing, task,
 * appointment and power-of-attorney reminders also come by email. In-app reminders always come.
 * Free of DOM code so a React Native client can reuse it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export type Preferences = { email_reminders: boolean }

const KEY = ['me', 'preferences']

export const fetchPreferences = async () => (await api.get<{ preferences: Preferences }>('/me/preferences')).data.preferences

export const savePreferences = async (preferences: Preferences) =>
  (await api.patch<{ preferences: Preferences }>('/me/preferences', preferences)).data.preferences

export const usePreferences = (enabled = true) => useQuery({ queryKey: KEY, enabled, queryFn: fetchPreferences })

export const useSavePreferences = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: savePreferences,
    onSuccess: (saved) => queryClient.setQueryData(KEY, saved),
  })
}
