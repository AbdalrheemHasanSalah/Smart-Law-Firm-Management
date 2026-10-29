import { FlaskConical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/** Visible only in mock mode, so a demo is never mistaken for real authentication. */
export const DemoCredentials = ({ onFill }: { onFill: () => void }) => {
  const { t } = useTranslation('auth')
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-gold/60 bg-accent-soft px-4 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-foreground/80">
          <span className="font-semibold text-accent">{t('demo.badge')}</span> —{' '}
          {t('demo.description')}
        </p>
      </div>
      <Button
        type="button"
        variant="link"
        size="sm"
        onClick={onFill}
        className="text-xs font-semibold"
      >
        {t('demo.fill')}
      </Button>
    </div>
  )
}
