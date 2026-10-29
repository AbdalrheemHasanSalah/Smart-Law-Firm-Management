import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '@/hooks/use-language'
import { cn } from '@/lib/utils'

/** Toggles AR ⇄ EN. Direction, fonts and storage are handled centrally in lib/i18n. */
export const LanguageSwitcher = ({ className }: { className?: string }) => {
  const { t } = useTranslation()
  const { language, toggleLanguage } = useLanguage()
  const target = language === 'ar' ? 'en' : 'ar'

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      aria-label={t('language.switchTo')}
      title={t('language.switchTo')}
      className={cn(
        'inline-flex h-10 items-center gap-2 rounded-full border border-border bg-surface ps-3 pe-4 text-sm font-medium text-heading',
        'transition-[border-color,background-color,box-shadow,transform] duration-300 ease-elegant',
        'hover:border-gold hover:shadow-soft motion-safe:active:scale-95',
        className,
      )}
    >
      <Languages className="size-4 text-accent" aria-hidden="true" />
      <span
        lang={target}
        className={target === 'ar' ? 'font-[IBM_Plex_Sans_Arabic]' : 'font-[Inter_Variable]'}
      >
        {t('language.short')}
      </span>
    </button>
  )
}
