import type { ReactNode } from 'react'
import { Logo } from '@/components/brand/Logo'
import { Reveal } from '@/components/motion/Reveal'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { ThemeToggle } from '@/components/shared/ThemeToggle'

type CenteredMessageProps = {
  eyebrow?: string
  title: string
  description: string
  children?: ReactNode
}

/** Minimal branded screen for status pages (not found, pending stage, signed-in notice). */
export const CenteredMessage = ({
  eyebrow,
  title,
  description,
  children,
}: CenteredMessageProps) => (
  <div className="flex min-h-dvh flex-col bg-background">
    <header className="flex items-center justify-between px-5 py-5 sm:px-10">
      <Logo />
      <div className="flex items-center gap-2">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
    </header>
    <main className="flex flex-1 items-center justify-center px-5 pb-16">
      <Reveal className="w-full max-w-lg rounded-2xl border border-border bg-surface p-8 text-center shadow-soft sm:p-10">
        {eyebrow && (
          <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-accent uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-3xl font-bold">{title}</h1>
        <p className="mt-3 leading-relaxed text-muted-foreground">{description}</p>
        {children && <div className="mt-7 flex flex-col items-center gap-3">{children}</div>}
      </Reveal>
    </main>
  </div>
)
