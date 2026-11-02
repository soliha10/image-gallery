import type { Rect } from '../lib/store'

/** Lets the DOM lightbox ask the scene for a painting's on-screen position. */
export const sceneBridge: {
  rectFor: ((index: number) => Rect | null) | null
} = { rectFor: null }
