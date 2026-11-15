import clsx from 'clsx'
import { Landmark } from 'lucide-react'
import {
  motion,
  useInView,
  useMotionValue,
  useSpring,
  useTransform,
  type HTMLMotionProps,
} from 'motion/react'
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'

export const cn = clsx

/* ───────────────────────── Stamp ───────────────────────── */

const STAMP_TONE = {
  red: 'text-stamp',
  blue: 'text-stamp-blue',
  green: 'text-stamp-green',
  ink: 'text-ink',
} as const
export type StampTone = keyof typeof STAMP_TONE

type StampProps = {
  children: ReactNode
  tone?: StampTone
  /** `mount` slams as soon as it appears, `view` when scrolled to, `none` is already inked. */
  slam?: 'mount' | 'view' | 'none'
  rotate?: number
  delay?: number
  className?: string
}

/** A rubber stamp. With `slam` it drops from above, hits the page and leaves its ink. */
export const Stamp = ({
  children,
  tone = 'red',
  slam = 'none',
  rotate = -4,
  delay = 0,
  className,
}: StampProps) => {
  const inked = { scale: 1, opacity: 1, rotate }
  const lifted = { scale: 2.8, opacity: 0, rotate: rotate - 16 }
  const transition = { type: 'spring' as const, stiffness: 520, damping: 17, mass: 0.9, delay }
  const motionProps: HTMLMotionProps<'span'> =
    slam === 'mount'
      ? { initial: lifted, animate: inked, transition }
      : slam === 'view'
        ? {
            initial: lifted,
            whileInView: inked,
            viewport: { once: true, margin: '-12% 0px' },
            transition,
          }
        : { initial: false, animate: inked }
  return (
    <motion.span {...motionProps} className={cn('stamp', STAMP_TONE[tone], className)}>
      {children}
    </motion.span>
  )
}

/* ───────────────────────── Paper clip ───────────────────────── */

export const PaperClip = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 28 70"
    aria-hidden="true"
    className={cn('pointer-events-none drop-shadow-[0_2px_1px_rgb(0_0_0/0.3)]', className)}
    fill="none"
    stroke="#9aa3ad"
    strokeWidth={3}
    strokeLinecap="round"
  >
    <path d="M9 18v34a7 7 0 0 0 14 0V14a10 10 0 0 0-20 0v40" />
    <path d="M9 18v34a7 7 0 0 0 14 0V14a10 10 0 0 0-20 0v40" stroke="#eef1f4" strokeWidth={1} />
  </svg>
)

/* ───────────────────────── Typewriter ───────────────────────── */

/** Types `text` one character at a time, then leaves a blinking caret. */
export const Typewriter = ({
  text,
  speed = 55,
  startDelay = 300,
  className,
  caret = true,
}: {
  text: string
  speed?: number
  startDelay?: number
  className?: string
  caret?: boolean
}) => {
  const [count, setCount] = useState(0)
  useEffect(() => {
    setCount(0)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCount(text.length)
      return
    }
    let timer: number
    const tick = (index: number) => {
      setCount(index)
      if (index < text.length) timer = window.setTimeout(() => tick(index + 1), speed)
    }
    timer = window.setTimeout(() => tick(1), startDelay)
    return () => window.clearTimeout(timer)
  }, [text, speed, startDelay])
  return (
    <span className={className} aria-label={text}>
      <span aria-hidden="true">{text.slice(0, count)}</span>
      {caret && (
        <span
          aria-hidden="true"
          className="ms-0.5 inline-block h-[0.9em] w-[2px] translate-y-[0.12em] animate-[caret_0.9s_steps(1)_infinite] bg-current"
        />
      )}
    </span>
  )
}

/* ───────────────────────── Marker ───────────────────────── */

/** Highlighter stroke that sweeps across the words when they scroll into view. */
export const Marker = ({ children }: { children: ReactNode }) => {
  const ref = useRef<HTMLSpanElement>(null)
  const on = useInView(ref, { once: true, margin: '-15% 0px' })
  return (
    <span ref={ref} data-on={on} className="marker">
      {children}
    </span>
  )
}

/* ───────────────────────── Tilt ───────────────────────── */

