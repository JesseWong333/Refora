import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RepoError } from '../../src/main/db/repositories/errors'
import type { Repositories } from '../../src/main/db/repositories'
import type { Document } from '../../src/shared/ipc-types'
import type { BrowserWindow } from 'electron'

vi.mock('electron', () => ({
  shell: {
    openPath: vi.fn().mockResolvedValue('')
  }
}))

vi.mock('../../src/main/ipc/events', () => ({
  emitDocumentUpdated: vi.fn()
}))

import { shell } from 'electron'
import { emitDocumentUpdated } from '../../src/main/ipc/events'
import { openPdf } from '../../src/main/services/pdfOpen'

function mockDoc(id: string, overrides: Partial<Document> = {}): Document {
  return {
    id,
    filePath: `/fake/${id}.pdf`,
    originalFolderPath: '/fake',
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
    metadataStatus: 'pending',
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
      get: vi.fn((id: string) => {
        const doc = docMap.get(id)
        return doc ? { ...doc } : null
      }),
      setLastReadAt: vi.fn((id: string, ts: number) => {
        const doc = docMap.get(id)
        if (doc) doc.lastReadAt = ts
      })
    }
  } as unknown as Repositories
}

function mockWin(): BrowserWindow {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: () => false
  } as unknown as BrowserWindow
}

describe('openPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens successfully and updates lastReadAt', async () => {
    const doc = mockDoc('d1')
    const repos = mockRepos([doc])
    const win = mockWin()

    vi.mocked(shell.openPath).mockResolvedValue('')

    const result = await openPdf(repos, win, doc.id)

    expect(result).toBeDefined()
    expect(result.id).toBe('d1')
    expect(result.lastReadAt).toBeGreaterThan(0)
    expect(repos.documents.setLastReadAt).toHaveBeenCalledWith('d1', expect.any(Number))
    expect(emitDocumentUpdated).toHaveBeenCalledWith(win, result)
  })

  it('throws not_found when document does not exist', async () => {
    const repos = mockRepos([])
    const win = mockWin()

    await expect(openPdf(repos, win, 'ghost')).rejects.toThrow(RepoError)
    await expect(openPdf(repos, win, 'ghost')).rejects.toMatchObject({
      code: 'not_found',
      message: 'Document ghost not found'
    })
  })

  it('throws file_missing when doc.fileMissing is set', async () => {
    const doc = mockDoc('d1', { fileMissing: 1 })
    const repos = mockRepos([doc])
    const win = mockWin()

    await expect(openPdf(repos, win, doc.id)).rejects.toThrow(RepoError)
    await expect(openPdf(repos, win, doc.id)).rejects.toMatchObject({
      code: 'file_missing',
      message: 'Source PDF file is missing'
    })

    expect(shell.openPath).not.toHaveBeenCalled()
    expect(repos.documents.setLastReadAt).not.toHaveBeenCalled()
  })

  it('throws open_failed when shell.openPath returns an error', async () => {
    const doc = mockDoc('d1')
    const repos = mockRepos([doc])
    const win = mockWin()

    vi.mocked(shell.openPath).mockResolvedValue('Permission denied')

    await expect(openPdf(repos, win, doc.id)).rejects.toThrow(RepoError)
    await expect(openPdf(repos, win, doc.id)).rejects.toMatchObject({
      code: 'open_failed',
      message: 'Permission denied'
    })

    expect(repos.documents.setLastReadAt).not.toHaveBeenCalled()
    expect(emitDocumentUpdated).not.toHaveBeenCalled()
  })

  it('handles multiple consecutive opens of the same doc', async () => {
    vi.useFakeTimers()
    const doc = mockDoc('d1')
    const repos = mockRepos([doc])
    const win = mockWin()

    vi.mocked(shell.openPath).mockResolvedValue('')

    const promise1 = openPdf(repos, win, doc.id)
    vi.advanceTimersByTime(100)
    const result1 = await promise1

    vi.advanceTimersByTime(100)
    const result2 = await openPdf(repos, win, doc.id)

    expect(result1.id).toBe('d1')
    expect(result2.id).toBe('d1')
    expect(result1.lastReadAt).toBeGreaterThan(0)
    expect(result2.lastReadAt).toBeGreaterThan(result1.lastReadAt)
    expect(repos.documents.setLastReadAt).toHaveBeenCalledTimes(2)
    expect(emitDocumentUpdated).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })
})
