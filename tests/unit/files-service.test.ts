import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkMissing, relocate, deleteDocument, bulkDeleteDocuments } from '../../src/main/services/files'
import { RepoError } from '../../src/main/db/repositories/errors'
import type { Repositories } from '../../src/main/db/repositories'
import type { Document } from '../../src/shared/ipc-types'

const { mockExistsSync, mockEmitDocumentUpdated, mockTrashItem, mockLogger } = vi.hoisted(() => ({
  mockExistsSync: vi.fn<[string], boolean>(),
  mockEmitDocumentUpdated: vi.fn(),
  mockTrashItem: vi.fn<[string], Promise<void>>(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('node:fs', () => ({
  default: { existsSync: mockExistsSync },
  existsSync: mockExistsSync
}))

vi.mock('electron', () => ({
  shell: {
    trashItem: mockTrashItem
  }
}))

vi.mock('../../src/main/services/logger', () => ({
  default: {},
  logger: mockLogger
}))

vi.mock('../../src/main/ipc/events', () => ({
  emitDocumentUpdated: mockEmitDocumentUpdated
}))

function mockDoc(id: string, overrides: Partial<Document> = {}): Document {
  return {
    id,
    filePath: `/abs/${id}.pdf`,
    originalFolderPath: '/abs',
    fileName: `${id}.pdf`,
    fileSize: 100,
    fileHash: null,
    title: null,
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
    metadataStatus: 'pending' as const,
    metadataAttempts: 0,
    editedFields: [],
    remoteValues: null,
    fileMissing: 0,
    ...overrides
  }
}

function mockRepos(docs: Document[], overrides: Partial<ReturnType<typeof createMockDocRepo>> = {}) {
  const docRepo = createMockDocRepo(docs, overrides)
  return { documents: docRepo } as unknown as Repositories
}

function createMockDocRepo(
  docs: Document[],
  overrides: Partial<{
    list: () => Document[]
    get: (id: string) => Document | null
    updateFilePath: (id: string, filePath: string, fileName: string) => void
    setFileMissing: (id: string, missing: boolean) => void
    delete: (id: string) => void
    bulkDelete: (ids: string[]) => void
  }> = {}
) {
  const docMap = new Map(docs.map((d) => [d.id, d]))
  return {
    list: overrides.list ?? vi.fn().mockReturnValue(docs),
    get: overrides.get ?? vi.fn((id: string) => docMap.get(id) ?? null),
    updateFilePath: overrides.updateFilePath ?? vi.fn((id: string, fp: string, fn: string) => {
      const doc = docMap.get(id)
      if (doc) { doc.filePath = fp; doc.fileName = fn }
    }),
    setFileMissing: overrides.setFileMissing ?? vi.fn((id: string, missing: boolean) => {
      const doc = docMap.get(id)
      if (doc) doc.fileMissing = missing ? 1 : 0
    }),
    delete: overrides.delete ?? vi.fn((id: string) => {
      docMap.delete(id)
    }),
    bulkDelete: overrides.bulkDelete ?? vi.fn((ids: string[]) => {
      for (const id of ids) docMap.delete(id)
    })
  }
}

describe('checkMissing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks all docs as missing when all files are absent', () => {
    vi.useFakeTimers()
    const docs = [mockDoc('d1'), mockDoc('d2'), mockDoc('d3')]
    const repos = mockRepos(docs)
    const win = { webContents: { send: vi.fn() } } as unknown as Electron.BrowserWindow

    mockExistsSync.mockReturnValue(false)

    checkMissing(repos, win)
    vi.runAllTimers()

    expect(repos.documents.setFileMissing).toHaveBeenCalledWith('d1', true)
    expect(repos.documents.setFileMissing).toHaveBeenCalledWith('d2', true)
    expect(repos.documents.setFileMissing).toHaveBeenCalledWith('d3', true)
    expect(mockEmitDocumentUpdated).toHaveBeenCalledTimes(3)
  })

  it('no-ops when all files are present and not marked missing', () => {
    vi.useFakeTimers()
    const docs = [mockDoc('d1'), mockDoc('d2')]
    const repos = mockRepos(docs)
    const win = null

    mockExistsSync.mockReturnValue(true)

    checkMissing(repos, win)
    vi.runAllTimers()

    expect(repos.documents.setFileMissing).not.toHaveBeenCalled()
    expect(mockEmitDocumentUpdated).not.toHaveBeenCalled()
  })

  it('processes 75 docs in setImmediate batches', () => {
    vi.useFakeTimers()
    const docs = Array.from({ length: 75 }, (_, i) => mockDoc(`d${i}`))
    const repos = mockRepos(docs)
    const win = null

    mockExistsSync.mockReturnValue(false)

    checkMissing(repos, win)

    vi.runAllTimers()

    expect(repos.documents.setFileMissing).toHaveBeenCalledTimes(75)
    expect(repos.documents.list).toHaveBeenCalledTimes(1)
  })

  it('clears fileMissing when a previously missing file reappears', () => {
    vi.useFakeTimers()
    const docs = [mockDoc('d1', { fileMissing: 1 })]
    const repos = mockRepos(docs)
    const win = { webContents: { send: vi.fn() } } as unknown as Electron.BrowserWindow

    mockExistsSync.mockReturnValue(true)

    checkMissing(repos, win)
    vi.runAllTimers()

    expect(repos.documents.setFileMissing).toHaveBeenCalledWith('d1', false)
    expect(mockEmitDocumentUpdated).toHaveBeenCalledTimes(1)
  })

  it('only emits when win is non-null', () => {
    vi.useFakeTimers()
    const docs = [mockDoc('d1')]
    const repos = mockRepos(docs)

    mockExistsSync.mockReturnValue(false)

    checkMissing(repos, null)
    vi.runAllTimers()

    expect(repos.documents.setFileMissing).toHaveBeenCalledWith('d1', true)
    expect(mockEmitDocumentUpdated).not.toHaveBeenCalled()
  })
})

describe('relocate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('succeeds for a valid PDF path and updates filePath/fileName/fileMissing', () => {
    mockExistsSync.mockReturnValue(true)
    const doc = mockDoc('d1')
    const repos = mockRepos([doc])

    const result = relocate(repos, 'd1', '/some/where/doc.pdf')

    expect(result.filePath).toBe('/some/where/doc.pdf')
    expect(result.fileName).toBe('doc.pdf')
    expect(result.fileMissing).toBe(0)
    expect(repos.documents.updateFilePath).toHaveBeenCalledWith('d1', '/some/where/doc.pdf', 'doc.pdf')
    expect(repos.documents.setFileMissing).toHaveBeenCalledWith('d1', false)
  })

  it('rejects non-PDF paths with invalid_path error', () => {
    expect(() => relocate({} as Repositories, 'd1', '/some/where/doc.txt'))
      .toThrow(RepoError)
    try {
      relocate({} as Repositories, 'd1', '/some/where/doc.txt')
    } catch (e) {
      expect(e).toBeInstanceOf(RepoError)
      expect((e as RepoError).code).toBe('invalid_path')
    }
  })

  it('rejects when the document is not found', () => {
    mockExistsSync.mockReturnValue(true)
    const repos = mockRepos([])

    expect(() => relocate(repos, 'ghost', '/some/where/doc.pdf'))
      .toThrow(RepoError)
    try {
      relocate(repos, 'ghost', '/some/where/doc.pdf')
    } catch (e) {
      expect(e).toBeInstanceOf(RepoError)
      expect((e as RepoError).code).toBe('not_found')
    }
  })

  it('rejects when the target file does not exist on disk', () => {
    mockExistsSync.mockReturnValue(false)

    expect(() => relocate({} as Repositories, 'd1', '/some/where/doc.pdf'))
      .toThrow(RepoError)
    try {
      relocate({} as Repositories, 'd1', '/some/where/doc.pdf')
    } catch (e) {
      expect(e).toBeInstanceOf(RepoError)
      expect((e as RepoError).code).toBe('invalid_path')
    }
  })
})