/** Tips its content towards the pointer, like a sheet picked up by one corner. */
export const Tilt = ({
  children,
  className,
  max = 7,
}: {
  children: ReactNode
  className?: string
  max?: number
}) => {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [max, -max]), { stiffness: 220, damping: 18 })
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-max, max]), { stiffness: 220, damping: 18 })
  return (
    <motion.div
      className={className}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect()
        x.set((event.clientX - box.left) / box.width - 0.5)
        y.set((event.clientY - box.top) / box.height - 0.5)
      }}
      onPointerLeave={() => {
        x.set(0)
        y.set(0)
      }}
    >
      {children}
    </motion.div>
  )
}

/* ───────────────────────── Reveal ───────────────────────── */

/** A sheet sliding onto the desk when scrolled to. */
export const SlideIn = ({
  children,
  className,
  from = 'bottom',
  delay = 0,
  rotate = 0,
}: {
  children: ReactNode
  className?: string
  from?: 'bottom' | 'start' | 'end'
  delay?: number
  rotate?: number
}) => {
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl'
  const dx = from === 'start' ? (rtl ? 90 : -90) : from === 'end' ? (rtl ? -90 : 90) : 0
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, x: dx, y: from === 'bottom' ? 60 : 0, rotate: rotate + (dx ? 3 : 0) }}
      whileInView={{ opacity: 1, x: 0, y: 0, rotate: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ type: 'spring', stiffness: 90, damping: 16, delay }}
    >
      {children}
    </motion.div>
  )
}

/* ───────────────────────── Buttons ───────────────────────── */

const BUTTON = {
  ink: 'bg-ink text-paper hover:bg-ink/85 shadow-paper',
  stamp:
    'bg-stamp text-paper hover:bg-[#c00a17] shadow-[0_4px_0_#8f101b] active:translate-y-[3px] active:shadow-[0_1px_0_#8f101b]',
  manila: 'manila text-ink hover:brightness-105',
  line: 'border border-ink/30 text-ink hover:border-ink hover:bg-ink/5',
  ghost: 'text-ink-soft hover:bg-ink/5 hover:text-ink',
  paperline: 'border border-paper/40 text-paper hover:border-paper hover:bg-paper/10',
} as const

export const buttonClass = (variant: keyof typeof BUTTON = 'ink', size: 'sm' | 'md' | 'lg' = 'md') =>
  cn(
    'inline-flex items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap select-none',
    'transition-[background-color,border-color,transform,box-shadow,filter] duration-200',
    'disabled:pointer-events-none disabled:opacity-50',
    size === 'sm' ? 'h-9 px-3.5 text-sm' : size === 'lg' ? 'h-12 px-7 text-base' : 'h-10.5 px-5 text-sm',
    BUTTON[variant],
  )

export const Button = ({
  variant,
  size,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON
  size?: 'sm' | 'md' | 'lg'
}) => <button type="button" {...props} className={cn(buttonClass(variant, size), className)} />

/* ───────────────────────── Form field ───────────────────────── */

/** A line on a paper form: small printed label, the answer written on a ruled line. */
export const Field = ({
  label,
  error,
  hint,
  className,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) => {
  const fieldId = id ?? props.name
  return (
    <div className={className}>
      <label htmlFor={fieldId} className="block text-xs font-semibold text-ink-soft">
        {label}
      </label>
      <input
        id={fieldId}
        {...props}
        aria-invalid={error ? true : undefined}
        className={cn(
          'mt-1 block h-10 w-full border-0 border-b-2 border-dotted bg-transparent px-1 text-[0.95rem] text-ink',
          'placeholder:text-ink-faint/70 focus:border-solid focus:outline-none',
          error ? 'border-stamp' : 'border-ink/35 focus:border-stamp-blue',
        )}
      />
      {(error ?? hint) && (
        <p className={cn('mt-1 text-xs', error ? 'text-stamp' : 'text-ink-faint')}>{error ?? hint}</p>
      )}
    </div>
  )
}

/* ───────────────────────── Logo ───────────────────────── */

/** The brand: a courthouse on a red seal, and the name in document type. */
export const Logo = ({ onDesk = false, className }: { onDesk?: boolean; className?: string }) => (
  <span className={cn('inline-flex items-center gap-2.5', className)}>
    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-stamp text-paper">
      <Landmark className="size-5" strokeWidth={2.2} />
    </span>
    <span className={cn('font-doc text-[1.7rem] leading-none font-bold', onDesk ? 'text-paper' : 'text-ink')}>
      قضيتي
    </span>
  </span>
)
