import { IMAGE_WIDTHS } from '@gallery/shared'
import { encode } from 'blurhash'
import sharp from 'sharp'

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'avif'

/** Identifies an image from its magic bytes; never trust client-provided names or MIME types. */
export function sniffImage(b: Buffer): ImageKind | null {
  if (b.length < 12) return null
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (b.toString('latin1', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(b.toString('latin1', 8, 12))) return 'avif'
  return null
}

export interface ProcessedImage {
  width: number
  height: number
  blurhash: string
  files: { name: string; body: Buffer; contentType: string }[]
}

/** Output is re-encoded, so EXIF and GPS metadata from the source never reach storage. */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (!sniffImage(input)) throw new UnsupportedImageError()

  const source = sharp(input, { limitInputPixels: 100_000_000 }).rotate()
  const { data, info } = await source.clone().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).toBuffer({ resolveWithObject: true })

  const thumb = await sharp(data).resize(32, 32, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const blurhash = encode(new Uint8ClampedArray(thumb.data), thumb.info.width, thumb.info.height, 4, 3)

  const files: ProcessedImage['files'] = []
  await Promise.all(
    IMAGE_WIDTHS.map(async (width) => {
      const resized = sharp(data).resize({ width: Math.min(width, info.width) })
      files.push(
        { name: `${width}.webp`, body: await resized.clone().webp({ quality: 80 }).toBuffer(), contentType: 'image/webp' },
        { name: `${width}.avif`, body: await resized.clone().avif({ quality: 55, effort: 2 }).toBuffer(), contentType: 'image/avif' },
      )
    }),
  )
  files.push({
    name: 'full.jpg',
    body: await source.clone().resize(2560, 2560, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer(),
    contentType: 'image/jpeg',
  })

  return { width: info.width, height: info.height, blurhash, files }
}

export class UnsupportedImageError extends Error {
  constructor() {
    super('Unsupported image format')
  }
}
