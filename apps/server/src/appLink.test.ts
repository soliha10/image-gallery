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
