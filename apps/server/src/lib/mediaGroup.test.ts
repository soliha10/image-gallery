import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaGroupCollector } from './mediaGroup'

describe('MediaGroupCollector', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('flushes all items once after the quiet period', () => {
    const flush = vi.fn()
    const collector = new MediaGroupCollector<number>(1000, flush)
    collector.add({ groupId: 'a', item: 1 })
    vi.advanceTimersByTime(900)
    collector.add({ groupId: 'a', item: 2 })
    vi.advanceTimersByTime(900)
    expect(flush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(flush).toHaveBeenCalledExactlyOnceWith('a', [1, 2])
  })

  it('keeps separate groups apart', () => {
    const flush = vi.fn()
    const collector = new MediaGroupCollector<number>(1000, flush)
    collector.add({ groupId: 'a', item: 1 })
    collector.add({ groupId: 'b', item: 2 })
    vi.advanceTimersByTime(1000)
    expect(flush).toHaveBeenCalledWith('a', [1])
    expect(flush).toHaveBeenCalledWith('b', [2])
  })
})
