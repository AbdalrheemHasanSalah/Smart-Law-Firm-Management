import { describe, expect, it } from 'vitest'
import { loginSchema } from './login.schema'

describe('loginSchema', () => {
  it('accepts valid credentials and trims the email', () => {
    const result = loginSchema.parse({
      email: '  lawyer@qadiyati.ps ',
      password: 'Qadiyati@2026',
      remember: true,
    })
    expect(result.email).toBe('lawyer@qadiyati.ps')
  })

  it('returns i18n keys, not hard-coded text', () => {
    const result = loginSchema.safeParse({ email: '', password: '', remember: false })
    expect(result.success).toBe(false)
    const messages = result.error?.issues.map((issue) => issue.message)
    expect(messages).toContain('validation:required')
  })

  it('rejects malformed emails and short passwords', () => {
    const result = loginSchema.safeParse({
      email: 'not-an-email',
      password: 'short',
      remember: false,
    })
    const messages = result.error?.issues.map((issue) => issue.message) ?? []
    expect(messages).toContain('validation:email')
    expect(messages.some((message) => message.startsWith('validation:passwordMin'))).toBe(true)
  })
})
