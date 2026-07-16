import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { WatchFolder } from '../../src/shared/ipc-types'

function makeFolder(overrides?: Partial<WatchFolder>): WatchFolder {
  return {
    id: 'w1',
    path: '/watch/dir',
    enabled: 1,
    addedAt: 0,
    ...overrides
  }
}

const fakeWatcher = Object.assign(new EventEmitter(), {
  close: vi.fn().mockResolvedValue(undefined),
  getWatched: vi.fn().mockReturnValue({}),
  add: vi.fn()
})

let watchMockFn: ReturnType<typeof vi.fn>

vi.mock('chokidar', () => {
  watchMockFn = vi.fn(() => fakeWatcher)
  return {
    default: { watch: watchMockFn },
    watch: watchMockFn
  }
})

let _existsValue = true

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  const mockExists = vi.fn(() => _existsValue)
  return {
    ...actual,
    default: { ...(actual.default as Record<string, unknown>), existsSync: mockExists },
    existsSync: mockExists
  }
})

vi.mock('../../src/main/services/logger', () => ({
  default: {},
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

let createWatcher: typeof import('../../src/main/services/watcher').createWatcher

describe('createWatcher', () => {
  let importFiles: ReturnType<typeof vi.fn>
  let getLibraryFolder: ReturnType<typeof vi.fn>
  let w: ReturnType<typeof createWatcher>

  beforeEach(async () => {
    vi.clearAllMocks()
    fakeWatcher.removeAllListeners()
    _existsValue = true
    importFiles = vi.fn().mockResolvedValue(undefined)
    getLibraryFolder = vi.fn().mockReturnValue('/lib')

    const mod = await import('../../src/main/services/watcher')
    createWatcher = mod.createWatcher
    w = createWatcher({ importFiles, getLibraryFolder })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('start(folderPath)', () => {
    it('passes correct chokidar options', () => {
      w.start(makeFolder({ path: '/watch/dir' }))

      expect(watchMockFn).toHaveBeenCalledWith('/watch/dir', expect.objectContaining({
        depth: 20,
        awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }
      }))
    })

    it('ignores non-PDF files but allows directories via ignored callback', () => {
      w.start(makeFolder())

      const opts = watchMockFn.mock.calls[0]?.[1]
      expect(opts?.ignored('/watch/dir/readme.txt')).toBe(true)
      expect(opts?.ignored('/watch/dir/notes.md')).toBe(true)
      expect(opts?.ignored('/watch/dir/doc.pdf')).toBe(false)
      expect(opts?.ignored('/watch/dir/UPPERCASE.PDF')).toBe(false)
      expect(opts?.ignored('/watch/dir/subfolder')).toBe(false)
    })

    it('excludes library folder via ignored callback', () => {
      getLibraryFolder.mockReturnValue('/data/lib')
      w.start(makeFolder())

      const opts = watchMockFn.mock.calls[0]?.[1]
      expect(opts?.ignored('/data/lib/some.pdf')).toBe(true)
      expect(opts?.ignored('/data/lib/nested/file.pdf')).toBe(true)
      expect(opts?.ignored('/watch/dir/file.pdf')).toBe(false)
    })

    it('skips nonexistent folder path', () => {
      _existsValue = false
      w.start(makeFolder({ path: '/nonexistent' }))

      expect(watchMockFn).not.toHaveBeenCalled()
    })

    it('prevents duplicate start for same watch folder id', () => {
      w.start(makeFolder({ id: 'dup', path: '/same' }))
      const callCount = watchMockFn.mock.calls.length

      w.start(makeFolder({ id: 'dup', path: '/same' }))

      expect(watchMockFn.mock.calls.length).toBe(callCount)
    })
  })

  describe('add events', () => {
    it('debounces add events and calls importFiles after window', () => {
      vi.useFakeTimers()
      w.start(makeFolder({ path: '/watch/dir' }))

      fakeWatcher.emit('add', '/watch/dir/new.pdf')

      expect(importFiles).not.toHaveBeenCalled()

      vi.advanceTimersByTime(500)

      expect(importFiles).toHaveBeenCalledTimes(1)
      expect(importFiles).toHaveBeenCalledWith(['/watch/dir/new.pdf'], true)
    })

    it('batches multiple add events into single importFiles call', () => {
      vi.useFakeTimers()
      w.start(makeFolder())

      fakeWatcher.emit('add', '/watch/dir/a.pdf')
      vi.advanceTimersByTime(100)
      fakeWatcher.emit('add', '/watch/dir/b.pdf')
      vi.advanceTimersByTime(100)
      fakeWatcher.emit('add', '/watch/dir/c.pdf')

      expect(importFiles).not.toHaveBeenCalled()

      vi.advanceTimersByTime(500)

      expect(importFiles).toHaveBeenCalledTimes(1)
      expect(importFiles).toHaveBeenCalledWith([
        '/watch/dir/a.pdf',
        '/watch/dir/b.pdf',
        '/watch/dir/c.pdf'
      ], true)
    })

    it('resets debounce timer on each new add', () => {
      vi.useFakeTimers()
      w.start(makeFolder())

      fakeWatcher.emit('add', '/watch/dir/first.pdf')
      vi.advanceTimersByTime(400)
      fakeWatcher.emit('add', '/watch/dir/second.pdf')

      vi.advanceTimersByTime(400)
      expect(importFiles).not.toHaveBeenCalled()

      vi.advanceTimersByTime(100)

      expect(importFiles).toHaveBeenCalledTimes(1)
      expect(importFiles).toHaveBeenCalledWith([
        '/watch/dir/first.pdf',
        '/watch/dir/second.pdf'
      ], true)
    })
  })

  describe('ignored events', () => {
    it('ignores change events on PDF files', () => {
      vi.useFakeTimers()
      w.start(makeFolder())

      fakeWatcher.emit('change', '/watch/dir/modified.pdf')

      vi.advanceTimersByTime(1000)
      expect(importFiles).not.toHaveBeenCalled()
    })

    it('ignores unlink events on PDF files', () => {
      vi.useFakeTimers()
      w.start(makeFolder())

      fakeWatcher.emit('unlink', '/watch/dir/deleted.pdf')

      vi.advanceTimersByTime(1000)
      expect(importFiles).not.toHaveBeenCalled()
    })
  })

  describe('error events', () => {
    it('logs Error and non-Error watcher failures', async () => {
      const { logger } = await import('../../src/main/services/logger')
      w.start(makeFolder())

      fakeWatcher.emit('error', new Error('watch failed'))
      fakeWatcher.emit('error', 'watch stopped')

      expect(logger.error).toHaveBeenNthCalledWith(1, 'watch:error /watch/dir: watch failed')
      expect(logger.error).toHaveBeenNthCalledWith(2, 'watch:error /watch/dir: watch stopped')
    })
  })

  describe('lifecycle', () => {
    it('stop closes the watcher and removes from internal map', () => {
      w.start(makeFolder({ id: 'w1' }))

      w.stop('w1')

      expect(fakeWatcher.close).toHaveBeenCalled()
    })

    it('stop is no-op for unknown id', () => {
      w.stop('nonexistent')

      expect(fakeWatcher.close).not.toHaveBeenCalled()
    })

    it('startAll starts watchers for all enabled folders', () => {
      w.startAll([
        makeFolder({ id: 'a', path: '/a' }),
        makeFolder({ id: 'b', path: '/b' })
      ])

      expect(watchMockFn).toHaveBeenCalledTimes(2)
      expect(watchMockFn).toHaveBeenCalledWith('/a', expect.any(Object))
      expect(watchMockFn).toHaveBeenCalledWith('/b', expect.any(Object))
    })

    it('destroy stops all active watchers', () => {
      w.start(makeFolder({ id: 'x' }))
      w.start(makeFolder({ id: 'y', path: '/other' }))

      w.destroy()

      expect(fakeWatcher.close).toHaveBeenCalledTimes(2)
    })
  })

  describe('library folder watcher', () => {
    it('startLibraryWatcher watches the library folder and imports added PDFs', () => {
      vi.useFakeTimers()
      w.startLibraryWatcher('/lib')

      expect(watchMockFn).toHaveBeenCalledWith('/lib', expect.any(Object))

      fakeWatcher.emit('add', '/lib/new.pdf')
      vi.advanceTimersByTime(500)

      expect(importFiles).toHaveBeenCalledWith(['/lib/new.pdf'], true)
    })

    it('startLibraryWatcher restarts when folder changes', () => {
      w.startLibraryWatcher('/lib')
      const firstCall = watchMockFn.mock.calls.length

      w.startLibraryWatcher('/newlib')

      expect(watchMockFn.mock.calls.length).toBeGreaterThan(firstCall)
      expect(watchMockFn).toHaveBeenCalledWith('/newlib', expect.any(Object))
      expect(fakeWatcher.close).toHaveBeenCalled()
    })

    it('startLibraryWatcher is a no-op when same folder already watched', () => {
      w.startLibraryWatcher('/lib')
      const callCount = watchMockFn.mock.calls.length

      w.startLibraryWatcher('/lib')

      expect(watchMockFn.mock.calls.length).toBe(callCount)
    })

    it('stopLibraryWatcher closes the library watcher', () => {
      w.startLibraryWatcher('/lib')

      w.stopLibraryWatcher()

      expect(fakeWatcher.close).toHaveBeenCalled()
    })

    it('destroy stops the library watcher too', () => {
      w.startLibraryWatcher('/lib')

      w.destroy()

      expect(fakeWatcher.close).toHaveBeenCalled()
    })
  })
})
