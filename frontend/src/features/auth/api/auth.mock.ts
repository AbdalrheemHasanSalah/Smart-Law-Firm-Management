import { delay } from '@/lib/utils'
import { STORAGE_KEYS, storage } from '@/lib/storage'
import {
  mockAccounts,
  mockInvitations,
  mockOffices,
  type MockAccount,
  type MockOffice,
} from '@/mocks/data/users'
import { ApiError } from '@/services/api/api-error'
import type { AuthService, AuthSession, Membership, OnboardingService } from '../types'

const MOCK_LATENCY_MS = 700

/**
 * DEMO ONLY. An in-browser imitation of the multi-tenant backend so the UI can be built and
 * demonstrated without a server. It provides NO security whatsoever: the real credential checks,
 * office isolation and session cookies live in the backend. The "session" stored here holds no
 * secret — only which demo account is signed in, mimicking the browser's session cookie.
 */
type MockSession = { email: string; active_office_id: string | null }
type MockState = {
  accounts: MockAccount[]
  offices: MockOffice[]
  usedInvitations: string[]
}

const initialState = (): MockState => ({
  accounts: structuredClone(mockAccounts),
  offices: structuredClone(mockOffices),
  usedInvitations: [],
})

const readJson = <T>(key: string, kind: 'local' | 'session'): T | null => {
  try {
    const raw = storage.get(key, kind)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

let state: MockState = readJson<MockState>(STORAGE_KEYS.mockState, 'session') ?? initialState()
const saveState = () => storage.set(STORAGE_KEYS.mockState, JSON.stringify(state), 'session')

const readSession = () =>
  readJson<MockSession>(STORAGE_KEYS.mockSession, 'session') ??
  readJson<MockSession>(STORAGE_KEYS.mockSession, 'local')

/** "Remember me" keeps the demo session across restarts, like a persistent cookie. */
const writeSession = (session: MockSession | null, remember?: boolean) => {
  const keptKind = storage.get(STORAGE_KEYS.mockSession, 'local') ? 'local' : 'session'
  const kind = remember === undefined ? keptKind : remember ? 'local' : 'session'
  storage.remove(STORAGE_KEYS.mockSession, 'local')
  storage.remove(STORAGE_KEYS.mockSession, 'session')
  if (session) storage.set(STORAGE_KEYS.mockSession, JSON.stringify(session), kind)
}

const findAccount = (email: string) =>
  state.accounts.find((account) => account.user.email.toLowerCase() === email.trim().toLowerCase())

const toMembership = (entry: MockAccount['memberships'][number]): Membership | null => {
  const office = state.offices.find((candidate) => candidate.office_id === entry.office_id)
  return office ? { ...entry, ...office } : null
}

const requireAccount = () => {
  const session = readSession()
  const account = session && findAccount(session.email)
  if (!session || !account) throw new ApiError('UNAUTHORIZED', { status: 401 })
  return { session, account }
}

const isUsable = (membership: Membership) =>
  membership.office_status === 'active' && membership.membership_status === 'active'

export const resetMockAuth = () => {
  state = initialState()
  saveState()
  writeSession(null)
}

export const mockAuthService: AuthService = {
  async getSession() {
    await delay(150)
    const session = readSession()
    const account = session && findAccount(session.email)
    if (!session || !account) return null
    const memberships = account.memberships
      .map(toMembership)
      .filter((membership): membership is Membership => membership !== null)
    const active =
      memberships.find(
        (membership) => membership.office_id === session.active_office_id && isUsable(membership),
      ) ?? null
    const result: AuthSession = {
      user: account.user,
      role: active?.role ?? null,
      active_office: active,
      memberships,
    }
    return result
  },
  async login({ email, password, remember }) {
    await delay(MOCK_LATENCY_MS)
    const account = findAccount(email)
    if (!account || account.password !== password) {
      throw new ApiError('INVALID_CREDENTIALS', { status: 401 })
    }
    if (account.user.status !== 'active') throw new ApiError('ACCOUNT_INACTIVE', { status: 403 })
    writeSession({ email: account.user.email, active_office_id: null }, remember)
  },
  async signUp({ name, email, password }) {
    await delay(MOCK_LATENCY_MS)
    if (findAccount(email)) throw new ApiError('EMAIL_TAKEN', { status: 422 })
    const now = new Date().toISOString()
    state.accounts.push({
      user: {
        user_id: crypto.randomUUID(),
        full_name: name.trim(),
        email: email.trim().toLowerCase(),
        email_verified: false,
        status: 'active',
        is_platform_admin: false,
        created_at: now,
        updated_at: now,
      },
      password,
      memberships: [],
    })
    saveState()
    writeSession({ email: email.trim().toLowerCase(), active_office_id: null }, false)
  },
  async logout() {
    await delay(200)
    writeSession(null)
  },
  async selectOffice(officeId) {
    await delay(300)
    const { session, account } = requireAccount()
    const entry = account.memberships.find((membership) => membership.office_id === officeId)
    const membership = entry && toMembership(entry)
    if (!membership) throw new ApiError('NOT_FOUND', { status: 404 })
    if (membership.membership_status !== 'active') {
      throw new ApiError('MEMBERSHIP_SUSPENDED', { status: 403 })
    }
    if (membership.office_status === 'pending')
      throw new ApiError('OFFICE_PENDING', { status: 403 })
    if (membership.office_status !== 'active')
      throw new ApiError('OFFICE_INACTIVE', { status: 403 })
    writeSession({ ...session, active_office_id: officeId })
  },
  async requestPasswordReset() {
    // Mirrors the backend: the same answer whether or not the address exists.
    await delay(MOCK_LATENCY_MS)
  },
  async resetPassword(token) {
    await delay(MOCK_LATENCY_MS)
    if (!token.startsWith('demo-')) throw new ApiError('RESET_TOKEN_INVALID', { status: 400 })
  },
}

export const mockOnboardingService: OnboardingService = {
  async registerOffice({ office }) {
    await delay(MOCK_LATENCY_MS)
    const { account } = requireAccount()
    const hasPending = account.memberships.some(
      (membership) => membership.is_owner && toMembership(membership)?.office_status === 'pending',
    )
    if (hasPending) throw new ApiError('REGISTRATION_PENDING', { status: 409 })
    const officeId = crypto.randomUUID()
    state.offices.push({
      office_id: officeId,
      office_name: office.name.trim(),
      office_city: office.city.trim(),
      office_status: 'pending',
    })
    account.memberships.push({
      office_id: officeId,
      role: 'admin',
      membership_status: 'active',
      is_owner: true,
    })
    saveState()
    return {
      office_id: officeId,
      name: office.name.trim(),
      status: 'pending',
      created_at: new Date().toISOString(),
    }
  },
  async previewInvitation(token) {
    await delay(400)
    const invitation = mockInvitations.find((candidate) => candidate.token === token)
    const office =
      invitation && state.offices.find((candidate) => candidate.office_id === invitation.office_id)
    if (!invitation || !office) throw new ApiError('INVITATION_INVALID', { status: 404 })
    const [local = '', domain = ''] = invitation.email.split('@')
    return {
      office_name: office.office_name,
      office_active: office.office_status === 'active',
      role: invitation.role,
      email_hint: `${local.slice(0, 2)}${'•'.repeat(Math.max(local.length - 2, 1))}@${domain}`,
      state: state.usedInvitations.includes(token) ? 'accepted' : 'pending',
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    }
  },
  async acceptInvitation(token) {
    await delay(MOCK_LATENCY_MS)
    const { session, account } = requireAccount()
    const invitation = mockInvitations.find((candidate) => candidate.token === token)
    if (!invitation || state.usedInvitations.includes(token)) {
      throw new ApiError('INVITATION_INVALID', { status: 410 })
    }
    if (invitation.email !== account.user.email) {
      throw new ApiError('INVITATION_EMAIL_MISMATCH', { status: 403 })
    }
    if (account.memberships.some((membership) => membership.office_id === invitation.office_id)) {
      throw new ApiError('ALREADY_MEMBER', { status: 409 })
    }
    account.memberships.push({
      office_id: invitation.office_id,
      role: invitation.role,
      membership_status: 'active',
      is_owner: false,
    })
    state.usedInvitations.push(token)
    saveState()
    writeSession({ ...session, active_office_id: invitation.office_id })
    return { office_id: invitation.office_id, role: invitation.role }
  },
}
