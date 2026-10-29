import { Eye, EyeOff, Lock } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'

type PasswordInputProps = Omit<ComponentProps<'input'>, 'type'>

export const PasswordInput = ({ id, ...props }: PasswordInputProps) => {
  const { t } = useTranslation('auth')
  const [visible, setVisible] = useState(false)
  const label = visible ? t('login.hidePassword') : t('login.showPassword')

  return (
    <div className="group relative">
      <Lock
        aria-hidden="true"
        className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-accent"
      />
      <Input id={id} type={visible ? 'text' : 'password'} dir="ltr" className="px-11" {...props} />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={label}
        aria-pressed={visible}
        aria-controls={id}
        title={label}
        className="absolute end-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-heading"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={visible ? 'hide' : 'show'}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
            className="grid place-items-center"
          >
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </motion.span>
        </AnimatePresence>
      </button>
    </div>
  )
}
