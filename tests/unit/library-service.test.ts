import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveMovePolicy, moveToLibrary, restoreToOriginal } from '../../src/main/services/library'
import { RepoError } from '../../src/main/db/repositories/errors'
import type { Repositories } from '../../src/main/db/repositories'
import type { Document } from '../../src/shared/ipc-types'

const { mockExistsSync, mockRenameSync, mockStatSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn<[string], boolean>(),
  mockRenameSync: vi.fn<[string, string], void>(),
  mockStatSync: vi.fn<[string], { isDirectory: () => boolean }>()
}))

vi.mock('node:fs', () => ({
  default: { existsSync: mockExistsSync, renameSync: mockRenameSync, statSync: mockStatSync },
  existsSync: mockExistsSync,
  renameSync: mockRenameSync,
  statSync: mockStatSync
}))

function mockDoc(id: string, overrides: Partial<Document> = {}): Document {
  return {
    id,
    filePath: `/abs/${id}.pdf`,
    originalFolderPath: '/abs/original',
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

function mockRepos(docs: Document[]) {
  const docMap = new Map(docs.map((d) => [d.id, d]))
  return {
    documents: {
      get: vi.fn((id: string) => docMap.get(id) ?? null),
      updateFilePath: vi.fn((id: string, fp: string, fn: string) => {
        const doc = docMap.get(id)
        if (doc) { doc.filePath = fp; doc.fileName = fn }
      })
    }
  } as unknown as Repositories
}

describe('resolveMovePolicy', () => {
  it('returns true when category override is ON (moveToLibrary=1)', () => {
    expect(resolveMovePolicy(1, '0')).toBe(true)
  })

  it('returns false when category override is OFF (moveToLibrary=0)', () => {
    expect(resolveMovePolicy(0, '1')).toBe(false)
  })

  it('returns true for null category + global ON', () => {
    expect(resolveMovePolicy(null, '1')).toBe(true)
  })

  it('returns false for null category + global OFF', () => {
    expect(resolveMovePolicy(null, '0')).toBe(false)
  })
})

describe('moveToLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renames file to library folder when no collision', () => {
    mockExistsSync.mockReturnValue(false)

    const result = moveToLibrary('/source/doc.pdf', '/library')

    expect(result).toBe('/library/doc.pdf')
    expect(mockRenameSync).toHaveBeenCalledWith('/source/doc.pdf', '/library/doc.pdf')
    expect(mockExistsSync).toHaveBeenCalledWith('/library/doc.pdf')
  })

  it('appends (1) suffix on first collision', () => {
    mockExistsSync
      .mockReturnValueOnce(true)
      .mockReturnValue(false)

    const result = moveToLibrary('/source/doc.pdf', '/library')

    expect(result).toBe('/library/doc (1).pdf')
    expect(mockExistsSync).toHaveBeenNthCalledWith(1, '/library/doc.pdf')
    expect(mockExistsSync).toHaveBeenNthCalledWith(2, '/library/doc (1).pdf')
    expect(mockRenameSync).toHaveBeenCalledWith('/source/doc.pdf', '/library/doc (1).pdf')
  })

  it('increments counter on double collision', () => {
    mockExistsSync
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false)

    const result = moveToLibrary('/source/doc.pdf', '/library')

    expect(result).toBe('/library/doc (2).pdf')
    expect(mockRenameSync).toHaveBeenCalledWith('/source/doc.pdf', '/library/doc (2).pdf')
  })

  it('propagates renameSync error when source is missing', () => {
    mockExistsSync.mockReturnValue(false)
    const fsError = new Error('ENOENT: no such file or directory')
    mockRenameSync.mockImplementation(() => { throw fsError })

    expect(() => moveToLibrary('/missing.pdf', '/library')).toThrow(fsError)
  })
})

describe('restoreToOriginal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRenameSync.mockReset()
  })

  it('renames file to original folder and updates DB', () => {
    const doc = mockDoc('d1', { filePath: '/library/d1.pdf', originalFolderPath: '/abs/original' })
    const repos = mockRepos([doc])
    mockExistsSync.mockReturnValue(false)
    mockStatSync.mockReturnValue({ isDirectory: () => true })

    const result = restoreToOriginal(repos, 'd1')

    expect(result).toBe('/abs/original/d1.pdf')
    expect(mockStatSync).toHaveBeenCalledWith('/abs/original')
    expect(mockRenameSync).toHaveBeenCalledWith('/library/d1.pdf', '/abs/original/d1.pdf')
    expect(repos.documents.updateFilePath).toHaveBeenCalledWith('d1', '/abs/original/d1.pdf', 'd1.pdf')
  })

  it('throws not_found when document does not exist', () => {
    const repos = mockRepos([])

    expect(() => restoreToOriginal(repos, 'ghost')).toThrow(RepoError)
    try {
      restoreToOriginal(repos, 'ghost')
    } catch (e) {
      expect(e).toBeInstanceOf(RepoError)
      expect((e as RepoError).code).toBe('not_found')
    }
  })

  it('throws invalid_state when originalFolderPath is null', () => {
    const doc = mockDoc('d1', { originalFolderPath: '' as unknown as string })
    const repos = mockRepos([doc])

    expect(() => restoreToOriginal(repos, 'd1')).toThrow(RepoError)
    try {
      restoreToOriginal(repos, 'd1')
    } catch (e) {
      expect(e).toBeInstanceOf(RepoError)
      expect((e as RepoError).code).toBe('invalid_state')
    }
  })

  it('throws invalid_state when originalFolderPath directory is missing on disk', () => {
    const doc = mockDoc('d1', { originalFolderPath: '/abs/original' })
    const repos = mockRepos([doc])
    mockStatSync.mockImplementation(() => { throw new Error('ENOENT') })

    expect(() => restoreToOriginal(repos, 'd1')).toThrow(RepoError)
    try {
      restoreToOriginal(repos, 'd1')
    } catch (e) {
      expect(e).toBeInstanceOf(RepoError)
      expect((e as RepoError).code).toBe('invalid_state')
    }
  })

  it('throws invalid_state when originalFolderPath is not a directory', () => {
    const doc = mockDoc('d1', { originalFolderPath: '/abs/original' })
    const repos = mockRepos([doc])
    mockStatSync.mockReturnValue({ isDirectory: () => false })

    expect(() => restoreToOriginal(repos, 'd1')).toThrow(RepoError)
    try {
      restoreToOriginal(repos, 'd1')
    } catch (e) {
      expect(e).toBeInstanceOf(RepoError)
      expect((e as RepoError).code).toBe('invalid_state')
    }
  })

  it('uses collision-safe path when original folder already has the file', () => {
    const doc = mockDoc('d1', { filePath: '/library/d1.pdf', originalFolderPath: '/abs/original' })
    const repos = mockRepos([doc])
    mockStatSync.mockReturnValue({ isDirectory: () => true })
    mockExistsSync
      .mockReturnValueOnce(true)
      .mockReturnValue(false)

    const result = restoreToOriginal(repos, 'd1')

    expect(result).toBe('/abs/original/d1 (1).pdf')
    expect(mockRenameSync).toHaveBeenCalledWith('/library/d1.pdf', '/abs/original/d1 (1).pdf')
    expect(repos.documents.updateFilePath).toHaveBeenCalledWith('d1', '/abs/original/d1 (1).pdf', 'd1 (1).pdf')
  })
})
