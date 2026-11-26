import { Languages, Moon, Sun } from 'lucide-react'
import { currentLang, setLang, setTheme, useTheme } from '@/lib/preferences'
import { cn } from './kit'

/**
 * Theme and language switches, side by side in a small pill, as on most international sites.
 * `onDesk` is for the navy headers (landing and sign-in pages); otherwise it sits on paper.
 */
export const PreferenceControls = ({ onDesk = false, className }: { onDesk?: boolean; className?: string }) => {
  const theme = useTheme()
  const lang = currentLang()
  const dark = theme === 'dark'
  const item = cn(
    'grid h-8 min-w-8 place-items-center rounded-full px-2 text-xs font-bold transition-colors focus-visible:outline-2',
    onDesk ? 'text-paper/80 hover:bg-paper/10 hover:text-paper' : 'text-ink-soft hover:bg-ink/8 hover:text-ink',
  )
  return (
    <div
      className={cn('flex items-center gap-0.5 rounded-full p-0.5', onDesk ? 'border border-paper/20' : 'border border-ink/12', className)}
      role="group"
      aria-label={lang === 'en' ? 'Display' : 'العرض'}
    >
      <button
        type="button"
        onClick={() => setTheme(dark ? 'light' : 'dark')}
        className={item}
        aria-label={dark ? 'الوضع الفاتح' : 'الوضع الداكن'}
        title={dark ? 'الوضع الفاتح' : 'الوضع الداكن'}
      >
        {dark ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
      </button>
      <span aria-hidden="true" className={cn('h-4 w-px', onDesk ? 'bg-paper/20' : 'bg-ink/12')} />
      <button
        type="button"
        onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
        className={cn(item, 'gap-1')}
        lang={lang === 'en' ? 'ar' : 'en'}
        aria-label={lang === 'en' ? 'العربية' : 'English'}
        title={lang === 'en' ? 'العربية' : 'English'}
      >
        <span className="flex items-center gap-1">
          <Languages className="size-3.5" aria-hidden="true" />
          {lang === 'en' ? 'ع' : 'EN'}
        </span>
      </button>
    </div>
  )
}
