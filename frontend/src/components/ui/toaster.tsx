import { Toaster } from 'sonner'
import { useTheme } from '@/app/providers/theme-context'
import { useLanguage } from '@/hooks/use-language'

/** App-wide toast host, wired to the active theme and reading direction. */
export const AppToaster = () => {
  const { theme } = useTheme()
  const { direction } = useLanguage()
  return (
    <Toaster
      theme={theme}
      dir={direction}
      position={direction === 'rtl' ? 'top-left' : 'top-right'}
      toastOptions={{
        classNames: {
          toast:
            '!rounded-xl !border-border !bg-surface-raised !text-foreground !shadow-lift !font-sans',
          description: '!text-muted-foreground',
          success: '[&_[data-icon]]:!text-success',
          error: '[&_[data-icon]]:!text-destructive',
        },
      }}
    />
  )
}
