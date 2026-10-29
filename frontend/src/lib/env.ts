/**
 * Typed access to Vite environment variables.
 * Everything here is PUBLIC (bundled into the browser) — never put secrets in VITE_* vars.
 */
const readBoolean = (value: string | undefined, fallback: boolean) =>
  value === undefined ? fallback : value.toLowerCase() === 'true'

export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api',
  useMocks: readBoolean(import.meta.env.VITE_USE_MOCKS, true),
  isDev: import.meta.env.DEV,
} as const
