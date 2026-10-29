import { describe, expect, it } from 'vitest'
import { scorePassword } from './password-strength'
import {
  accountSchema,
  emptyLawyer,
  emptyOffice,
  lawyerSchema,
  officeSchema,
  toRegistrationInput,
} from './register.schema'

const account = {
  fullName: 'Laila Haddad',
  email: 'laila@office.ps',
  password: 'Justice2026',
  confirmPassword: 'Justice2026',
}

const messageFor = (
  result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } },
  field: string,
) => result.error?.issues.find((issue) => issue.path[0] === field)?.message

describe('accountSchema', () => {
  it('accepts a valid account', () => {
    expect(accountSchema.safeParse(account).success).toBe(true)
  })

  it('requires matching passwords, reported on the confirmation field', () => {
    const result = accountSchema.safeParse({ ...account, confirmPassword: 'Justice2027' })
    expect(messageFor(result, 'confirmPassword')).toBe('validation:passwordMismatch')
  })

  it('requires a letter and a digit in the password', () => {
    expect(
      messageFor(
        accountSchema.safeParse({ ...account, password: '12345678', confirmPassword: '12345678' }),
        'password',
      ),
    ).toBe('validation:passwordLetter')
    expect(
      messageFor(
        accountSchema.safeParse({ ...account, password: 'abcdefgh', confirmPassword: 'abcdefgh' }),
        'password',
      ),
    ).toBe('validation:passwordDigit')
  })

  it('accepts Arabic letters in passwords', () => {
    const password = 'عدالة2026حق'
    expect(
      accountSchema.safeParse({ ...account, password, confirmPassword: password }).success,
    ).toBe(true)
  })
})

describe('officeSchema', () => {
  const office = { ...emptyOffice, name: 'Haddad Law', phone: '+970 59 123 4567', city: 'Nablus' }

  it('accepts required fields with optional ones left blank', () => {
    expect(officeSchema.safeParse(office).success).toBe(true)
  })

  it('rejects phone numbers the backend would refuse', () => {
    expect(officeSchema.safeParse({ ...office, phone: '12345' }).success).toBe(false)
    expect(officeSchema.safeParse({ ...office, phone: '059-abc-123' }).success).toBe(false)
  })

  it('validates the optional office email only when provided', () => {
    expect(officeSchema.safeParse({ ...office, email: 'not-an-email' }).success).toBe(false)
    expect(officeSchema.safeParse({ ...office, email: 'info@office.ps' }).success).toBe(true)
  })
})

describe('lawyerSchema', () => {
  it('requires a bar number and bounds years of experience', () => {
    expect(lawyerSchema.safeParse(emptyLawyer).success).toBe(false)
    expect(
      lawyerSchema.safeParse({ ...emptyLawyer, barNumber: 'PBA-1', yearsExperience: '71' }).success,
    ).toBe(false)
    expect(
      lawyerSchema.safeParse({ ...emptyLawyer, barNumber: 'PBA-1', yearsExperience: '-1' }).success,
    ).toBe(false)
    expect(
      lawyerSchema.safeParse({ ...emptyLawyer, barNumber: 'PBA-1', yearsExperience: '12' }).success,
    ).toBe(true)
  })
})

describe('toRegistrationInput', () => {
  it('maps form values onto the API contract and drops blank optional fields', () => {
    expect(
      toRegistrationInput(
        {
          ...emptyOffice,
          name: ' Haddad Law ',
          phone: '+970 59 123 4567',
          city: 'Nablus',
          licenseNumber: ' ',
        },
        { barNumber: ' PBA-1 ', specialty: '', yearsExperience: '8' },
      ),
    ).toEqual({
      office: {
        name: 'Haddad Law',
        phone: '+970 59 123 4567',
        city: 'Nablus',
        email: undefined,
        address: undefined,
        license_number: undefined,
      },
      lawyer: { bar_number: 'PBA-1', specialty: undefined, years_experience: 8 },
    })
  })
})

describe('scorePassword', () => {
  it('grades length and character variety', () => {
    expect(scorePassword('')).toBe(0)
    expect(scorePassword('abc')).toBe(1)
    expect(scorePassword('abcdefgh')).toBe(1)
    expect(scorePassword('abcdefg1')).toBe(2)
    expect(scorePassword('Abcdefgh12')).toBe(3)
    expect(scorePassword('Abcdefgh12!?')).toBe(4)
  })
})
