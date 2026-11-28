import { ChevronLeft, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion, useScroll, useTransform } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { cn } from './kit'

/**
 * Law photography, all free to use under the Unsplash License (https://unsplash.com/license),
 * which does not require showing a credit on the page; `credit` keeps a record of who took each.
 * Served from Unsplash's CDN, resized on the fly.
 */
export const LAW_PHOTOS = [
  { id: 'FaTLrG5-ViE', src: 'https://images.unsplash.com/photo-1767972463877-b64ba4283cd0', label: 'مطرقة قاضٍ بجانب كتاب', credit: '@sasun1990' },
  { id: 'rLIZ_8LUKtY', src: 'https://images.unsplash.com/photo-1780396070926-5abdd2a7928a', label: 'قاعة محكمة', credit: '@mdbeckwith' },
  { id: 'M5qjJS5c4O4', src: 'https://images.unsplash.com/photo-1511128250269-e45d82f3893e', label: 'رفّ كتب قانونية', credit: 'Mark Weaver' },
  { id: 'YFz39MOmxnQ', src: 'https://images.unsplash.com/photo-1774898988393-5c752e4d55e9', label: 'تمثال العدالة مع مطرقة وكتاب مفتوح', credit: '@sasun1990' },
  { id: 'FVYttf-q3XE', src: 'https://images.unsplash.com/photo-1788784519586-0a14c5b55f0a', label: 'مبنى محكمة', credit: '@cbischoff' },
] as const

const urlOf = (src: string, width: number) => `${src}?auto=format&fit=crop&w=${width}&q=70`

/**
 * A window of law photographs behind the content: each one fades in, drifts slowly, and gives way
 * to the next. The photos are kept translucent over the navy so text in front stays readable.
 * With `controls` it shows arrows and one dot per photo.
 */
