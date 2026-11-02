import { describe, expect, it } from 'vitest'
import { lowerQuality, nextQuality, pixelRatioFor, startingQuality } from './quality'

describe('quality', () => {
  it('starts weak devices low and others at medium', () => {
    expect(startingQuality({ memory: 3, cores: 8, ratio: 3 })).toBe('low')
    expect(startingQuality({ memory: 8, cores: 4, ratio: 3 })).toBe('low')
    expect(startingQuality({ memory: 8, cores: 8, ratio: 3 })).toBe('medium')
    expect(startingQuality({ ratio: 2 })).toBe('medium')
  })

  it('caps pixel ratio by tier but never upscales', () => {
    expect(pixelRatioFor('low', 3)).toBe(1)
    expect(pixelRatioFor('high', 3)).toBe(2)
    expect(pixelRatioFor('high', 1)).toBe(1)
  })

  it('steps down and stops at low', () => {
    expect(lowerQuality('high')).toBe('medium')
    expect(lowerQuality('low')).toBe('low')
  })

  it('cycles through all tiers', () => {
    expect(nextQuality(nextQuality(nextQuality('low')))).toBe('low')
  })
})