describe('deleteDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTrashItem.mockResolvedValue(undefined)
  })

  it('trashes the PDF then deletes the DB record', async () => {
    mockExistsSync.mockReturnValue(true)
    const doc = mockDoc('d1', { filePath: '/abs/d1.pdf' })
    const repos = mockRepos([doc])

    await deleteDocument(repos, 'd1')

    expect(mockTrashItem).toHaveBeenCalledWith('/abs/d1.pdf')
    expect(repos.documents.delete).toHaveBeenCalledWith('d1')
  })

  it('skips trashing when the document is marked fileMissing', async () => {
    mockExistsSync.mockReturnValue(true)
    const doc = mockDoc('d1', { fileMissing: 1 })
    const repos = mockRepos([doc])

    await deleteDocument(repos, 'd1')

    expect(mockTrashItem).not.toHaveBeenCalled()
    expect(repos.documents.delete).toHaveBeenCalledWith('d1')
  })

  it('skips trashing when the file no longer exists on disk', async () => {
    mockExistsSync.mockReturnValue(false)
    const doc = mockDoc('d1', { filePath: '/abs/d1.pdf' })
    const repos = mockRepos([doc])

    await deleteDocument(repos, 'd1')

    expect(mockTrashItem).not.toHaveBeenCalled()
    expect(repos.documents.delete).toHaveBeenCalledWith('d1')
  })

  it('still deletes the DB record when trashItem fails (best-effort)', async () => {
    mockExistsSync.mockReturnValue(true)
    mockTrashItem.mockRejectedValue(new Error('trash denied'))
    const doc = mockDoc('d1', { filePath: '/abs/d1.pdf' })
    const repos = mockRepos([doc])

    await deleteDocument(repos, 'd1')

    expect(mockTrashItem).toHaveBeenCalledWith('/abs/d1.pdf')
    expect(mockLogger.warn).toHaveBeenCalled()
    expect(repos.documents.delete).toHaveBeenCalledWith('d1')
  })

  it('deletes the DB record even when the document is missing', async () => {
    mockExistsSync.mockReturnValue(true)
    const repos = mockRepos([])

    await deleteDocument(repos, 'ghost')

    expect(mockTrashItem).not.toHaveBeenCalled()
    expect(repos.documents.delete).toHaveBeenCalledWith('ghost')
  })
})

