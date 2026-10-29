import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { fadeUp } from '@/components/motion/presets'

type AuthHeadingProps = {
  eyebrow: string
  title: string
  subtitle?: ReactNode
}

/** The eyebrow + display title + subtitle block shared by every authentication screen. */
export const AuthHeading = ({ eyebrow, title, subtitle }: AuthHeadingProps) => (
  <>
    <motion.p
      variants={fadeUp}
      className="mb-3 flex items-center gap-3 text-xs font-semibold tracking-[0.18em] text-accent uppercase"
    >
      <span aria-hidden="true" className="h-px w-8 bg-gold" />
      {eyebrow}
    </motion.p>
    <motion.h1
      variants={fadeUp}
      className="font-display text-[2.1rem] leading-tight font-bold sm:text-[2.5rem]"
    >
      {title}
    </motion.h1>
    {subtitle && (
      <motion.p variants={fadeUp} className="mt-3 leading-relaxed text-muted-foreground">
        {subtitle}
      </motion.p>
    )}
  </>
)
