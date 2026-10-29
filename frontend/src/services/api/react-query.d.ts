import type { ApiError } from './api-error'

/**
 * Every service rejects with ApiError (the HTTP client normalises errors and the mock adapters
 * throw it directly), so queries and mutations are typed with it by default.
 */
declare module '@tanstack/react-query' {
  interface Register {
    defaultError: ApiError
  }
}
