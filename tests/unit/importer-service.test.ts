import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'

const {
  mockExistsSync,
  mockStatSync,
  mockShowMessageBox,
  mockWebContentsSend,
  mockCopyToLibrary
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockStatSync: vi.fn(),
  mockShowMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
  mockWebContentsSend: vi.fn(),
  mockCopyToLibrary: vi.fn<[string, string], string>()
}))

vi.mock('node:fs', () => ({
  default: { existsSync: mockExistsSync, statSync: mockStatSync },
  existsSync: mockExistsSync,
  statSync: mockStatSync
}))

vi.mock('../../src/main/services/library', async () => {
  const actual = await vi.importActual<typeof import('../../src/main/services/library')>('../../src/main/services/library')
  return {
    ...actual,
    copyToLibrary: mockCopyToLibrary
  }
})

vi.mock('electron', () => ({
  dialog: { showMessageBox: mockShowMessageBox },
  utilityProcess: { fork: vi.fn() },
  BrowserWindow: class {
    webContents = { send: mockWebContentsSend }
    isDestroyed = () => false
  },
  app: {
    getPath: vi.fn((name: string) => `/fake/path/${name}`),
    getLocale: () => 'en',
    on: vi.fn(),
    whenReady: () => Promise.resolve(),
    isPackaged: false
  },
  shell: { openPath: vi.fn().mockResolvedValue(''), showItemInFolder: vi.fn() }
}))

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

import { utilityProcess, BrowserWindow } from 'electron'
import { runMigrations, type SqliteLike } from '../../src/main/db/migrations'
import { createRepositories } from '../../src/main/db/repositories'
import type { NewDocument } from '../../src/main/db/repositories/documents'
import { seedDefaultSettings } from '../../src/main/db/settings-seed'
import type { SqliteDb } from '../../src/main/db/types'
import { createImporter } from '../../src/main/services/importer'

const nodeRequire = createRequire(import.meta.url)
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (location: string) => unknown
}

interface RawStatement {
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
}
interface RawDb {
  exec(sql: string): void
  prepare(sql: string): RawStatement
}

