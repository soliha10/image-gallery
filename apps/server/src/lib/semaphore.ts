/** Caps how many jobs run at once; the rest wait their turn in arrival order. */
export class Semaphore {
  private active = 0
  private readonly waiting: (() => void)[] = []

  constructor(private readonly limit: number) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.active++
    try {
      return await job()
    } finally {
      this.active--
      this.waiting.shift()?.()
    }
  }
}
