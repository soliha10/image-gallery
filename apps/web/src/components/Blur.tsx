import { decode } from 'blurhash'
import { useEffect, useRef } from 'react'

export function Blur({ hash, className }: { hash: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = ref.current?.getContext('2d')
    if (!context) return
    const image = context.createImageData(24, 24)
    image.data.set(decode(hash, 24, 24))
    context.putImageData(image, 0, 0)
  }, [hash])
  return <canvas ref={ref} width={24} height={24} className={className} aria-hidden />
}