function createDb(): RawDb {
  const db = new DatabaseSync(':memory:') as unknown as RawDb
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

function adapt(db: RawDb): SqliteLike {
  return {
    exec: (sql) => { db.exec(sql) },
    getUserVersion: () => {
      const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
      return row?.user_version ?? 0
    },
    setUserVersion: (version) => { db.exec(`PRAGMA user_version = ${version}`) }
  }
}

function makeDoc(id: string, overrides: Partial<NewDocument> = {}): NewDocument {
  return {
    id,
    filePath: `/abs/${id}.pdf`,
    originalFolderPath: '/abs',
    fileName: `${id}.pdf`,
    fileSize: 100,
    fileHash: null,
    title: `Title ${id}`,
    authors: null,
    year: null,
    venue: null,
    volume: null,
    abstract: null,
    keywords: null,
    url: null,
    doi: null,
    note: null,
    starred: 0,
    addedAt: 1000,
    lastReadAt: null,
    updatedAt: 1000,
    metadataSource: null,
    metadataStatus: 'pending',
    metadataAttempts: 0,
    editedFields: [],
    remoteValues: null,
    fileMissing: 0,
    ...overrides
  }
}

function getWorker() {
  return vi.mocked(utilityProcess.fork).mock.results.at(-1)?.value as
    | (EventEmitter & { kill: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> })
    | undefined
}

describe('createImporter', () => {
  let db: RawDb
  let repos: ReturnType<typeof createRepositories>
  let win: BrowserWindow
  let importer: ReturnType<typeof createImporter>

  beforeEach(() => {
    mockExistsSync.mockClear()
    mockStatSync.mockClear()
    mockShowMessageBox.mockClear()
    mockWebContentsSend.mockClear()
    mockCopyToLibrary.mockClear()
    vi.mocked(utilityProcess.fork).mockClear()

    db = createDb()
    runMigrations(adapt(db))
    seedDefaultSettings(adapt(db), 'en')
    repos = createRepositories(db as unknown as SqliteDb)
    repos.settings.set('libraryFolderPath', '/fake/library')

    mockExistsSync.mockReturnValue(true)
    mockStatSync.mockReturnValue({ isFile: () => true, size: 12345 } as ReturnType<typeof mockStatSync>)
    mockShowMessageBox.mockResolvedValue({ response: 0 })
    mockCopyToLibrary.mockImplementation((_src: string, lib: string) => `${lib}/imported.pdf`)

    vi.mocked(utilityProcess.fork).mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> }
      child.kill = vi.fn()
      child.postMessage = vi.fn()
      return child
    })

    win = new BrowserWindow() as unknown as BrowserWindow
    importer = createImporter(repos, win)
  })

  afterEach(() => {
    importer.destroy()
    vi.useRealTimers()
  })

  describe('importFiles — success path', () => {
    it('should import a single valid PDF and insert document', async () => {
      const promise = importer.importFiles(['/abs/test.pdf'], false)
      const worker = getWorker()
      expect(worker).toBeDefined()

      const correlationId = worker!.postMessage.mock.calls[0]![0].correlationId
      worker!.emit('message', {
        correlationId,
        fileHash: 'abc123',
        info: { title: 'Test' }
      })

      const result = await promise
      expect(result.added.length).toBe(1)
      expect(result.skipped).toEqual([])
      expect(result.errors).toEqual([])

      const doc = repos.documents.get(result.added[0]!)
      expect(doc).not.toBeNull()
      expect(doc!.fileHash).toBe('abc123')
      expect(doc!.title).toBeNull()
      expect(doc!.metadataStatus).toBe('pending')
      expect(doc!.filePath).toBe('/fake/library/imported.pdf')

      expect(mockWebContentsSend).toHaveBeenCalled()
    })

    it('should handle NULL hash from worker', async () => {
      const promise = importer.importFiles(['/abs/test.pdf'], false)
      const worker = getWorker()

      const correlationId = worker!.postMessage.mock.calls[0]![0].correlationId
      worker!.emit('message', {
        correlationId,
        fileHash: null,
        info: {}
      })

      const result = await promise
      expect(result.added.length).toBe(1)
      expect(result.errors).toEqual([])

      const doc = repos.documents.get(result.added[0]!)
      expect(doc!.fileHash).toBeNull()

      const hashDup = repos.documents.findByHash(null as unknown as string)
      expect(hashDup).toBeNull()
    })

    it('should emit import:complete event on success', async () => {
      const onComplete = vi.fn()
      importer.onComplete(onComplete)

      const promise = importer.importFiles(['/abs/test.pdf'], false)
      const worker = getWorker()
      worker!.emit('message', {
        correlationId: worker!.postMessage.mock.calls[0]![0].correlationId,
        fileHash: 'abc123'
      })

      await promise
      expect(onComplete).toHaveBeenCalledWith({
        added: expect.any(Array),
        skipped: [],
        errors: []
      })
    })
  })

  describe('importFiles — path dedup', () => {
    it('should skip files already in DB by filePath', async () => {
      repos.documents.insert(makeDoc('existing', { filePath: '/abs/existing.pdf' }))

      const result = await importer.importFiles(['/abs/existing.pdf'], false)
      expect(result.added).toEqual([])
      expect(result.skipped).toEqual(['/abs/existing.pdf'])
      expect(result.errors).toEqual([])

      expect(utilityProcess.fork).not.toHaveBeenCalled()
    })
  })

  describe('importFiles — hash dedup', () => {
    it('should show dialog and skip duplicate hash in manual mode', async () => {
      repos.documents.insert(makeDoc('d1', { filePath: '/abs/other.pdf', fileHash: 'abc123' }))

      const promise = importer.importFiles(['/abs/test.pdf'], false)
      const worker = getWorker()
      worker!.emit('message', {
        correlationId: worker!.postMessage.mock.calls[0]![0].correlationId,
        fileHash: 'abc123',
        info: {}
      })

      const result = await promise
      expect(result.added).toEqual([])
      expect(result.skipped).toEqual(['/abs/test.pdf'])
      expect(result.errors).toEqual([])

      expect(mockShowMessageBox).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          type: 'question',
          title: 'Duplicate File'
        })
      )
    })

    it('should auto-skip duplicate hash in watch mode without dialog', async () => {
      repos.documents.insert(makeDoc('d1', { filePath: '/abs/other.pdf', fileHash: 'abc123' }))

      const promise = importer.importFiles(['/abs/test.pdf'], true)
      const worker = getWorker()
      worker!.emit('message', {
        correlationId: worker!.postMessage.mock.calls[0]![0].correlationId,
        fileHash: 'abc123',
        info: {}
      })

      const result = await promise
      expect(result.added).toEqual([])
      expect(result.skipped).toEqual(['/abs/test.pdf'])
      expect(result.errors).toEqual([])

      expect(mockShowMessageBox).not.toHaveBeenCalled()
    })
  })

  describe('importFiles — error handling', () => {
    it('should reject encrypted PDF from worker', async () => {
      const promise = importer.importFiles(['/abs/encrypted.pdf'], false)
      const worker = getWorker()
      worker!.emit('message', {
        correlationId: worker!.postMessage.mock.calls[0]![0].correlationId,
        error: { type: 'encrypted', message: 'Password required' }
      })

      const result = await promise
      expect(result.added).toEqual([])
      expect(result.errors.length).toBe(1)
      expect(result.errors[0]!.path).toBe('/abs/encrypted.pdf')
      expect(result.errors[0]!.message).toContain('encrypted')
      expect(result.errors[0]!.message).toContain('encrypted.pdf')
    })

    it('should reject corrupted PDF from worker', async () => {
      const promise = importer.importFiles(['/abs/corrupted.pdf'], false)
      const worker = getWorker()
      worker!.emit('message', {
        correlationId: worker!.postMessage.mock.calls[0]![0].correlationId,
        error: { type: 'corrupted', message: 'File is damaged' }
      })

      const result = await promise
      expect(result.added).toEqual([])
      expect(result.errors.length).toBe(1)
      expect(result.errors[0]!.path).toBe('/abs/corrupted.pdf')
      expect(result.errors[0]!.message).toContain('corrupted')
      expect(result.errors[0]!.message).toContain('corrupted.pdf')
    })

    it('should handle non-existent file path', async () => {
      mockExistsSync.mockReturnValue(false)

      const result = await importer.importFiles(['/abs/missing.pdf'], false)
      expect(result.added).toEqual([])
      expect(result.skipped).toEqual(['/abs/missing.pdf'])
      expect(result.errors).toEqual([])

      expect(utilityProcess.fork).not.toHaveBeenCalled()
    })

    it('should handle worker crash and reject all pending requests', async () => {
      const promise = importer.importFiles(['/abs/test.pdf'], false)
      const worker = getWorker()
      expect(worker).toBeDefined()

      worker!.emit('exit', 1)

      const result = await promise
      expect(result.added).toEqual([])
      expect(result.errors.length).toBe(1)
      expect(result.errors[0]!.message).toBe('PDF worker exited unexpectedly')
    })

    it('should create a new worker after previous worker crash', async () => {
      const promise1 = importer.importFiles(['/abs/first.pdf'], false)
      const worker1 = getWorker()
      worker1!.emit('exit', 1)
      await promise1

      expect(utilityProcess.fork).toHaveBeenCalledTimes(1)

      const promise2 = importer.importFiles(['/abs/second.pdf'], false)
      expect(utilityProcess.fork).toHaveBeenCalledTimes(2)

      const worker2 = getWorker()
      expect(worker2).toBeDefined()
      expect(worker2).not.toBe(worker1)

      worker2!.emit('message', {
        correlationId: worker2!.postMessage.mock.calls[0]![0].correlationId,
        fileHash: null
      })

      const result = await promise2
      expect(result.added.length).toBe(1)
    })

    it('reuses the recovered worker for subsequent requests (workerKilled reset)', async () => {
      const promise1 = importer.importFiles(['/abs/first.pdf'], false)
      const worker1 = getWorker()
      worker1!.emit('exit', 1)
      await promise1

      const promise2 = importer.importFiles(['/abs/second.pdf'], false)
      const worker2 = getWorker()
      worker2!.emit('message', {
        correlationId: worker2!.postMessage.mock.calls.at(-1)![0].correlationId,
        fileHash: null
      })
      await promise2

      // After recovery, a third request must REUSE worker2 — no new fork.
      const forkCallsAfterSecond = vi.mocked(utilityProcess.fork).mock.calls.length

      const promise3 = importer.importFiles(['/abs/third.pdf'], false)
      const worker3 = getWorker()
      expect(worker3).toBe(worker2)
      expect(vi.mocked(utilityProcess.fork).mock.calls.length).toBe(forkCallsAfterSecond)

      worker3!.emit('message', {
        correlationId: worker3!.postMessage.mock.calls.at(-1)![0].correlationId,
        fileHash: null
      })

      const result3 = await promise3
      expect(result3.added.length).toBe(1)
    })
  })

  describe('importFiles — worker timeout', () => {
    it('should reject request on worker timeout (120s)', async () => {
      vi.useFakeTimers()

      const promise = importer.importFiles(['/abs/test.pdf'], false)

      await vi.advanceTimersByTimeAsync(121_000)

      const result = await promise
      expect(result.added).toEqual([])
      expect(result.errors.length).toBe(1)
      expect(result.errors[0]!.message).toContain('timed out')
    })
  })

  describe('importFiles — edge cases', () => {
    it('should return empty result for empty paths array', async () => {
      const result = await importer.importFiles([], false)
      expect(result).toEqual({ added: [], skipped: [], errors: [] })
    })

    it('should import multiple files sequentially', async () => {
      const promise = importer.importFiles(['/abs/a.pdf', '/abs/b.pdf'], false)
      const worker = getWorker()

      const req1 = worker!.postMessage.mock.calls[0]![0]
      worker!.emit('message', { correlationId: req1.correlationId, fileHash: 'hashA' })

      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      expect(worker!.postMessage.mock.calls.length).toBe(2)
      const req2 = worker!.postMessage.mock.calls[1]![0]
      worker!.emit('message', { correlationId: req2.correlationId, fileHash: 'hashB' })

      const result = await promise
      expect(result.added.length).toBe(2)
      expect(result.errors).toEqual([])

      const docA = repos.documents.get(result.added[0]!)
      const docB = repos.documents.get(result.added[1]!)
      expect(docA!.fileHash).toBe('hashA')
      expect(docB!.fileHash).toBe('hashB')
    })
  })

  describe('importFiles — library folder not configured', () => {
    it('rejects all paths with an error when libraryFolderPath is empty', async () => {
      repos.settings.set('libraryFolderPath', '')
      const result = await importer.importFiles(['/abs/a.pdf', '/abs/b.pdf'], false)
      expect(result.added).toEqual([])
      expect(result.skipped).toEqual([])
      expect(result.errors.length).toBe(2)
      expect(result.errors[0]!.path).toBe('/abs/a.pdf')
      expect(result.errors[0]!.message).toContain('Library folder')
      expect(utilityProcess.fork).not.toHaveBeenCalled()
      expect(mockCopyToLibrary).not.toHaveBeenCalled()
    })
  })
})
