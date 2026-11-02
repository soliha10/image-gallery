import { describe, expect, it } from 'vitest'
import { botText } from './botText'

describe('botText', () => {
  it('answers in the sender’s language and falls back to Uzbek', () => {
    expect(botText('ru').added).toMatch(/галерею/)
    expect(botText('en').added).toMatch(/gallery/)
    expect(botText('uz').added).toMatch(/galereyangiz/)
    expect(botText('de').added).toBe(botText(undefined).added)
    expect(botText(undefined).added).toBe(botText('uz').added)
  })

  it('has every message in all three languages', () => {
    const keys = Object.keys(botText('uz')).sort()
    expect(Object.keys(botText('ru')).sort()).toEqual(keys)
    expect(Object.keys(botText('en')).sort()).toEqual(keys)
  })
})
