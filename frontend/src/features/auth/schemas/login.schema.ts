import { z } from 'zod'
import { i18nMessage } from '@/lib/i18n-message'

/** app_users.email is varchar(254) in the ERD. */
export const EMAIL_MAX_LENGTH = 254
/** PROVISIONAL minimum — align with the backend password policy. */
export const PASSWORD_MIN_LENGTH = 8

/**
 * Messages are i18n keys (not text) so they re-translate instantly when the
 * language changes, without re-validating the form.
 */
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, i18nMessage('validation:required'))
    .max(EMAIL_MAX_LENGTH, i18nMessage('validation:emailTooLong', { max: EMAIL_MAX_LENGTH }))
    .pipe(z.email(i18nMessage('validation:email'))),
  password: z
    .string()
    .min(1, i18nMessage('validation:required'))
    .min(PASSWORD_MIN_LENGTH, i18nMessage('validation:passwordMin', { min: PASSWORD_MIN_LENGTH })),
  remember: z.boolean(),
})

export type LoginFormValues = z.infer<typeof loginSchema>
