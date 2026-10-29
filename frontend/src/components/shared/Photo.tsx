import { motion } from 'motion/react'
import { useState } from 'react'
import { photoSrcSet, photoUrl, type PhotoAsset } from '@/assets/photos'
import { imageReveal } from '@/components/motion/presets'
import { cn } from '@/lib/utils'

type PhotoProps = {
  /** First entry is preferred; the rest are tried in order if a source fails to load. */
  sources: readonly PhotoAsset[]
  alt: string
  sizes?: string
  priority?: boolean
  className?: string
  imgClassName?: string
}

/**
 * Responsive photograph with: srcset, lazy/eager loading, fade-and-settle reveal,
 * automatic fallback to the next source, and a branded tonal fallback if all fail.
 */
export const Photo = ({
  sources,
  alt,
  sizes = '100vw',
  priority = false,
  className,
  imgClassName,
}: PhotoProps) => {
  const [index, setIndex] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const current = sources[index]
  const first = sources[0]

  return (
    <div
      className={cn('relative overflow-hidden', className)}
      style={{
        backgroundColor: first?.placeholder,
        backgroundImage:
          'radial-gradient(120% 80% at 20% 10%, rgb(186 153 126 / 0.28), transparent 60%), linear-gradient(160deg, #2b372d, #121915)',
      }}
    >
      {current && (
        <motion.img
          key={current.id}
          src={photoUrl(current, 1600)}
          srcSet={photoSrcSet(current)}
          sizes={sizes}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          referrerPolicy="no-referrer"
          variants={imageReveal}
          initial="hidden"
          animate={loaded ? 'visible' : 'hidden'}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false)
            setIndex((value) => value + 1)
          }}
          className={cn('absolute inset-0 size-full object-cover', imgClassName)}
        />
      )}
      {!current && <span className="sr-only">{alt}</span>}
    </div>
  )
}
