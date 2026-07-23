let lastRequestAt: number | null = null
let gateTail: Promise<void> = Promise.resolve()
let generation = 0

export async function waitForArxivRateLimit(): Promise<void> {
  const currentGeneration = generation
  const turn = gateTail.then(async () => {
    if (currentGeneration !== generation) return

    const now = Date.now()
    if (lastRequestAt !== null && now >= lastRequestAt) {
      const remaining = 3000 - (now - lastRequestAt)
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining))
      }
    }

    if (currentGeneration !== generation) return
    lastRequestAt = Date.now()
  })
  gateTail = turn.catch(() => undefined)
  await turn
}

export function resetArxivRateLimitForTests(): void {
  generation += 1
  lastRequestAt = null
  gateTail = Promise.resolve()
}
