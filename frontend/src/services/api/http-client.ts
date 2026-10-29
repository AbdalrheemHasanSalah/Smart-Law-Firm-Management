import axios from 'axios'
import { env } from '@/lib/env'
import { ApiError, toApiError } from './api-error'

type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler = () => undefined

/**
 * Registered once by the auth layer so the client never imports auth code directly.
 * Returns an unregister function for effect cleanup.
 */
export const registerUnauthorizedHandler = (handler: UnauthorizedHandler) => {
  onUnauthorized = handler
  return () => {
    if (onUnauthorized === handler) onUnauthorized = () => undefined
  }
}

/**
 * The backend uses Better Auth's httpOnly session cookie, so no token is ever read or stored by
 * JavaScript. `withCredentials` lets the browser attach that cookie to cross-origin API calls.
 */
export const httpClient = axios.create({
  baseURL: env.apiBaseUrl,
  timeout: 15_000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
})

httpClient.interceptors.request.use((config) => {
  config.headers.set('Accept-Language', document.documentElement.lang || 'ar')
  return config
})

httpClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const apiError = toApiError(error)
    // A 401 from a regular API call means the session expired; sign-in failures are not that.
    const url = (error as { config?: { url?: string } }).config?.url ?? ''
    if (
      apiError instanceof ApiError &&
      apiError.code === 'UNAUTHORIZED' &&
      !url.startsWith('/auth/')
    ) {
      onUnauthorized()
    }
    return Promise.reject(apiError)
  },
)
