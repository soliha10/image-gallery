import { photoUrl, type Photo } from '@gallery/shared'
import { useGesture } from '@use-gesture/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n'
import { backButton, downloadPhoto, haptic, sharePhoto } from '../lib/telegram'
import { useStore, type Rect } from '../lib/store'
import { sceneBridge } from '../scene/bridge'
import { Blur } from './Blur'
import { CloseIcon, DownloadIcon, HeartIcon, ShareIcon } from './icons'

const EASE = 'cubic-bezier(0.22, 0.8, 0.2, 1)'
const MAX_SCALE = 4

function fitted(photo: Photo): Rect {
  const scale = Math.min(innerWidth / photo.width, innerHeight / photo.height)
  const width = photo.width * scale
  const height = photo.height * scale
  return { left: (innerWidth - width) / 2, top: (innerHeight - height) / 2, width, height }
}

const transformFrom = (from: Rect, to: Rect) => {
  const scale = from.width / to.width
  const x = from.left + from.width / 2 - (to.left + to.width / 2)
  const y = from.top + from.height / 2 - (to.top + to.height / 2)
  return `translate(${x}px, ${y}px) scale(${scale})`
}

function Slide({ photo, offset }: { photo: Photo; offset: number }) {
  const [sharp, setSharp] = useState(false)
  const box = fitted(photo)
  return (
    <div
      className="absolute"
      style={{ left: box.left + offset * innerWidth, top: box.top, width: box.width, height: box.height }}
    >
      <Blur hash={photo.blurhash} className="absolute inset-0 size-full" />
      <img src={photoUrl(photo, 400)} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
      {offset === 0 && (
        <picture>
          <source type="image/avif" srcSet={photoUrl(photo, 1600, 'avif')} />
          <img
            src={photoUrl(photo, 1600)}
            alt={photo.title}
            draggable={false}
            onLoad={() => setSharp(true)}
            className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${sharp ? 'opacity-100' : 'opacity-0'}`}
          />
        </picture>
      )}
    </div>
  )
}

export function Lightbox() {
  const lightbox = useStore((s) => s.lightbox)!
  const closeLightbox = useStore((s) => s.closeLightbox)
  const setLightboxIndex = useStore((s) => s.setLightboxIndex)
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const view = useStore((s) => s.view)
  const favorites = useStore((s) => s.me?.favoriteIds)

  const { photos, index } = lightbox
  const photo = photos[index]!
  const liked = favorites?.includes(photo.id) ?? false

  const stage = useRef<HTMLDivElement>(null)
  const backdrop = useRef<HTMLDivElement>(null)
  const [chrome, setChrome] = useState(true)
  const [closing, setClosing] = useState(false)
  const zoom = useRef({ scale: 1, x: 0, y: 0 })

  const apply = (transform: string, transition = false) => {
    if (!stage.current) return
    stage.current.style.transition = transition ? `transform .28s ${EASE}` : 'none'
    stage.current.style.transform = transform
  }
  const applyZoom = (transition = false) => {
    const { scale, x, y } = zoom.current
    apply(`translate(${x}px, ${y}px) scale(${scale})`, transition)
  }

  useLayoutEffect(() => {
    const from = lightbox.from
    const element = stage.current
    if (!from || !element) return
    element.animate(
      [{ transform: transformFrom(from, fitted(photo)), offset: 0 }, { transform: 'none' }],
      { duration: 340, easing: EASE },
    )
    backdrop.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 })
    // Runs once for the photo that was tapped.
  }, [])

  const close = useCallback(() => {
    if (closing) return
    setClosing(true)
    const inRoom = view === 'room'
    const target = inRoom ? sceneBridge.rectFor?.(index) : lightbox.from
    const element = stage.current
    if (!target || !element) {
      closeLightbox()
      return
    }
    backdrop.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, fill: 'forwards' })
    const animation = element.animate(
      [{ transform: element.style.transform || 'none' }, { transform: transformFrom(target, fitted(photo)) }],
      { duration: 300, easing: EASE, fill: 'forwards' },
    )
    animation.onfinish = closeLightbox
  }, [closeLightbox, closing, index, lightbox.from, photo, view])

  useEffect(() => backButton(close), [close])

  const go = (delta: number) => {
    const next = index + delta
    if (next < 0 || next >= photos.length) {
      apply('none', true)
      return
    }
    haptic.select()
    apply(`translateX(${-delta * innerWidth}px)`, true)
    window.setTimeout(() => {
      zoom.current = { scale: 1, x: 0, y: 0 }
      apply('none')
      setLightboxIndex(next)
    }, 240)
  }

  const bind = useGesture(
    {
      onDrag({ movement: [mx, my], offset, last, tap, swipe: [sx], pinching, cancel, memo }) {
        if (pinching) return cancel()
        if (tap) return
        void offset
        if (zoom.current.scale > 1) {
          const start = (memo as { x: number; y: number } | undefined) ?? { x: zoom.current.x, y: zoom.current.y }
          zoom.current.x = start.x + mx
          zoom.current.y = start.y + my
          applyZoom()
          return start
        }
        const vertical = Math.abs(my) > Math.abs(mx)
        if (last) {
          if (vertical && my > 110) close()
          else if (!vertical && (sx !== 0 || Math.abs(mx) > innerWidth * 0.3)) go(mx < 0 ? 1 : -1)
          else apply('none', true)
          if (backdrop.current) backdrop.current.style.opacity = '1'
          return
        }
        if (vertical && my > 0) {
          apply(`translateY(${my}px) scale(${1 - Math.min(my / 1500, 0.2)})`)
          if (backdrop.current) backdrop.current.style.opacity = String(1 - Math.min(my / 420, 0.8))
        } else if (!vertical) {
          apply(`translateX(${mx}px)`)
        }
      },
      onPinch({ offset: [scale], last }) {
        zoom.current.scale = scale
        if (last && scale <= 1.02) zoom.current = { scale: 1, x: 0, y: 0 }
        applyZoom(last)
      },
    },
    {
      drag: { filterTaps: true, pointer: { touch: true } },
      pinch: { scaleBounds: { min: 1, max: MAX_SCALE }, rubberband: true, from: () => [zoom.current.scale, 0] },
    },
  )

  const lastTap = useRef(0)
  const onTap = () => {
    const now = performance.now()
    if (now - lastTap.current < 280) {
      zoom.current = zoom.current.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.4, x: 0, y: 0 }
      applyZoom(true)
      haptic.soft()
      lastTap.current = 0
    } else {
      lastTap.current = now
      window.setTimeout(() => {
        if (lastTap.current === now) setChrome((value) => !value)
      }, 290)
    }
  }

  const neighbours = [index - 1, index, index + 1].filter((i) => i >= 0 && i < photos.length)

  return (
    <div className="fixed inset-0 z-40 touch-none overflow-hidden select-none" role="dialog" aria-modal aria-label={photo.title}>
      <div ref={backdrop} className="absolute inset-0 bg-black" />
      <div {...bind()} onClick={onTap} className="absolute inset-0">
        <div ref={stage} className="absolute inset-0 will-change-transform">
          {neighbours.map((i) => (
            <Slide key={photos[i]!.id} photo={photos[i]!} offset={i - index} />
          ))}
        </div>
      </div>

      <div className={`transition-opacity duration-200 ${chrome && !closing ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        <div className="pad-top absolute inset-x-0 top-0 flex justify-end bg-gradient-to-b from-black/60 to-transparent px-3 pb-8">
          <button onClick={close} aria-label={t.close} className="flex size-11 items-center justify-center text-white">
            <CloseIcon />
          </button>
        </div>
        <div className="pad-bottom absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-5 pt-14 text-white">
          <h2 className="font-display text-xl leading-snug font-semibold">{photo.title}</h2>
          {(photo.description || photo.credit) && (
            <p className="mt-1 line-clamp-3 text-sm text-white/70">
              {[photo.credit, photo.description].filter(Boolean).join(' · ')}
            </p>
          )}
          <div className="mt-3 -ml-2.5 flex gap-1">
            <button
              onClick={() => {
                toggleFavorite(photo.id)
                haptic.tap()
              }}
              aria-label={liked ? t.unlike : t.like}
              aria-pressed={liked}
              className={`flex size-11 items-center justify-center ${liked ? 'text-gold' : ''}`}
            >
              <HeartIcon filled={liked} />
            </button>
            <button onClick={() => sharePhoto(photo.id, photo.title)} aria-label={t.share} className="flex size-11 items-center justify-center">
              <ShareIcon />
            </button>
            <button
              onClick={() => downloadPhoto(`${photo.base}/full.jpg`, `${photo.title || 'photo'}.jpg`)}
              aria-label={t.download}
              className="flex size-11 items-center justify-center"
            >
              <DownloadIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
