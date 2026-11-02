const WINDOW = 90
const PAUSE_GAP = 0.25
const SLOW_FPS = 26
const UNUSABLE_FPS = 13

export type Verdict = 'ok' | 'slow' | 'unusable' | null

/**
 * Judges sustained frame rate over a window. Gaps from a paused render loop (lightbox,
 * app in background) are ignored so returning from a pause never reads as slowness.
 */
export class FrameBudget {
  private frames = 0
  private elapsed = 0

  sample(delta: number): Verdict {
    if (delta > PAUSE_GAP) {
      this.frames = this.elapsed = 0
      return null
    }
    this.frames++
    this.elapsed += delta
    if (this.frames < WINDOW) return null
    const fps = this.frames / this.elapsed
    this.frames = this.elapsed = 0
    return fps < UNUSABLE_FPS ? 'unusable' : fps < SLOW_FPS ? 'slow' : 'ok'
  }
}
