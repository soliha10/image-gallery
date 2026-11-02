import { normalizeAppLink } from '@gallery/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('normalizeAppLink', () => {
  it('accepts the link however it was typed', () => {
    for (const typed of [
      't.me/rasmgalereya_bot/Gallery',
      ' https://t.me/rasmgalereya_bot/Gallery ',
      'https://t.me/rasmgalereya_bot/Gallery/',
      'https://t.me/rasmgalereya_bot/Gallery?startapp=old',
    ]) {
      expect(normalizeAppLink(typed)).toBe('https://t.me/rasmgalereya_bot/Gallery')
    }
  })

  it('gives null for nothing or something that is not a web link', () => {
    for (const bad of [undefined, null, '', '   ', 'http://t.me/x/y', 'not a link', 'ftp://t.me/x']) {
      expect(normalizeAppLink(bad)).toBeNull()
    }
  })
})

describe('server start', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('starts with the link exactly as it was typed on Render', async () => {
    vi.stubEnv('VITE_TG_APP_LINK', 't.me/rasmgalereya_bot/Gallery')
    const { appLinkBase } = await import('./env')
    expect(appLinkBase).toBe('https://t.me/rasmgalereya_bot/Gallery')
  })

  it('still starts when the link is unusable, with sharing off', async () => {
    vi.stubEnv('VITE_TG_APP_LINK', 'not a link')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { appLinkBase } = await import('./env')
    expect(appLinkBase).toBeNull()
    expect(warn).toHaveBeenCalled()
  })
})

describe('webhook secret', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('turns a generated secret with + / = into one Telegram accepts, the same every start', async () => {
    vi.stubEnv('BOT_WEBHOOK_SECRET', 'Ab+c/d=e==')
    const first = (await import('./env')).webhookSecret
    vi.resetModules()
    const second = (await import('./env')).webhookSecret
    expect(first).toMatch(/^[A-Za-z0-9_-]{1,256}$/)
    expect(first).toBe(second)
  })

  it('keeps a secret that is already valid', async () => {
    vi.stubEnv('BOT_WEBHOOK_SECRET', 'plain_secret-123')
    expect((await import('./env')).webhookSecret).toBe('plain_secret-123')
  })
})

describe('gallery start parameter', () => {
  it('round-trips a gallery link with and without an album, within Telegram’s 64 characters', async () => {
    const { galleryStartParam, parseGalleryStart } = await import('@gallery/shared')
    const token = 'Rz82yi70k1CVqB75fX4-fw'
    const album = '0f8fad5b-d9cb-469f-a165-70867728950e'
    expect(parseGalleryStart(galleryStartParam(token))).toEqual({ token, albumId: null })
    const withAlbum = galleryStartParam(token, album)
    expect(withAlbum.length).toBeLessThanOrEqual(64)
    expect(parseGalleryStart(withAlbum)).toEqual({ token, albumId: album })
  })

  it('ignores anything that is not a gallery link', async () => {
    const { parseGalleryStart } = await import('@gallery/shared')
    for (const param of ['', 'photo_abc', 'g_short', `g_${'a'.repeat(30)}`, `g_${'!'.repeat(22)}`]) expect(parseGalleryStart(param)).toBeNull()
  })
})
