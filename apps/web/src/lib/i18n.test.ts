import { describe, expect, it, vi } from 'vitest'

vi.mock('./telegram', () => ({ userLanguage: () => 'ru' }))

// Web tests run in Node, so the two browser objects i18n touches are stood in for.
const saved = new Map<string, string>()
vi.stubGlobal('document', { documentElement: { lang: '' } })
vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) })

describe('i18n', () => {
  it('starts in the Telegram language and switches every label in place', async () => {
    const { t, setLanguage } = await import('./i18n')
    expect(t.search).toBe('Поиск')
    setLanguage('en')
    expect(t.search).toBe('Search')
    expect(t.sharedGallery('Ali')).toBe('Ali’s gallery')
    setLanguage('uz')
    expect(t.search).toBe('Qidiruv')
    expect(document.documentElement.lang).toBe('uz')
    expect(saved.get('language')).toBe('uz')
  })
})
