import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { photos } from '@/assets/photos'
import { Logo } from '@/components/brand/Logo'
import { fadeUp, staggerContainer } from '@/components/motion/presets'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { Photo } from '@/components/shared/Photo'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { cn } from '@/lib/utils'

const PHOTO_SOURCES = [
  photos.libraryWarmLight,
  photos.lawBooksShelf,
  photos.lawAndRightsBooks,
] as const
const POINT_KEYS = ['cases', 'hearings', 'documents'] as const

const Diamond = () => (
  <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rotate-45 bg-champagne-300" />
)

const PhotoOverlay = () => (
  <>
    <div className="absolute inset-0 bg-linear-to-t from-forest-950 via-forest-900/70 to-forest-900/25" />
    <div className="absolute inset-0 bg-[radial-gradient(90%_60%_at_80%_0%,transparent,rgb(18_25_21/0.55))]" />
  </>
)

/** Brand panel shown beside the form on large screens. */
const BrandPanel = () => {
  const { t } = useTranslation('auth')
  return (
    <aside className="relative hidden p-4 lg:sticky lg:top-0 lg:block lg:h-dvh">
      <div className="relative h-full overflow-hidden rounded-[2rem] rounded-ss-[7rem] shadow-lift">
        <Photo
          sources={PHOTO_SOURCES}
          alt={t('panel.imageAlt')}
          sizes="50vw"
          priority
          className="absolute inset-0"
        />
        <PhotoOverlay />
        {/* inset gold frame, echoing the editorial framing of the reference design */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-5 rounded-[1.6rem] rounded-ss-[6.3rem] border border-champagne-400/35"
        />

        <div className="relative flex h-full flex-col justify-between p-12 xl:p-14">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Logo tone="onDark" className="ms-10" />
          </motion.div>

          <motion.div
            variants={staggerContainer(0.09, 0.35)}
            initial="hidden"
            animate="visible"
            className="max-w-lg"
          >
            <motion.p
              variants={fadeUp}
              className="mb-5 flex items-center gap-3 text-xs font-semibold tracking-[0.2em] text-champagne-300 uppercase"
            >
              <span aria-hidden="true" className="h-px w-10 bg-champagne-300/70" />
              {t('panel.eyebrow')}
            </motion.p>
            <motion.h2
              variants={fadeUp}
              className="font-display text-4xl leading-[1.25] font-bold text-ivory-50 xl:text-[2.75rem]"
            >
              {t('panel.headline')}
            </motion.h2>
            <motion.p
              variants={fadeUp}
              className="mt-5 text-base leading-relaxed text-ivory-100/75"
            >
              {t('panel.body')}
            </motion.p>
            <motion.ul
              variants={fadeUp}
              className="mt-8 grid gap-3 border-t border-champagne-400/25 pt-6"
            >
              {POINT_KEYS.map((key) => (
                <li key={key} className="flex gap-3 text-sm text-ivory-100/90">
                  <Diamond />
                  {t(`panel.points.${key}`)}
                </li>
              ))}
            </motion.ul>
          </motion.div>
        </div>

        <a
          href={PHOTO_SOURCES[0].page}
          target="_blank"
          rel="noreferrer noopener"
          className="absolute end-8 bottom-6 text-[0.65rem] tracking-wide text-ivory-100/45 transition-colors hover:text-ivory-100/80"
          lang="en"
          dir="ltr"
        >
          Photo · {PHOTO_SOURCES[0].photographer} / Unsplash
        </a>
      </div>
    </aside>
  )
}

/** Compact photographic header for phones and tablets. */
const MobileBanner = () => {
  const { t } = useTranslation('auth')
  return (
    <div className="relative h-48 overflow-hidden rounded-b-[2rem] sm:h-56 lg:hidden">
      <Photo
        sources={PHOTO_SOURCES}
        alt={t('panel.imageAlt')}
        sizes="100vw"
        priority
        className="absolute inset-0"
      />
      <PhotoOverlay />
      <div className="relative flex h-full items-start justify-between p-5">
        <Logo tone="onDark" />
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </div>
  )
}

type AuthLayoutProps = {
  children: ReactNode
  footer?: ReactNode
  /** Wider column for multi-step forms such as registration. */
  wide?: boolean
}

/**
 * Split-screen authentication shell, shared by Login / Register / Forgot / Reset.
 * Uses logical CSS properties throughout, so the layout mirrors itself in RTL.
 */
export const AuthLayout = ({ children, footer, wide = false }: AuthLayoutProps) => (
  <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
    <BrandPanel />
    <div className="relative flex min-h-dvh flex-col overflow-hidden lg:min-h-0">
      <MobileBanner />
      <header className="hidden items-center justify-end gap-2 px-10 pt-8 lg:flex">
        <LanguageSwitcher />
        <ThemeToggle />
      </header>
      <main className="relative flex flex-1 items-center justify-center px-5 py-10 sm:px-10">
        <div className={cn('w-full', wide ? 'max-w-[34rem]' : 'max-w-[27rem]')}>{children}</div>
      </main>
      {footer && (
        <footer className="relative px-5 pb-6 text-center text-xs text-muted-foreground sm:px-10">
          {footer}
        </footer>
      )}
    </div>
  </div>
)
