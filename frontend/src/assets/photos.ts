/**
 * Licensed photography registry. All images are free to use under the Unsplash License
 * (https://unsplash.com/license) — verified on each photo page. Credits are kept here so
 * they can be shown in an "Image credits" section of the public site later.
 *
 * Images are served from Unsplash's CDN with on-the-fly resizing (w / q / fm=auto → AVIF/WebP).
 */
export type PhotoAsset = {
  id: string
  /** images.unsplash.com base URL without query */
  src: string
  photographer: string
  page: string
  /** dominant tone, shown while loading and if every source fails */
  placeholder: string
}

export const photos = {
  libraryWarmLight: {
    id: 'cnRuUMK9EWI',
    src: 'https://images.unsplash.com/photo-1761834520785-ca17a0275f6d',
    photographer: 'Karwin Luo',
    page: 'https://unsplash.com/photos/cnRuUMK9EWI',
    placeholder: '#3a2a1c',
  },
  lawBooksShelf: {
    id: 'M5qjJS5c4O4',
    src: 'https://images.unsplash.com/photo-1511128250269-e45d82f3893e',
    photographer: 'Mark Weaver',
    page: 'https://unsplash.com/photos/M5qjJS5c4O4',
    placeholder: '#2e2a22',
  },
  lawAndRightsBooks: {
    id: 'oQWCAU-JLHI',
    src: 'https://images.unsplash.com/photo-1752697589128-f8e110a86af3',
    photographer: 'Krists Luhaers',
    page: 'https://unsplash.com/photos/oQWCAU-JLHI',
    placeholder: '#2b2f28',
  },
} satisfies Record<string, PhotoAsset>

const WIDTHS = [640, 960, 1280, 1600, 2000] as const

export const photoUrl = (photo: PhotoAsset, width: number) =>
  `${photo.src}?auto=format&fit=crop&w=${width}&q=75`

export const photoSrcSet = (photo: PhotoAsset) =>
  WIDTHS.map((width) => `${photoUrl(photo, width)} ${width}w`).join(', ')
