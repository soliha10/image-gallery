import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { processImage, sniffImage, UnsupportedImageError } from './image'

const jpeg = () =>
  sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#c86' } })
    .withExif({ IFD0: { Copyright: 'secret-gps-marker' } })
    .jpeg()
    .toBuffer()

describe('sniffImage', () => {
  it('detects by content, not by name', async () => {
    expect(sniffImage(await jpeg())).toBe('jpeg')
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
  })
})

describe('processImage', () => {
  it('produces every size and strips metadata', async () => {
    const result = await processImage(await jpeg())
    expect(result.files.map((f) => f.name).sort()).toEqual(
      ['1600.avif', '1600.webp', '400.avif', '400.webp', '800.avif', '800.webp', 'full.jpg'].sort(),
    )
    expect(result.width / result.height).toBe(2)
    expect(result.blurhash.length).toBeGreaterThan(6)
    for (const file of result.files) {
      expect(file.body.includes('secret-gps-marker')).toBe(false)
    }
  })
  it('rejects non-images', async () => {
    await expect(processImage(Buffer.from('not an image at all'))).rejects.toBeInstanceOf(UnsupportedImageError)
  })
})
