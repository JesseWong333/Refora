import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPdfTextService } from '../../src/main/services/pdfText'
import { pdfPreviewCachePath } from '../../src/main/services/pdfPreviewCache'
import { RepoError } from '../../src/main/db/repositories/errors'
import type { Repositories } from '../../src/main/db/repositories'
import type { Document } from '../../src/shared/ipc-types'

const mocks = vi.hoisted(() => ({
  fork: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  getFullText: vi.fn(),
  setFullText: vi.fn(),
  docGet: vi.fn(),
  settingGet: vi.fn()
}))

vi.mock('electron', () => ({
  utilityProcess: { fork: mocks.fork }
}))

vi.mock('../../src/main/services/logger', () => ({
  default: {},
  logger: mocks.logger
}))

vi.mock('../../src/main/services/pdfPath', () => ({
  resolvePdfFilePath: (filePath: string) => filePath
}))

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'd1',
    filePath: '/abs/doc.pdf',
    originalFolderPath: '/abs',
    fileName: 'doc.pdf',
    fileSize: 100,
    fileHash: null,
    title: null,
    authors: null,
    year: null,
    venue: null,
    volume: null,
    issue: null,
    pages: null,
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
    metadataStatus: 'pending' as const,
    metadataAttempts: 0,
    editedFields: [],
    remoteValues: null,
    fileMissing: 0,
    ...overrides
  }
}

interface MockWorker {
  on: ReturnType<typeof vi.fn>
  postMessage: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  stderr: { on: ReturnType<typeof vi.fn> }
}

function makeWorker(getText: () => string): MockWorker {
  const handlers: Record<string, Array<(arg: unknown) => void>> = {}
  return {
    on: vi.fn((event: string, cb: (arg: unknown) => void) => {
      ;(handlers[event] ??= []).push(cb)
    }),
    postMessage: vi.fn((msg: { correlationId: string; action?: string }) => {
      for (const cb of handlers['message'] ?? []) {
        cb(msg.action === 'preview'
          ? { correlationId: msg.correlationId, preview: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]) }
          : { correlationId: msg.correlationId, text: getText() })
      }
    }),
    kill: vi.fn(),
    stderr: { on: vi.fn() }
  }
}

function makeAsyncWorker(getText: () => string): MockWorker {
  const handlers: Record<string, Array<(arg: unknown) => void>> = {}
  return {
    on: vi.fn((event: string, cb: (arg: unknown) => void) => {
      ;(handlers[event] ??= []).push(cb)
    }),
    postMessage: vi.fn((msg: { correlationId: string }) => {
      queueMicrotask(() => {
        for (const cb of handlers['message'] ?? []) {
          cb({ correlationId: msg.correlationId, text: getText() })
        }
      })
    }),
    kill: vi.fn(),
    stderr: { on: vi.fn() }
  }
}

const repos = {
  documents: { get: mocks.docGet },
  aiSummaries: { getFullText: mocks.getFullText, setFullText: mocks.setFullText },
  settings: { get: mocks.settingGet }
} as unknown as Repositories

let extractText = 'fresh-extracted-text'
let libraryFolder = ''
let service: ReturnType<typeof createPdfTextService>

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getFullText.mockReturnValue(null)
  mocks.docGet.mockReturnValue(makeDoc())
  libraryFolder = mkdtempSync(join(tmpdir(), 'refora-pdf-preview-'))
  mocks.settingGet.mockReturnValue(libraryFolder)
  extractText = 'fresh-extracted-text'
  mocks.fork.mockImplementation(() => makeWorker(() => extractText))
  service = createPdfTextService(repos, null)
})

afterEach(() => {
  service.destroy()
  rmSync(libraryFolder, { recursive: true, force: true })
})

