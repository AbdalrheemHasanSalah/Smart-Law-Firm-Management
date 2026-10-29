import { PASSWORD_MIN_LENGTH } from './login.schema'

export type PasswordStrength = 0 | 1 | 2 | 3 | 4

/**
 * A guidance score only (the server enforces the real policy). Rewards length and character
 * variety, and caps very short passwords at "weak" whatever they contain.
 */
export const scorePassword = (password: string): PasswordStrength => {
  if (!password) return 0
  if (password.length < PASSWORD_MIN_LENGTH) return 1
  const variety = [/\p{Ll}/u, /\p{Lu}/u, /\d/, /[^\p{L}\d]/u].filter((pattern) =>
    pattern.test(password),
  ).length
  let score = 1
  if (variety >= 2) score += 1
  if (variety >= 3 && password.length >= 10) score += 1
  if (variety === 4 && password.length >= 12) score += 1
  return score as PasswordStrength
}

export const STRENGTH_LEVELS = ['empty', 'weak', 'fair', 'good', 'strong'] as const
