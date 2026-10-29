import { isAxiosError } from 'axios'

/** Normalised error codes. The UI translates them via `errors.<code>` in the locale files. */
export type ApiErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_INACTIVE'
  | 'EMAIL_TAKEN'
  | 'RATE_LIMITED'
  | 'NO_ACTIVE_OFFICE'
  | 'OFFICE_PENDING'
  | 'OFFICE_INACTIVE'
  | 'MEMBERSHIP_SUSPENDED'
  | 'REGISTRATION_PENDING'
  | 'BAR_NUMBER_TAKEN'
  | 'BAR_NUMBER_MISMATCH'
  | 'INVITATION_INVALID'
  | 'INVITATION_EMAIL_MISMATCH'
  | 'ALREADY_MEMBER'
  | 'RESET_TOKEN_INVALID'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'SERVER'
  | 'UNKNOWN'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number | null
  readonly details: unknown

  constructor(
    code: ApiErrorCode,
    options: { status?: number | null; message?: string; details?: unknown } = {},
  ) {
    super(options.message ?? code)
    this.name = 'ApiError'
    this.code = code
    this.status = options.status ?? null
    this.details = options.details
  }
}

const codeFromStatus = (status: number): ApiErrorCode => {
  if (status === 400 || status === 422) return 'VALIDATION'
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'SERVER'
  return 'UNKNOWN'
}

const KNOWN_CODES: readonly ApiErrorCode[] = [
  'INVALID_CREDENTIALS',
  'ACCOUNT_INACTIVE',
  'EMAIL_TAKEN',
  'RATE_LIMITED',
  'NO_ACTIVE_OFFICE',
  'OFFICE_PENDING',
  'OFFICE_INACTIVE',
  'MEMBERSHIP_SUSPENDED',
  'REGISTRATION_PENDING',
  'BAR_NUMBER_TAKEN',
  'BAR_NUMBER_MISMATCH',
  'INVITATION_INVALID',
  'INVITATION_EMAIL_MISMATCH',
  'ALREADY_MEMBER',
  'RESET_TOKEN_INVALID',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'NETWORK',
  'TIMEOUT',
  'SERVER',
  'UNKNOWN',
]

/** Better Auth reports its own codes; they are folded into the app's vocabulary here. */
const BETTER_AUTH_CODES: Record<string, ApiErrorCode> = {
  INVALID_EMAIL_OR_PASSWORD: 'INVALID_CREDENTIALS',
  INVALID_PASSWORD: 'INVALID_CREDENTIALS',
  USER_ALREADY_EXISTS: 'EMAIL_TAKEN',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'EMAIL_TAKEN',
  INVALID_TOKEN: 'RESET_TOKEN_INVALID',
  PASSWORD_TOO_SHORT: 'VALIDATION',
  PASSWORD_TOO_LONG: 'VALIDATION',
  INVALID_EMAIL: 'VALIDATION',
}

const isKnownCode = (value: unknown): value is ApiErrorCode =>
  typeof value === 'string' && (KNOWN_CODES as readonly string[]).includes(value)

export const normalizeCode = (bodyCode: unknown, status: number): ApiErrorCode => {
  if (isKnownCode(bodyCode)) return bodyCode
  if (typeof bodyCode === 'string' && bodyCode in BETTER_AUTH_CODES) {
    return BETTER_AUTH_CODES[bodyCode] ?? codeFromStatus(status)
  }
  return codeFromStatus(status)
}

/**
 * Converts anything thrown by Axios (or elsewhere) into an ApiError. The backend sends
 * `{ code, error }` and Better Auth sends `{ code, message }`; only the code is used, so no
 * server-side wording or internal detail is ever shown to the user.
 */
export const toApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error
  if (isAxiosError(error)) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return new ApiError('TIMEOUT')
    if (!error.response) return new ApiError('NETWORK')
    const { status, data } = error.response
    const bodyCode: unknown =
      typeof data === 'object' && data !== null ? (data as { code?: unknown }).code : undefined
    return new ApiError(normalizeCode(bodyCode, status), { status, details: data })
  }
  return new ApiError('UNKNOWN', { message: error instanceof Error ? error.message : undefined })
}
