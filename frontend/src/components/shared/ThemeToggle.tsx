import { Moon, Sun } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/app/providers/theme-context'
import { cn } from '@/lib/utils'

export const ThemeToggle = ({ className }: { className?: string }) => {
  const { theme, toggleTheme } = useTheme()
  const { t } = useTranslation()
  const isDark = theme === 'dark'
  const label = isDark ? t('theme.toLight') : t('theme.toDark')

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={cn(
        'relative grid size-10 place-items-center overflow-hidden rounded-full border border-border bg-surface text-heading',
        'transition-[border-color,background-color,box-shadow,transform] duration-300 ease-elegant',
        'hover:border-gold hover:shadow-soft motion-safe:active:scale-95',
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="grid place-items-center"
        >
          {isDark ? (
            <Sun className="size-[1.1rem] text-gold" />
          ) : (
            <Moon className="size-[1.1rem]" />
          )}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}