export const Slideshow = ({ controls = true, className }: { controls?: boolean; className?: string }) => {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const count = LAW_PHOTOS.length
  const photo = LAW_PHOTOS[index]!

  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % count), 5500)
    return () => window.clearInterval(timer)
  }, [paused, count])

  const step = (by: number) => setIndex((current) => (current + by + count) % count)

  return (
    <div className={cn('absolute inset-0 overflow-hidden', className)}>
      <AnimatePresence initial={false}>
        <motion.img
          key={photo.id}
          src={urlOf(photo.src, 1600)}
          srcSet={[960, 1600, 2200].map((width) => `${urlOf(photo.src, width)} ${width}w`).join(', ')}
          sizes="100vw"
          alt=""
          referrerPolicy="no-referrer"
          initial={{ opacity: 0, scale: 1.1 }}
          animate={{ opacity: 0.7, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ opacity: { duration: 1.3 }, scale: { duration: 8, ease: 'linear' } }}
          className="absolute inset-0 size-full object-cover"
        />
      </AnimatePresence>
      {/* navy wash, heavier on the side where the text sits */}
      <div className="absolute inset-0 bg-linear-to-l from-desk via-desk/45 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-linear-to-t from-desk to-transparent" />

      {controls && (
        <div
          className="absolute inset-x-0 bottom-6 z-20 flex items-center justify-center gap-4"
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
        >
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="الصورة السابقة"
            className="grid size-9 place-items-center rounded-full border border-paper/40 text-paper transition-colors hover:border-paper hover:bg-paper/10"
          >
            <ChevronRight className="size-4 ltr:-scale-x-100" aria-hidden="true" />
          </button>
          <div className="flex items-center gap-2">
            {LAW_PHOTOS.map((entry, dot) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setIndex(dot)}
                aria-label={`الصورة ${dot + 1} من ${count}: ${entry.label}`}
                aria-current={dot === index}
                className={cn(
                  'h-2 rounded-full transition-[width,background-color] duration-500',
                  dot === index ? 'w-8 bg-stamp' : 'w-2 bg-paper/45 hover:bg-paper',
                )}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="الصورة التالية"
            className="grid size-9 place-items-center rounded-full border border-paper/40 text-paper transition-colors hover:border-paper hover:bg-paper/10"
          >
            <ChevronLeft className="size-4 ltr:-scale-x-100" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The slide window: a framed photograph that slides sideways to the next one, with its caption,
 * arrows, dots and a thin bar that fills until the next slide.
 */
export const PhotoWindow = ({ className }: { className?: string }) => {
  const [[index, direction], setSlide] = useState<[number, number]>([0, 1])
  const [paused, setPaused] = useState(false)
  const count = LAW_PHOTOS.length
  const photo = LAW_PHOTOS[index]!
  const step = (by: number) => setSlide(([current]) => [(current + by + count) % count, by])

  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setTimeout(() => step(1), 5000)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, paused])

  return (
    <div
      className={cn('relative', className)}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      <div className="relative aspect-[4/5] overflow-hidden rounded-[1.75rem] border border-paper/25 bg-desk-light shadow-lifted sm:aspect-[5/4] lg:aspect-[4/5]">
        <AnimatePresence initial={false} custom={direction}>
          <motion.img
            key={photo.id}
            custom={direction}
            src={urlOf(photo.src, 1200)}
            alt={photo.label}
            referrerPolicy="no-referrer"
            // In a right-to-left page the next slide enters from the left.
            variants={{
              enter: (dir: number) => ({ x: `${-100 * dir}%`, scale: 1.08 }),
              centre: { x: '0%', scale: 1 },
              exit: (dir: number) => ({ x: `${100 * dir}%`, scale: 1.08 }),
            }}
            initial="enter"
            animate="centre"
            exit="exit"
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 size-full object-cover"
          />
        </AnimatePresence>
        <div className="absolute inset-0 bg-linear-to-t from-desk via-desk/25 to-desk/10" />

        <div className="absolute inset-x-0 bottom-0 p-5">
          <AnimatePresence mode="wait">
            <motion.p
              key={photo.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="font-doc text-2xl font-bold text-paper"
            >
              {photo.label}
            </motion.p>
          </AnimatePresence>
          <div className="mt-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {LAW_PHOTOS.map((entry, dot) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSlide([dot, dot >= index ? 1 : -1])}
                  aria-label={`الصورة ${dot + 1} من ${count}`}
                  aria-current={dot === index}
                  className={cn(
                    'h-2 rounded-full transition-[width,background-color] duration-500',
                    dot === index ? 'w-8 bg-stamp' : 'w-2 bg-paper/50 hover:bg-paper',
                  )}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {[
                { by: -1, label: 'الصورة السابقة', Icon: ChevronRight },
                { by: 1, label: 'الصورة التالية', Icon: ChevronLeft },
              ].map(({ by, label, Icon }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => step(by)}
                  aria-label={label}
                  className="grid size-9 place-items-center rounded-full bg-paper/15 text-paper backdrop-blur-sm transition-colors hover:bg-stamp"
                >
                  <Icon className="size-4" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </div>
        {/* time left on this slide */}
        <motion.span
          key={`${photo.id}-${paused}`}
          aria-hidden="true"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: paused ? 0 : 1 }}
          transition={{ duration: paused ? 0 : 5, ease: 'linear' }}
          className="absolute inset-x-0 top-0 h-1 origin-right ltr:origin-left bg-stamp"
        />
      </div>
    </div>
  )
}

/**
 * One translucent law photograph behind a section, so long stretches are not plain navy.
 * It moves a little slower than the page (parallax). Put it first inside a `relative` section
 * and give the content `relative z-10`.
 */
export const PhotoBackdrop = ({ photo, strength = 0.3 }: { photo: number; strength?: number }) => {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], ['-8%', '8%'])
  const { src } = LAW_PHOTOS[photo % LAW_PHOTOS.length]!
  return (
    <div ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.img
        src={urlOf(src, 1600)}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        style={{ y, opacity: strength }}
        className="absolute inset-x-0 -top-[10%] h-[120%] w-full object-cover"
      />
      <div className="absolute inset-0 bg-linear-to-b from-desk via-desk/40 to-desk" />
    </div>
  )
}
