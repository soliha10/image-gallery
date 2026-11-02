import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { packId, unpackId } from './compactId'
import { Semaphore } from './semaphore'

describe('packId', () => {
  it('round-trips any uuid in 22 characters', () => {
    for (let i = 0; i < 50; i++) {
      const id = randomUUID()
      const packed = packId(id)
      expect(packed).toHaveLength(22)
      expect(unpackId(packed)).toBe(id)
    }
  })

  it('fits two ids and a prefix in Telegram’s 64-byte callback data', () => {
    expect(`mv:${packId(randomUUID())}:${packId(randomUUID())}`.length).toBeLessThanOrEqual(64)
  })

  it('rejects anything that is not a packed id', () => {
    expect(unpackId('short')).toBeNull()
    expect(unpackId('!'.repeat(22))).toBeNull()
  })
})

describe('Semaphore', () => {
  it('never runs more jobs than its limit and finishes them all', async () => {
    const gate = new Semaphore(2)
    let running = 0
    let peak = 0
    const job = () =>
      gate.run(async () => {
        running++
        peak = Math.max(peak, running)
        await new Promise((resolve) => setTimeout(resolve, 5))
        running--
        return 1
      })
    const results = await Promise.all(Array.from({ length: 7 }, job))
    expect(results).toHaveLength(7)
    expect(peak).toBe(2)
  })

  it('frees its slot when a job fails', async () => {
    const gate = new Semaphore(1)
    await expect(gate.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x')
    await expect(gate.run(async () => 'next')).resolves.toBe('next')
  })
})
