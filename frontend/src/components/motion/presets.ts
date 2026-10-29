import type { Transition, Variants } from 'motion/react'

/** Shared easing/timing so every animation in the app feels like the same family. */
export const EASE_ELEGANT = [0.22, 1, 0.36, 1] as const

export const transitions = {
  gentle: { duration: 0.6, ease: EASE_ELEGANT },
  quick: { duration: 0.3, ease: EASE_ELEGANT },
} satisfies Record<string, Transition>

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: transitions.gentle },
}

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transitions.gentle },
}

export const imageReveal: Variants = {
  hidden: { opacity: 0, scale: 1.08 },
  visible: { opacity: 1, scale: 1, transition: { duration: 1.4, ease: EASE_ELEGANT } },
}

export const staggerContainer = (stagger = 0.07, delayChildren = 0.1): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: stagger, delayChildren } },
})
