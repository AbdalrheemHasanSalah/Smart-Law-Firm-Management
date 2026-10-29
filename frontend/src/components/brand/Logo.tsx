import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { LogoMark, type LogoTone } from './LogoMark'

type LogoProps = {
  /** `full` = mark + wordmark, `icon` = mark only */
  variant?: 'full' | 'icon'
  /** `auto` follows the active theme; `onDark` is for photography/forest surfaces */
  tone?: 'auto' | 'onDark'
  className?: string
}

/**
 * Brand lock-up. The wordmark is live text (not outlined paths) so it stays crisp,
 * accessible and uses the self-hosted display fonts in both scripts.
 */
export const Logo = ({ variant = 'full', tone = 'auto', className }: LogoProps) => {
  const { t } = useTranslation()
  const onDark = tone === 'onDark'
  const markTone: LogoTone = onDark ? 'light' : 'brand'

  if (variant === 'icon')
    return <LogoMark tone={markTone} className={className} title={t('brand.logoAlt')} />

  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      {onDark ? (
        <LogoMark tone="light" className="h-[4.5rem]" />
      ) : (
        <>
          <LogoMark tone="brand" className="h-[4.5rem] dark:hidden" />
          <LogoMark tone="light" className="hidden h-[4.5rem] dark:block" />
        </>
      )}
      <span className="flex flex-col">
        <span
          lang="ar"
          className={cn(
            'font-[Amiri] text-[2.1rem] leading-[1.35] font-bold',
            onDark ? 'text-ivory-50' : 'text-heading',
          )}
        >
          قضيتي
        </span>
        <span
          lang="en"
          className={cn(
            'mt-2 font-sans text-[0.7rem] leading-none font-semibold tracking-[0.32em] uppercase',
            onDark ? 'text-champagne-200' : 'text-accent',
          )}
        >
          Qadiyati
        </span>
      </span>
      <span className="sr-only">{t('brand.logoAlt')}</span>
    </span>
  )
}
