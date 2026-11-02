import { describe, expect, it } from 'vitest'
import { angleAt, BENCH_RADIUS, indexForSlot, mod, resolve, SLOTS, slotOfIndex, VIEW_RADIUS, Walker, WALL_RADIUS, wrapAngle } from './walker'

const run = (walker: Walker, seconds: number, autopilot = false) => {
  for (let i = 0; i < seconds * 60; i++) walker.update(1 / 60, autopilot)
}

describe('resolve', () => {
  it('keeps points inside the wall', () => {
    const { x, z } = resolve(20, 0)
    expect(Math.hypot(x, z)).toBeLessThan(WALL_RADIUS - 0.5)
  })

  it('keeps points out of the bench, even its exact centre', () => {
    expect(Math.hypot(resolve(0.2, 0.1).x, resolve(0.2, 0.1).z)).toBeGreaterThan(BENCH_RADIUS)
    expect(Math.hypot(resolve(0, 0).x, resolve(0, 0).z)).toBeGreaterThan(BENCH_RADIUS)
  })
})

describe('free movement', () => {
  it('walks to a floor point and sits', () => {
    const walker = new Walker()
    walker.goTo(4, 3)
    run(walker, 8)
    expect(Math.hypot(walker.x - 4, walker.z - 3)).toBeLessThan(0.1)
    expect(walker.sit).toBeGreaterThan(0.8)
  })

  it('goes around the bench to reach the far side', () => {
    const walker = new Walker()
    walker.goTo(0, -6)
    let closest = Infinity
    for (let i = 0; i < 60 * 20; i++) {
      walker.update(1 / 60, false)
      closest = Math.min(closest, walker.radius)
    }
    expect(Math.hypot(walker.x, walker.z + 6)).toBeLessThan(0.1)
    expect(closest).toBeGreaterThan(BENCH_RADIUS)
  })

  it('can reach any point of the room with input alone and never leaves it', () => {
    const walker = new Walker()
    walker.inputX = 1
    walker.inputZ = 0.4
    run(walker, 10)
    expect(walker.radius).toBeLessThan(WALL_RADIUS - 0.5)
    expect(walker.radius).toBeGreaterThan(7.5)
    walker.inputX = -1
    walker.inputZ = -1
    run(walker, 10)
    expect(walker.radius).toBeLessThan(WALL_RADIUS - 0.5)
    expect(walker.radius).toBeGreaterThan(BENCH_RADIUS)
  })

  it('turns smoothly instead of snapping', () => {
    const walker = new Walker()
    walker.heading = 0
    walker.inputX = 1
    walker.update(1 / 60, false)
    walker.update(1 / 60, false)
    expect(Math.abs(walker.heading)).toBeLessThan(1)
    run(walker, 1)
    expect(wrapAngle(walker.heading - Math.PI / 2)).toBeCloseTo(0, 1)
  })

  it('counts laps in pos, so the gallery can keep going', () => {
    const walker = new Walker()
    for (let slot = 1; slot <= 30; slot += 2) {
      walker.visit(slot)
      run(walker, 4)
    }
    expect(walker.pos).toBeGreaterThan(SLOTS)
  })
})

describe('looking at paintings', () => {
  it('sits facing the frame it was sent to', () => {
    const walker = new Walker()
    walker.visit(5, true)
    run(walker, 10)
    const angle = angleAt(5)
    expect(walker.viewing).toBe(5)
    expect(Math.hypot(walker.x - Math.sin(angle) * VIEW_RADIUS, walker.z - Math.cos(angle) * VIEW_RADIUS)).toBeLessThan(0.1)
    expect(Math.abs(wrapAngle(walker.heading - angle))).toBeLessThan(0.05)
  })

  it('takes up a painting when stopping in front of it', () => {
    const walker = new Walker()
    walker.jumpTo(8)
    walker.goTo(walker.x * 0.99, walker.z * 0.99)
    run(walker, 2)
    expect(walker.viewing).toBe(8)
  })

  it('leaves a painting alone after free look until the cat moves again', () => {
    const walker = new Walker()
    walker.stopViewing()
    run(walker, 3)
    expect(walker.viewing).toBeNull()
  })

  it('skips empty frames', () => {
    const walker = new Walker()
    walker.filled = (slot) => slot % 6 === 0
    walker.startTour()
    run(walker, 9)
    expect(walker.viewing).toBe(6)
  })
})

describe('behaviour', () => {
  it('stays put without autopilot and falls asleep', () => {
    const walker = new Walker()
    run(walker, 60)
    expect(walker.sleep).toBeGreaterThan(0.9)
    expect(walker.viewing).toBe(0)
  })

  it('wanders after a long idle, and any input stops it at once', () => {
    const walker = new Walker()
    run(walker, 16.5, true)
    expect(walker.viewing).toBeNull()
    walker.inputX = 0.5
    walker.update(1 / 60, true)
    walker.inputX = 0
    const { x, z } = walker
    run(walker, 1, true)
    expect(Math.hypot(walker.x - x, walker.z - z)).toBeLessThan(0.5)
  })

  it('tours painting by painting until interrupted', () => {
    const walker = new Walker()
    walker.startTour()
    run(walker, 25)
    expect(walker.nearestSlot).toBeGreaterThan(1)
    walker.inputZ = 1
    walker.update(1 / 60, false)
    expect(walker.touring).toBe(false)
  })
})

describe('frames', () => {
  it('shows the walk index nearest the cat', () => {
    expect(indexForSlot(30, 7, 100)).toBe(31)
    expect(indexForSlot(0, 23, 100)).toBe(-1)
  })

  it('spreads few photos around the room without repeating any', () => {
    const shown = Array.from({ length: SLOTS }, (_, slot) => indexForSlot(0, slot, 5)).filter((i) => i !== null)
    expect(shown).toEqual([0, 1, 2, 3, 4])
  })

  it('finds the frame of a photo for any count', () => {
    for (const count of [1, 2, 5, 23, 24, 200]) {
      for (let index = 0; index < Math.min(count, 40); index++) {
        const slot = slotOfIndex(index, count)
        const shown = indexForSlot(slot, slot, count)
        expect(mod(shown!, count)).toBe(mod(index, Math.max(count, 1)) % (count >= SLOTS ? SLOTS : count))
      }
    }
  })

  it('shows nothing without photos', () => {
    expect(indexForSlot(0, 3, 0)).toBeNull()
  })
})
