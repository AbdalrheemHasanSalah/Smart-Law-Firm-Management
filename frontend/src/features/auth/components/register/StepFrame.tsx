import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useEffect, useRef, type FormEventHandler, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/hooks/use-language'

type StepFrameProps = {
  step: string
  onSubmit: FormEventHandler<HTMLFormElement>
  onBack?: () => void
  submitLabel?: string
  submittingLabel?: string
  submitting?: boolean
  children: ReactNode
}

/**
 * One wizard step: a titled form with Back / Continue. The heading takes focus when the step
 * appears, so keyboard and screen-reader users land at the start of the new step.
 */
export const StepFrame = ({
  step,
  onSubmit,
  onBack,
  submitLabel,
  submittingLabel,
  submitting = false,
  children,
}: StepFrameProps) => {
  const { t } = useTranslation('auth')
  const { direction } = useLanguage()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const ForwardArrow = direction === 'rtl' ? ArrowLeft : ArrowRight
  const BackArrow = direction === 'rtl' ? ArrowRight : ArrowLeft

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <form noValidate onSubmit={onSubmit} aria-busy={submitting} className="space-y-5">
      <div>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-xl font-bold text-heading outline-none"
        >
          {t(`register.steps.${step}.title`)}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {t(`register.steps.${step}.description`)}
        </p>
      </div>

      {children}

      <div className="flex items-center gap-3 pt-2">
        {onBack && (
          <Button type="button" variant="outline" size="lg" onClick={onBack} disabled={submitting}>
            <BackArrow aria-hidden="true" className="size-4" />
            {t('register.back')}
          </Button>
        )}
        <Button
          type="submit"
          size="lg"
          className="group flex-1"
          loading={submitting}
          loadingText={submittingLabel}
        >
          {submitLabel ?? t('register.next')}
          <ForwardArrow
            aria-hidden="true"
            className="size-4 transition-transform duration-300 ease-elegant ltr:group-hover:translate-x-1 rtl:group-hover:-translate-x-1"
          />
        </Button>
      </div>
    </form>
  )
}
