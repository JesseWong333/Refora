import { vi } from 'vitest'
import { EventEmitter } from 'node:events'

export function mockChokidar() {
  const fakeWatcher = Object.assign(new EventEmitter(), {
    close: vi.fn().mockResolvedValue(undefined),
    getWatched: vi.fn().mockReturnValue({}),
    add: vi.fn()
  })
  vi.mock('chokidar', () => ({
    default: { watch: vi.fn(() => fakeWatcher) },
    watch: vi.fn(() => fakeWatcher)
  }))
  return fakeWatcher
}