describe('bulkDeleteDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTrashItem.mockResolvedValue(undefined)
  })

  it('trashes all present PDFs then deletes all DB records', async () => {
    mockExistsSync.mockReturnValue(true)
    const docs = [
      mockDoc('d1', { filePath: '/abs/d1.pdf' }),
      mockDoc('d2', { filePath: '/abs/d2.pdf' }),
      mockDoc('d3', { filePath: '/abs/d3.pdf' })
    ]
    const repos = mockRepos(docs)

    await bulkDeleteDocuments(repos, ['d1', 'd2', 'd3'])

    expect(mockTrashItem).toHaveBeenCalledWith('/abs/d1.pdf')
    expect(mockTrashItem).toHaveBeenCalledWith('/abs/d2.pdf')
    expect(mockTrashItem).toHaveBeenCalledWith('/abs/d3.pdf')
    expect(repos.documents.bulkDelete).toHaveBeenCalledWith(['d1', 'd2', 'd3'])
  })

  it('skips trashing for fileMissing docs but still bulk-deletes all ids', async () => {
    mockExistsSync.mockReturnValue(true)
    const docs = [
      mockDoc('d1', { filePath: '/abs/d1.pdf' }),
      mockDoc('d2', { filePath: '/abs/d2.pdf', fileMissing: 1 })
    ]
    const repos = mockRepos(docs)

    await bulkDeleteDocuments(repos, ['d1', 'd2'])

    expect(mockTrashItem).toHaveBeenCalledTimes(1)
    expect(mockTrashItem).toHaveBeenCalledWith('/abs/d1.pdf')
    expect(repos.documents.bulkDelete).toHaveBeenCalledWith(['d1', 'd2'])
  })

  it('no-ops on an empty id list', async () => {
    const repos = mockRepos([])

    await bulkDeleteDocuments(repos, [])

    expect(mockTrashItem).not.toHaveBeenCalled()
    expect(repos.documents.bulkDelete).not.toHaveBeenCalled()
  })

  it('still bulk-deletes when some trashItem calls fail (best-effort)', async () => {
    mockExistsSync.mockReturnValue(true)
    mockTrashItem
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined)
    const docs = [
      mockDoc('d1', { filePath: '/abs/d1.pdf' }),
      mockDoc('d2', { filePath: '/abs/d2.pdf' }),
      mockDoc('d3', { filePath: '/abs/d3.pdf' })
    ]
    const repos = mockRepos(docs)

    await bulkDeleteDocuments(repos, ['d1', 'd2', 'd3'])

    expect(mockTrashItem).toHaveBeenCalledTimes(3)
    expect(mockLogger.warn).toHaveBeenCalled()
    expect(repos.documents.bulkDelete).toHaveBeenCalledWith(['d1', 'd2', 'd3'])
  })
})
