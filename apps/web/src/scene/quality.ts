export type Quality = 'low' | 'medium' | 'high'

const TIERS: Quality[] = ['low', 'medium', 'high']
const KEY = 'scene-quality'

interface Device {
  memory?: number
  cores?: number
  ratio: number
}

const LIMITS: Record<Quality, number> = { low: 1, medium: 1.5, high: 2 }

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
