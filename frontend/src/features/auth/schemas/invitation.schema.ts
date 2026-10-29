import { z } from 'zod'
import { i18nMessage } from '@/lib/i18n-message'
import { lawyerSchema } from './register.schema'

/** On acceptance a lawyer may add licence details; they are optional (the office already vetted them). */
export const acceptLawyerSchema = lawyerSchema.extend({
  barNumber: z
    .string()
    .trim()
    .max(50, i18nMessage('validation:tooLong', { max: 50 })),
})

export type AcceptLawyerValues = z.infer<typeof acceptLawyerSchema>

export const toAcceptInput = (values: AcceptLawyerValues | null) => {
  if (!values || values.barNumber.trim() === '') return {}
  return {
    bar_number: values.barNumber.trim(),
    specialty: values.specialty.trim() || undefined,
    years_experience:
      values.yearsExperience.trim() === '' ? undefined : Number(values.yearsExperience),
  }
}
