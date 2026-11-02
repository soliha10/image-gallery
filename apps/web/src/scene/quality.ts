export type Quality = 'low' | 'medium' | 'high'

const TIERS: Quality[] = ['low', 'medium', 'high']
const KEY = 'scene-quality'

interface Device {
  memory?: number
  cores?: number
  ratio: number
}

const LIMITS: Record<Quality, number> = { low: 1, medium: 1.5, high: 2 }

export interface Effects {
  skySize: number
  stars: number
  nebulae: number
  asteroids: number
  shootingStars: boolean
  /** Star dust at the paws and the comet tail. */
  trail: boolean
  /** Drifting frames and motes around the camera. */
  drift: boolean
  textureWidth: 400 | 800
  antialias: boolean
}

export const EFFECTS: Record<Quality, Effects> = {
  low: { skySize: 1024, stars: 900, nebulae: 2, asteroids: 0, shootingStars: false, trail: false, drift: false, textureWidth: 400, antialias: false },
  medium: { skySize: 2048, stars: 2400, nebulae: 4, asteroids: 24, shootingStars: true, trail: true, drift: true, textureWidth: 800, antialias: true },
  high: { skySize: 2048, stars: 4200, nebulae: 5, asteroids: 48, shootingStars: true, trail: true, drift: true, textureWidth: 800, antialias: true },
}

/** Weak phones start low. Nothing starts high, which stays the viewer's own choice. */
export const startingQuality = ({ memory, cores }: Device): Quality =>
  (memory !== undefined && memory <= 4) || (cores !== undefined && cores <= 4) ? 'low' : 'medium'

export const pixelRatioFor = (quality: Quality, ratio: number) => Math.min(ratio, LIMITS[quality])

export const lowerQuality = (quality: Quality): Quality => TIERS[Math.max(TIERS.indexOf(quality) - 1, 0)]!

export const nextQuality = (quality: Quality): Quality => TIERS[(TIERS.indexOf(quality) + 1) % TIERS.length]!

export const device = (): Device => ({
  memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  cores: navigator.hardwareConcurrency,
  ratio: window.devicePixelRatio,
})

export function savedQuality(): Quality | null {
  try {
    const value = localStorage.getItem(KEY)
    return TIERS.includes(value as Quality) ? (value as Quality) : null
  } catch {
    return null
  }
}

export function saveQuality(quality: Quality) {
  try {
    localStorage.setItem(KEY, quality)
  } catch {
    // Private windows can refuse storage; the choice then lasts for this visit.
  }
}
