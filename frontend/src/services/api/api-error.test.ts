import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import { normalizeCode, toApiError } from './api-error'

const httpError = (status: number, data: unknown) =>
  new AxiosError('failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
    status,
    data,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
  })

describe('normalizeCode', () => {
  it('keeps the backend application codes', () => {
    expect(normalizeCode('NO_ACTIVE_OFFICE', 403)).toBe('NO_ACTIVE_OFFICE')
    expect(normalizeCode('INVITATION_EMAIL_MISMATCH', 403)).toBe('INVITATION_EMAIL_MISMATCH')
  })

  it('maps Better Auth codes onto the app vocabulary', () => {
    expect(normalizeCode('INVALID_EMAIL_OR_PASSWORD', 401)).toBe('INVALID_CREDENTIALS')
    expect(normalizeCode('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 422)).toBe('EMAIL_TAKEN')
    expect(normalizeCode('INVALID_TOKEN', 400)).toBe('RESET_TOKEN_INVALID')
  })

  it('falls back to the HTTP status for unknown codes', () => {
    expect(normalizeCode('SOMETHING_NEW', 429)).toBe('RATE_LIMITED')
    expect(normalizeCode(undefined, 500)).toBe('SERVER')
  })
})

describe('toApiError', () => {
  it('never carries server wording into the code', () => {
    const error = toApiError(
      httpError(403, { code: 'ACCOUNT_INACTIVE', message: 'internal detail' }),
    )
    expect(error.code).toBe('ACCOUNT_INACTIVE')
    expect(error.status).toBe(403)
  })

  it('reports a missing response as a network failure', () => {
    expect(toApiError(new AxiosError('offline', 'ERR_NETWORK')).code).toBe('NETWORK')
  })
})
