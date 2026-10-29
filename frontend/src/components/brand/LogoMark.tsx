import { cn } from '@/lib/utils'

/**
 * Qadiyati emblem: balance scale in front of a case folder, cropped from the full
 * logo (public/brand/qadiyati-logo*.png). Colours are mapped to the theme palette:
 * forest #2b372d + bronze/champagne on light, ivory/champagne on dark.
 */
export type LogoTone = 'brand' | 'light'

const SRC: Record<LogoTone, string> = {
  // Forest + bronze — default on light backgrounds
  brand: '/brand/qadiyati-mark.png',
  // Ivory + champagne for use on dark/forest backgrounds
  light: '/brand/qadiyati-mark-light.png',
}

type LogoMarkProps = { tone?: LogoTone; className?: string; title?: string }

export const LogoMark = ({ tone = 'brand', className, title }: LogoMarkProps) => (
  <img
    src={SRC[tone]}
    alt={title ?? ''}
    aria-hidden={title ? undefined : true}
    draggable={false}
    className={cn('h-10 w-auto object-contain select-none', className)}
  />
)
