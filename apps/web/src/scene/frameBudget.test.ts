import { describe, expect, it } from 'vitest'
import { FrameBudget } from './frameBudget'

const run = (budget: FrameBudget, delta: number, frames = 90) => {
  let verdict = null
  for (let i = 0; i < frames; i++) verdict = budget.sample(delta) ?? verdict
  return verdict
}

describe('FrameBudget', () => {
  it('classifies sustained frame rates', () => {
    expect(run(new FrameBudget(), 1 / 60)).toBe('ok')
    expect(run(new FrameBudget(), 1 / 20, 180)).toBe('slow')
    expect(run(new FrameBudget(), 1 / 10, 180)).toBe('unusable')
  })

  it('forgives one slow window', () => {
    const budget = new FrameBudget()
    expect(run(budget, 1 / 20)).toBeNull()
    expect(run(budget, 1 / 60)).toBe('ok')
    expect(run(budget, 1 / 20)).toBeNull()
  })

  it('ignores a long pause between frames', () => {
    const budget = new FrameBudget()
    run(budget, 1 / 60, 60)
    expect(budget.sample(5)).toBeNull()
    expect(run(budget, 1 / 60)).toBe('ok')
  })
})
