import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkMissing, relocate, deleteDocument, bulkDeleteDocuments } from '../../src/main/services/files'
import { RepoError } from '../../src/main/db/repositories/errors'
import type { Repositories } from '../../src/main/db/repositories'
import type { Document } from '../../src/shared/ipc-types'

const { mockExistsSync, mockStatSync, mockResolvePdfFilePath, mockEmitDocumentUpdated, mockTrashItem, mockLogger } = vi.hoisted(() => ({
  mockExistsSync: vi.fn<[string], boolean>(),
  mockStatSync: vi.fn(),
  mockResolvePdfFilePath: vi.fn<[string], string>(),
  mockEmitDocumentUpdated: vi.fn(),
  mockTrashItem: vi.fn<[string], Promise<void>>(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('node:fs', () => ({
  default: { existsSync: mockExistsSync, statSync: mockStatSync },
  existsSync: mockExistsSync,
  statSync: mockStatSync
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

vi.mock('../../src/main/services/pdfPath', () => ({
  resolvePdfFilePath: mockResolvePdfFilePath
}))

vi.mock('../../src/main/services/fileHash', () => ({
  streamFileHash: vi.fn().mockResolvedValue('new-hash')
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

function mockRepos(docs: Document[], overrides: Partial<ReturnType<typeof createMockDocRepo>> = {}) {
  const docRepo = createMockDocRepo(docs, overrides)
  return {
    documents: docRepo,
    aiSummaries: { delete: vi.fn() },
    workspaceItems: { removeByDocId: vi.fn() },
    aiReports: { removeDocFromSources: vi.fn() },
    transaction: vi.fn((fn: () => unknown) => fn())
  } as unknown as Repositories
}

function createMockDocRepo(
  docs: Document[],
  overrides: Partial<{
    list: () => Document[]
    get: (id: string) => Document | null
    updateFilePath: (id: string, filePath: string, fileName: string) => void
    updateFileIdentity: (id: string, filePath: string, fileName: string, fileSize: number, fileHash: string) => void
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
    updateFileIdentity: overrides.updateFileIdentity ?? vi.fn((id: string, fp: string, fn: string, size: number, hash: string) => {
      const doc = docMap.get(id)
      if (doc) {
        doc.filePath = fp
        doc.fileName = fn
        doc.fileSize = size
        doc.fileHash = hash
        doc.fileMissing = 0
      }
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
    mockResolvePdfFilePath.mockImplementation((filePath) => filePath)
    mockStatSync.mockReturnValue({ size: 321 })
  })

  it('succeeds for a valid PDF path and updates file identity', async () => {
    mockExistsSync.mockReturnValue(true)
    const doc = mockDoc('d1')
    const repos = mockRepos([doc])

    const result = await relocate(repos, 'd1', '/some/where/doc.pdf')

    expect(result.filePath).toBe('/some/where/doc.pdf')
    expect(result.fileName).toBe('doc.pdf')
    expect(result.fileMissing).toBe(0)
    expect(repos.documents.updateFileIdentity).toHaveBeenCalledWith(
      'd1',
      '/some/where/doc.pdf',
      'doc.pdf',
      321,
      'new-hash'
    )
    expect(repos.aiSummaries.delete).toHaveBeenCalledWith('d1')
  })

  it('rejects non-PDF paths with invalid_path error', async () => {
    const repos = mockRepos([mockDoc('d1')])
    mockResolvePdfFilePath.mockImplementation(() => {
      throw new RepoError('invalid_path', 'Selected file must be a PDF')
    })
    await expect(relocate(repos, 'd1', '/some/where/doc.txt')).rejects.toMatchObject({
      code: 'invalid_path'
    })
  })

  it('rejects when the document is not found', async () => {
    mockExistsSync.mockReturnValue(true)
    const repos = mockRepos([])

    await expect(relocate(repos, 'ghost', '/some/where/doc.pdf')).rejects.toMatchObject({
      code: 'not_found'
    })
  })

  it('rejects when the target file does not exist on disk', async () => {
    const repos = mockRepos([mockDoc('d1')])
    mockResolvePdfFilePath.mockImplementation(() => {
      throw new RepoError('file_missing', 'File not found')
    })
    await expect(relocate(repos, 'd1', '/some/where/doc.pdf')).rejects.toMatchObject({
      code: 'file_missing'
    })
  })
})

describe('deleteDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolvePdfFilePath.mockImplementation((filePath) => filePath)
    mockTrashItem.mockResolvedValue(undefined)
  })

  it('trashes the PDF then deletes the DB record', async () => {
    mockExistsSync.mockReturnValue(true)
    const doc = mockDoc('d1', { filePath: '/abs/d1.pdf' })
    const repos = mockRepos([doc])

    await deleteDocument(repos, 'd1')

    expect(mockTrashItem).toHaveBeenCalledWith('/abs/d1.pdf')
    expect(repos.documents.delete).toHaveBeenCalledWith('d1')
    expect(repos.aiSummaries.delete).toHaveBeenCalledWith('d1')
    expect(repos.workspaceItems.removeByDocId).toHaveBeenCalledWith('d1')
    expect(repos.aiReports.removeDocFromSources).toHaveBeenCalledWith('d1')
    expect(repos.transaction).toHaveBeenCalledTimes(1)
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
    mockResolvePdfFilePath.mockImplementation(() => {
      throw new RepoError('file_missing', 'File not found')
    })
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
    mockResolvePdfFilePath.mockImplementation((filePath) => filePath)
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
    expect(repos.aiSummaries.delete).toHaveBeenCalledWith('d1')
    expect(repos.aiSummaries.delete).toHaveBeenCalledWith('d2')
    expect(repos.aiSummaries.delete).toHaveBeenCalledWith('d3')
    expect(repos.workspaceItems.removeByDocId).toHaveBeenCalledWith('d1')
    expect(repos.workspaceItems.removeByDocId).toHaveBeenCalledWith('d2')
    expect(repos.workspaceItems.removeByDocId).toHaveBeenCalledWith('d3')
    expect(repos.aiReports.removeDocFromSources).toHaveBeenCalledWith('d1')
    expect(repos.aiReports.removeDocFromSources).toHaveBeenCalledWith('d2')
    expect(repos.aiReports.removeDocFromSources).toHaveBeenCalledWith('d3')
    expect(repos.transaction).toHaveBeenCalledTimes(1)
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

  it('still bulk-deletes every DB record when some trashItem calls fail (best-effort)', async () => {
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
    expect(repos.aiSummaries.delete).toHaveBeenCalledWith('d2')
  })
})
