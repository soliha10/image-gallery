import { describe, expect, it } from 'vitest'
import { botText } from './botText'

describe('botText', () => {
  it('answers in the sender’s language and falls back to Uzbek', () => {
    expect(botText('ru').added('')).toMatch(/галерею/)
    expect(botText('en').added('')).toMatch(/gallery/)
    expect(botText('uz').added('')).toMatch(/galereyangiz/)
    expect(botText('de')).toBe(botText(undefined))
    expect(botText(undefined)).toBe(botText('uz'))
  })

  it('escapes photo titles for HTML replies', () => {
    expect(botText('en').added('<b>&')).toBe('✅ “&lt;b&gt;&amp;” added to your gallery.')
  })

  it('has every message and command in all three languages', () => {
    const keys = Object.keys(botText('uz')).sort()
    expect(Object.keys(botText('ru')).sort()).toEqual(keys)
    expect(Object.keys(botText('en')).sort()).toEqual(keys)
    const commands = Object.keys(botText('uz').commands)
    expect(Object.keys(botText('ru').commands)).toEqual(commands)
    expect(Object.keys(botText('en').commands)).toEqual(commands)
  })
})