describe('pdfText getOrExtract cache invalidation', () => {
  it('returns cached text when hashes match', async () => {
    mocks.docGet.mockReturnValue(makeDoc({ fileHash: 'abc' }))
    mocks.getFullText.mockReturnValue({ text: 'cached', hash: 'abc' })

    const result = await service.getOrExtract('d1')

    expect(result).toBe('cached')
    expect(mocks.setFullText).not.toHaveBeenCalled()
    expect(mocks.fork).not.toHaveBeenCalled()
  })

  it('re-extracts and updates cache when hashes differ', async () => {
    mocks.docGet.mockReturnValue(makeDoc({ fileHash: 'xyz' }))
    mocks.getFullText.mockReturnValue({ text: 'old', hash: 'abc' })
    extractText = 'new-text'

    const result = await service.getOrExtract('d1')

    expect(result).toBe('new-text')
    expect(mocks.fork).toHaveBeenCalledTimes(1)
    expect(mocks.setFullText).toHaveBeenCalledWith('d1', 'new-text', 'xyz')
  })

  it('uses cached text when doc fileHash is null', async () => {
    mocks.docGet.mockReturnValue(makeDoc({ fileHash: null }))
    mocks.getFullText.mockReturnValue({ text: 'cached', hash: 'abc' })

    const result = await service.getOrExtract('d1')

    expect(result).toBe('cached')
    expect(mocks.setFullText).not.toHaveBeenCalled()
    expect(mocks.fork).not.toHaveBeenCalled()
  })

  it('uses cached text when cached hash is null', async () => {
    mocks.docGet.mockReturnValue(makeDoc({ fileHash: 'abc' }))
    mocks.getFullText.mockReturnValue({ text: 'cached', hash: null })

    const result = await service.getOrExtract('d1')

    expect(result).toBe('cached')
    expect(mocks.setFullText).not.toHaveBeenCalled()
    expect(mocks.fork).not.toHaveBeenCalled()
  })

  it('extracts and caches with hash when no cache exists', async () => {
    mocks.docGet.mockReturnValue(makeDoc({ fileHash: 'abc' }))
    mocks.getFullText.mockReturnValue(null)
    extractText = 'fresh-text'

    const result = await service.getOrExtract('d1')

    expect(result).toBe('fresh-text')
    expect(mocks.fork).toHaveBeenCalledTimes(1)
    expect(mocks.setFullText).toHaveBeenCalledWith('d1', 'fresh-text', 'abc')
  })

  it('throws not_found when the document does not exist', async () => {
    mocks.docGet.mockReturnValue(null)

    let caught: unknown
    try {
      await service.getOrExtract('ghost')
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(RepoError)
    expect((caught as RepoError).code).toBe('not_found')
    expect(mocks.setFullText).not.toHaveBeenCalled()
    expect(mocks.fork).not.toHaveBeenCalled()
  })
})

describe('pdfText PDF preview', () => {
  it('renders a validated document and caches it in the Refora library', async () => {
    const preview = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1])
    const pdfPath = join(libraryFolder, 'doc.pdf')
    writeFileSync(pdfPath, 'pdf')
    mocks.docGet.mockReturnValue(makeDoc({ filePath: pdfPath }))

    await expect(service.getPreview('d1')).resolves.toEqual(preview)
    const worker = mocks.fork.mock.results[0].value as MockWorker
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      filePath: pdfPath,
      action: 'preview'
    }))
    const sourceStats = statSync(pdfPath)
    expect(existsSync(pdfPreviewCachePath(
      libraryFolder,
      'd1',
      `unhashed:${sourceStats.size}:${sourceStats.mtimeMs}`
    ))).toBe(true)
  })

  it('reuses a valid cached preview without rendering the PDF again', async () => {
    const pdfPath = join(libraryFolder, 'doc.pdf')
    writeFileSync(pdfPath, 'pdf')
    mocks.docGet.mockReturnValue(makeDoc({ filePath: pdfPath }))

    await service.getPreview('d1')
    await service.getPreview('d1')

    expect(mocks.fork).toHaveBeenCalledTimes(1)
    const worker = mocks.fork.mock.results[0].value as MockWorker
    expect(worker.postMessage).toHaveBeenCalledTimes(1)
  })

  it('regenerates the cached preview when the source PDF changes', async () => {
    const pdfPath = join(libraryFolder, 'doc.pdf')
    writeFileSync(pdfPath, 'pdf')
    mocks.docGet.mockReturnValue(makeDoc({ filePath: pdfPath }))

    await service.getPreview('d1')
    writeFileSync(pdfPath, 'updated-pdf')
    await service.getPreview('d1')

    const worker = mocks.fork.mock.results[0].value as MockWorker
    expect(worker.postMessage).toHaveBeenCalledTimes(2)
  })
})

describe('pdfText worker pool concurrency', () => {
  it('forks multiple workers for concurrent extraction requests', async () => {
    mocks.fork.mockImplementation(() => makeAsyncWorker(() => extractText))

    const results = await Promise.all([
      service.getOrExtract('d1'),
      service.getOrExtract('d2'),
      service.getOrExtract('d3')
    ])

    expect(results).toEqual(['fresh-extracted-text', 'fresh-extracted-text', 'fresh-extracted-text'])
    expect(mocks.fork).toHaveBeenCalledTimes(3)
  })

  it('reuses existing workers for sequential requests', async () => {
    mocks.fork.mockImplementation(() => makeWorker(() => extractText))

    await service.getOrExtract('d1')
    await service.getOrExtract('d2')

    expect(mocks.fork).toHaveBeenCalledTimes(1)
  })
})
