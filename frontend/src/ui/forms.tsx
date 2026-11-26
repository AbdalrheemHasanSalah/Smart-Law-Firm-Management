import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { cn } from './kit'

/** A sheet laid over the desk: closes on Escape, on the backdrop, or with its own button. */
export const Modal = ({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
}) => {
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-desk-deep/75 p-4 backdrop-blur-sm"
          onMouseDown={(event) => event.target === event.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            className={cn('w-full rounded-lg border-t-4 border-stamp bg-paper p-6 shadow-lifted sm:p-7', wide ? 'max-w-2xl' : 'max-w-lg')}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <h2 id={titleId} className="text-2xl text-ink">
                {title}
              </h2>
              <button type="button" onClick={onClose} aria-label="إغلاق" className="grid size-8 shrink-0 place-items-center rounded-md text-ink-soft hover:bg-ink/10 hover:text-ink">
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

const control =
  'mt-1 block w-full rounded-md border border-ink/25 bg-white/60 px-3 text-[0.95rem] text-ink focus:border-stamp-blue focus:outline-none'

export const SelectField = ({
  label,
  options,
  className,
  id,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: readonly (readonly [value: string, text: string])[] }) => {
  const fieldId = id ?? props.name
  return (
    <div className={className}>
      <label htmlFor={fieldId} className="block text-xs font-semibold text-ink-soft">
        {label}
      </label>
      <select id={fieldId} {...props} className={cn(control, 'h-10')}>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </div>
  )
}

export const TextArea = ({ label, className, id, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) => {
  const fieldId = id ?? props.name
  return (
    <div className={className}>
      <label htmlFor={fieldId} className="block text-xs font-semibold text-ink-soft">
        {label}
      </label>
      <textarea id={fieldId} rows={3} {...props} className={cn(control, 'py-2 leading-relaxed')} />
    </div>
  )
}

/** Form footer: the error (if any) on one side, the buttons on the other. */
export const FormActions = ({ error, children }: { error?: string | null; children: ReactNode }) => (
  <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
    <p role="alert" className="text-sm text-stamp">
      {error}
    </p>
    <div className="flex gap-2">{children}</div>
  </div>
)

/** Turns any file name into the safe ASCII PDF name the backend accepts. */
export const safePdfName = (name: string) => {
  const base = name.replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9 _().-]/g, '').trim()
  return `${/^[A-Za-z0-9]/.test(base) ? base.slice(0, 200) : 'document'}.pdf`
}

/** Header values must be Latin-1; the backend decodes percent-encoding. */
export const headerValue = (value: string) => encodeURIComponent(value.trim())
