import { LogoMark } from '@/components/brand/LogoMark'

export const PageLoader = () => (
  <div className="grid min-h-dvh place-items-center bg-background" role="status" aria-live="polite">
    <div className="motion-safe:animate-pulse">
      <LogoMark className="h-24 dark:hidden" />
      <LogoMark tone="light" className="hidden h-24 dark:block" />
    </div>
    <span className="sr-only">Loading…</span>
  </div>
)
