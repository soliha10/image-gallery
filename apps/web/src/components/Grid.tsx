import { photoUrl, type Photo } from '@gallery/shared'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { Blur } from './Blur'

function Tile({ photo, onOpen }: { photo: Photo; onOpen: (el: HTMLElement) => void }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <button
      onClick={(event) => onOpen(event.currentTarget)}
      aria-label={photo.title}
      className="relative block w-full overflow-hidden rounded-lg bg-surface"
      style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
    >
      <Blur hash={photo.blurhash} className="absolute inset-0 size-full" />
      <picture>
        <source type="image/avif" srcSet={`${photoUrl(photo, 400, 'avif')} 400w, ${photoUrl(photo, 800, 'avif')} 800w`} sizes="50vw" />
        <img
          src={photoUrl(photo, 400)}
          srcSet={`${photoUrl(photo, 400)} 400w, ${photoUrl(photo, 800)} 800w`}
          sizes="50vw"
          alt={photo.title}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      </picture>
    </button>
  )
}

export function Grid() {
  const photos = useStore((s) => s.photos)
  const openLightbox = useStore((s) => s.openLightbox)
  const loadMore = useStore((s) => s.loadMore)
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = sentinel.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && void loadMore(), { rootMargin: '600px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [loadMore])

  // Greedy shortest-column placement keeps the masonry balanced and stable while paging.
  const columns = useMemo(() => {
    const result: { items: { photo: Photo; index: number }[]; height: number }[] = [
      { items: [], height: 0 },
      { items: [], height: 0 },
    ]
    photos.forEach((photo, index) => {
      const column = result[0]!.height <= result[1]!.height ? result[0]! : result[1]!
      column.items.push({ photo, index })
      column.height += photo.height / photo.width
    })
    return result
  }, [photos])

  return (
    <div className="scroll-area no-scrollbar absolute inset-0 bg-bg px-3 pt-[calc(var(--safe-top)+64px)] pb-[calc(var(--safe-bottom)+96px)]">
      <div className="flex items-start gap-2">
        {columns.map((column, c) => (
          <div key={c} className="flex min-w-0 flex-1 flex-col gap-2">
            {column.items.map(({ photo, index }) => (
              <Tile
                key={photo.id}
                photo={photo}
                onOpen={(element) => {
                  const { left, top, width, height } = element.getBoundingClientRect()
                  openLightbox(photos, index, { left, top, width, height })
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div ref={sentinel} className="h-1" />
    </div>
  )
}
