import { motion, type Variants } from 'motion/react'
import type { ReactNode } from 'react'
import { fadeUp, staggerContainer } from './presets'

type RevealProps = {
  children: ReactNode
  className?: string
  variants?: Variants
  /** `mount` animates immediately; `inView` waits until scrolled into view (marketing pages) */
  trigger?: 'mount' | 'inView'
}

const triggerProps = (trigger: 'mount' | 'inView') =>
  trigger === 'inView'
    ? {
        initial: 'hidden',
        whileInView: 'visible',
        viewport: { once: true, margin: '0px 0px -10% 0px' },
      }
    : { initial: 'hidden', animate: 'visible' }

/** Single element entrance (fade + slide-up by default). Transform/opacity only — no layout shift. */
export const Reveal = ({
  children,
  className,
  variants = fadeUp,
  trigger = 'mount',
}: RevealProps) => (
  <motion.div className={className} variants={variants} {...triggerProps(trigger)}>
    {children}
  </motion.div>
)

type StaggerProps = RevealProps & { stagger?: number; delay?: number }

/** Parent that staggers its <StaggerItem> children. */
export const Stagger = ({
  children,
  className,
  stagger,
  delay,
  trigger = 'mount',
}: StaggerProps) => (
  <motion.div
    className={className}
    variants={staggerContainer(stagger, delay)}
    {...triggerProps(trigger)}
  >
    {children}
  </motion.div>
)

export const StaggerItem = ({
  children,
  className,
  variants = fadeUp,
}: Omit<RevealProps, 'trigger'>) => (
  <motion.div className={className} variants={variants}>
    {children}
  </motion.div>
)
