import { z } from 'zod'
import { i18nMessage } from '@/lib/i18n-message'
import { EMAIL_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './login.schema'

/** Better Auth's default upper bound. */
export const PASSWORD_MAX_LENGTH = 128
/** Column sizes from backend-development/database/schema.sql. */
const LIMITS = {
  fullName: 150,
  officeName: 200,
  phone: 30,
  city: 100,
  address: 2000,
  licenseNumber: 100,
  barNumber: 50,
  specialty: 100,
} as const
const MAX_YEARS_EXPERIENCE = 70
/** Same rule as the backend: digits plus + ( ) . - and spaces, with at least 6 digits. */
const PHONE_PATTERN = /^[+()\d.\-\s]+$/

const required = (max: number) =>
  z
    .string()
    .trim()
    .min(1, i18nMessage('validation:required'))
    .max(max, i18nMessage('validation:tooLong', { max }))

const optional = (max: number) =>
  z.string().trim().max(max, i18nMessage('validation:tooLong', { max }))

const email = z
  .string()
  .trim()
  .min(1, i18nMessage('validation:required'))
  .max(EMAIL_MAX_LENGTH, i18nMessage('validation:emailTooLong', { max: EMAIL_MAX_LENGTH }))
  .pipe(z.email(i18nMessage('validation:email')))

export const passwordSchema = z
  .string()
  .min(1, i18nMessage('validation:required'))
  .min(PASSWORD_MIN_LENGTH, i18nMessage('validation:passwordMin', { min: PASSWORD_MIN_LENGTH }))
  .max(PASSWORD_MAX_LENGTH, i18nMessage('validation:tooLong', { max: PASSWORD_MAX_LENGTH }))
  .regex(/\p{L}/u, i18nMessage('validation:passwordLetter'))
  .regex(/\d/, i18nMessage('validation:passwordDigit'))

/** Adds the "passwords match" check to any schema with password + confirmPassword. */
export const withPasswordConfirmation = <
  T extends z.ZodType<{ password: string; confirmPassword: string }>,
>(
  schema: T,
) =>
  schema.refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: i18nMessage('validation:passwordMismatch'),
  })

export const accountSchema = withPasswordConfirmation(
  z.object({
    fullName: required(LIMITS.fullName),
    email,
    password: passwordSchema,
    confirmPassword: z.string().min(1, i18nMessage('validation:required')),
  }),
)

export const officeSchema = z.object({
  name: required(LIMITS.officeName),
  phone: required(LIMITS.phone).refine(
    (value) => PHONE_PATTERN.test(value) && (value.match(/\d/g) ?? []).length >= 6,
    i18nMessage('validation:phone'),
  ),
  city: required(LIMITS.city),
  email: z.union([z.literal(''), email]),
  address: optional(LIMITS.address),
  licenseNumber: optional(LIMITS.licenseNumber),
})

export const lawyerSchema = z.object({
  barNumber: required(LIMITS.barNumber),
  specialty: optional(LIMITS.specialty),
  yearsExperience: z
    .string()
    .trim()
    .refine(
      (value) =>
        value === '' ||
        (/^\d+$/.test(value) && Number(value) >= 0 && Number(value) <= MAX_YEARS_EXPERIENCE),
      i18nMessage('validation:yearsRange', { max: MAX_YEARS_EXPERIENCE }),
    ),
})

export const reviewSchema = z.object({
  confirmAccuracy: z.boolean().refine(Boolean, i18nMessage('validation:confirmAccuracy')),
})

export type AccountValues = z.infer<typeof accountSchema>
export type OfficeValues = z.infer<typeof officeSchema>
export type LawyerValues = z.infer<typeof lawyerSchema>
export type ReviewValues = z.infer<typeof reviewSchema>

export const emptyAccount: AccountValues = {
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
}
export const emptyOffice: OfficeValues = {
  name: '',
  phone: '',
  city: '',
  email: '',
  address: '',
  licenseNumber: '',
}
export const emptyLawyer: LawyerValues = { barNumber: '', specialty: '', yearsExperience: '' }

const blankToUndefined = (value: string) => (value.trim() === '' ? undefined : value.trim())

/** Maps the wizard's form values onto the `POST /api/offices` contract. */
export const toRegistrationInput = (office: OfficeValues, lawyer: LawyerValues) => ({
  office: {
    name: office.name.trim(),
    phone: office.phone.trim(),
    city: office.city.trim(),
    email: blankToUndefined(office.email),
    address: blankToUndefined(office.address),
    license_number: blankToUndefined(office.licenseNumber),
  },
  lawyer: {
    bar_number: lawyer.barNumber.trim(),
    specialty: blankToUndefined(lawyer.specialty),
    years_experience:
      lawyer.yearsExperience.trim() === '' ? undefined : Number(lawyer.yearsExperience),
  },
})
