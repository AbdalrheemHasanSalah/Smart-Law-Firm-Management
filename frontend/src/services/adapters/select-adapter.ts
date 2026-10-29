import { env } from '@/lib/env'

/**
 * Picks the mock or the HTTP implementation of a service based on VITE_USE_MOCKS.
 * Both implementations satisfy the same typed interface, so UI code never changes.
 */
export const selectAdapter = <Service>(adapters: { mock: Service; http: Service }): Service =>
  env.useMocks ? adapters.mock : adapters.http
