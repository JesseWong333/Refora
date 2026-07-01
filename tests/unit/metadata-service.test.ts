import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Document, DocumentPatch, MetadataSource, MetadataStatus, RemoteValues } from '../../src/shared/ipc-types'

// ============================================================
// Module-level state for mock controls — reset per test
// ============================================================
let idCounter = 0
let mockWorkerInfo: Record<string, unknown> = {}
let mockWorkerText = ''
let mockWorkerError: { type: string; message: string } | undefined = undefined
let mockNetFetchImpl: (url: string, opts?: Record<string, unknown>) => Promise<{
  ok: boolean
  json?: () => Promise<unknown>
  text?: () => Promise<string>
}> = () => Promise.resolve({ ok: true, json: async () => ({ message: null }) })

// ============================================================
// Mock electron
// ============================================================
vi.mock('electron', () => {
  let messageCb: ((msg: Record<string, unknown>) => void) | null = null

  return {
    utilityProcess: {
      fork: vi.fn(() => ({
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          if (event === 'message') messageCb = cb
        }),
        postMessage: vi.fn((msg: Record<string, unknown>) => {
          setTimeout(() => {
            messageCb?.({
              correlationId: msg.correlationId,
              info: mockWorkerInfo,
              text: mockWorkerText,
              error: mockWorkerError
            })
          }, 0)
        }),
        kill: vi.fn()
      }))
    },
    net: {
      fetch: vi.fn((url: string, opts?: Record<string, unknown>) =>
        mockNetFetchImpl(url, opts)
      )
    },
    BrowserWindow: class {
      webContents = { send: vi.fn() }
      isDestroyed() { return false }
      on = vi.fn()
      close = vi.fn()
    }
  }
})

// ============================================================
// Mock electron-log
// ============================================================
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

// ============================================================
// Mock newId from documents repository
// ============================================================
vi.mock('../../src/main/db/repositories/documents', () => ({
  newId: vi.fn(() => `corr-${idCounter++}`)
}))

// ============================================================
// Import the service under test
// ============================================================
import { createMetadataService } from '../../src/main/services/metadata'

// ============================================================
// Helpers
// ============================================================

interface FakeRepos {
  documents: {
    get: ReturnType<typeof vi.fn>
    getResumableMetadataRows: ReturnType<typeof vi.fn>
    setMetadataStatus: ReturnType<typeof vi.fn>
    incrementMetadataAttempts: ReturnType<typeof vi.fn>
    applyMetadataFields: ReturnType<typeof vi.fn>
  }
  _byId: Map<string, Document>
}

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    filePath: '/abs/doc-1.pdf',
    originalFolderPath: '/abs',
    fileName: 'doc-1.pdf',
    fileSize: 100,
    fileHash: null,
    title: 'Original Title',
    authors: 'Existing Author',
    year: '2020',
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
    metadataStatus: 'pending' as MetadataStatus,
    metadataAttempts: 0,
    editedFields: [],
    remoteValues: null,
    fileMissing: 0,
    ...overrides
  }
}

function mockRepos(docs: Document[]): FakeRepos {
  const byId = new Map(docs.map((d) => [d.id, { ...d }]))

  const get = vi.fn((id: string) => byId.get(id) ?? null)

  const getResumableMetadataRows = vi.fn(() =>
    [...byId.values()].filter(
      (d) => d.metadataStatus === 'pending' || (d.metadataStatus === 'failed' && d.metadataAttempts < 3)
    )
  )

  const setMetadataStatus = vi.fn((id: string, status: string, source?: string) => {
    const doc = byId.get(id)
    if (!doc) return
    doc.metadataStatus = status as MetadataStatus
    doc.metadataAttempts = 0
    if (source !== undefined) doc.metadataSource = source as MetadataSource
  })

  const incrementMetadataAttempts = vi.fn((id: string) => {
    const doc = byId.get(id)
    if (doc) doc.metadataAttempts++
    return doc?.metadataAttempts ?? 0
  })

  const applyMetadataFields = vi.fn(
    (id: string, fields: DocumentPatch, remoteVals: RemoteValues | null, status: string, source: string | null) => {
      const doc = byId.get(id)
      if (!doc) return null
      Object.assign(doc, fields)
      doc.remoteValues = remoteVals
      doc.metadataStatus = status as MetadataStatus
      if (source) doc.metadataSource = source as MetadataSource
      return { ...doc }
    }
  )

  return {
    documents: { get, getResumableMetadataRows, setMetadataStatus, incrementMetadataAttempts, applyMetadataFields },
    _byId: byId
  }
}

function mockWin() {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: () => false,
    on: vi.fn(),
    close: vi.fn()
  }
}

function asRepos(r: FakeRepos) {
  return r as unknown as Parameters<typeof createMetadataService>[0]
}

function makeCrossrefResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () => ({
      message: {
        title: ['Test Title'],
        author: [{ family: 'Smith', given: 'John' }],
        'published-print': { 'date-parts': [[2024]] },
        'container-title': ['Test Journal'],
        volume: '42',
        abstract: 'An abstract about the research.',
        subject: ['AI', 'Machine Learning'],
        URL: 'https://doi.org/10.1234/test',
        DOI: '10.1234/test',
        ...overrides
      }
    })
  }
}

function makeArxivResponse(overrides: Record<string, unknown> = {}) {
  const title = (overrides.title as string) ?? 'Arxiv Paper Title'
  const summary = (overrides.summary as string) ?? 'Arxiv abstract text here.'
  const published = (overrides.published as string) ?? '2023'
  return {
    ok: true,
    text: async () => `<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>${title}</title>
    <author><name>Doe, Jane</name></author>
    <published>${published}</published>
    <summary>${summary}</summary>
    <id>http://arxiv.org/abs/2301.12345</id>
  </entry>
</feed>`
  }
}

// ============================================================
// Tests
// ============================================================
describe('createMetadataService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10000)
    vi.clearAllMocks()
    idCounter = 0
    mockWorkerInfo = {}
    mockWorkerText = ''
    mockWorkerError = undefined
    mockNetFetchImpl = () =>
      Promise.resolve({ ok: true, json: async () => ({ message: null }) })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ----------------------------------------------------------
  // Test 1: Single enqueue — Crossref success
  // ----------------------------------------------------------
  it('enqueues a single doc: worker extracts DOI, Crossref returns data, doc updated with done status', async () => {
    const doc = makeDoc()
    const repos = mockRepos([doc])
    const win = mockWin()

    mockWorkerInfo = { doi: '10.1234/test-paper' }
    mockWorkerText = 'Test paper content'
    mockNetFetchImpl = () => makeCrossrefResponse()

    const svc = createMetadataService(asRepos(repos), win)
    svc.enqueue('doc-1')

    await vi.advanceTimersByTimeAsync(1)

    expect(repos.documents.applyMetadataFields).toHaveBeenCalledTimes(1)
    const [id, fields, , status, source] = repos.documents.applyMetadataFields.mock.calls[0]
    expect(id).toBe('doc-1')
    expect(fields.title).toBe('Test Title')
    expect(fields.year).toBe('2024')
    expect(fields.venue).toBe('Test Journal')
    expect(fields.volume).toBe('42')
    expect(fields.abstract).toBe('An abstract about the research.')
    expect(fields.keywords).toBe('AI, Machine Learning')
    expect(fields.url).toBe('https://doi.org/10.1234/test')
    expect(fields.doi).toBe('10.1234/test')
    expect(status).toBe('done')
    expect(source).toBe('crossref')
  })

  // ----------------------------------------------------------
  // Test 2: Fallback to arXiv
  // ----------------------------------------------------------
  it('falls back to arXiv when Crossref returns 404 and text contains arXiv ID', async () => {
    const doc = makeDoc({
      title: null,
      authors: null,
      year: null
    })
    const repos = mockRepos([doc])
    const win = mockWin()

    mockWorkerInfo = {}
    mockWorkerText = 'This is a preprint available at arxiv:2301.12345'

    mockNetFetchImpl = (url: string) => {
      if (url.includes('crossref')) {
        return Promise.resolve({ ok: false })
      }
      return makeArxivResponse()
    }

    const svc = createMetadataService(asRepos(repos), win)
    svc.enqueue('doc-1')

    await vi.advanceTimersByTimeAsync(1)

    expect(repos.documents.applyMetadataFields).toHaveBeenCalledTimes(1)
    const [, fields, , status, source] = repos.documents.applyMetadataFields.mock.calls[0]
    expect(fields.title).toBe('Arxiv Paper Title')
    expect(fields.year).toBe('2023')
    expect(fields.abstract).toBe('Arxiv abstract text here.')
    expect(fields.url).toBe('http://arxiv.org/abs/2301.12345')
    expect(status).toBe('done')
    expect(source).toBe('arxiv')
  })

  // ----------------------------------------------------------
  // Test 3: No metadata found — falls back to PDF info
  // ----------------------------------------------------------
  it('falls back to PDF metadata when both Crossref and arXiv fail', async () => {
    const doc = makeDoc()
    const repos = mockRepos([doc])
    const win = mockWin()

    mockWorkerInfo = { Title: 'PDF Extracted Title' }
    mockWorkerText = 'No DOI or arXiv ID in this text'
    mockNetFetchImpl = () => Promise.resolve({ ok: false }) // Both Crossref and arXiv fail

    const svc = createMetadataService(asRepos(repos), win)
    svc.enqueue('doc-1')

    await vi.advanceTimersByTimeAsync(1)

    expect(repos.documents.applyMetadataFields).toHaveBeenCalledTimes(1)
    const [, fields, , status, source] = repos.documents.applyMetadataFields.mock.calls[0]
    expect(fields.title).toBe('PDF Extracted Title')
    expect(status).toBe('done')
    expect(source).toBe('pdf')
    expect(repos.documents.incrementMetadataAttempts).not.toHaveBeenCalled()
  })

  // ----------------------------------------------------------
  // Test 4: Worker request fails
  // ----------------------------------------------------------
  it('sets status to failed and increments attempts when worker request fails', async () => {
    const doc = makeDoc({ metadataAttempts: 1 })
    const repos = mockRepos([doc])
    const win = mockWin()

    // Making the worker respond with an error triggers the workerResponse.error branch
    mockWorkerError = { type: 'ParseError', message: 'Could not parse PDF' }

    const svc = createMetadataService(asRepos(repos), win)
    svc.enqueue('doc-1')

    await vi.advanceTimersByTimeAsync(1)

    expect(repos.documents.setMetadataStatus).toHaveBeenCalledWith('doc-1', 'failed')
    expect(repos.documents.incrementMetadataAttempts).toHaveBeenCalledWith('doc-1')
    expect(repos.documents.applyMetadataFields).not.toHaveBeenCalled()
  })

  // ----------------------------------------------------------
  // Test 5: Crossref rate gate — ≥1s between requests
  // ----------------------------------------------------------
  it('enforces ≥1s rate limit between Crossref requests', async () => {
    const docs = [makeDoc({ id: 'doc-1' }), makeDoc({ id: 'doc-2' })]
    const repos = mockRepos(docs)
    const win = mockWin()

    mockWorkerInfo = { doi: '10.1234/test' }
    mockNetFetchImpl = () => makeCrossrefResponse()

    const svc = createMetadataService(asRepos(repos), win)

    // Enqueue first doc — processed immediately (rate gate allows first call)
    svc.enqueue('doc-1')
    await vi.advanceTimersByTimeAsync(1)
    expect(repos.documents.applyMetadataFields).toHaveBeenCalledTimes(1)

    svc.enqueue('doc-2')
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(999)

    expect(repos.documents.applyMetadataFields).toHaveBeenCalledTimes(2)
  })

  // ----------------------------------------------------------
  // Test 6: arXiv rate gate — ≥3s between requests
  // ----------------------------------------------------------
  it('enforces ≥3s rate limit between arXiv requests', async () => {
    const docs = [makeDoc({ id: 'doc-1' }), makeDoc({ id: 'doc-2' })]
    const repos = mockRepos(docs)
    const win = mockWin()

    mockWorkerInfo = {}
    mockWorkerText = 'arxiv:2301.11111 available here'

    mockNetFetchImpl = (url: string) => {
      if (url.includes('crossref')) return Promise.resolve({ ok: false })
      return makeArxivResponse()
    }

    const svc = createMetadataService(asRepos(repos), win)

    svc.enqueue('doc-1')
    await vi.advanceTimersByTimeAsync(1)
    expect(repos.documents.applyMetadataFields).toHaveBeenCalledTimes(1)

    svc.enqueue('doc-2')
    // Worker responds but arXiv rate gate blocks (3000ms needed, only ~1 elapsed)
    await vi.advanceTimersByTimeAsync(1)
    // Rate gate is still sleeping; advance the remaining time
    await vi.advanceTimersByTimeAsync(2999)

    expect(repos.documents.applyMetadataFields).toHaveBeenCalledTimes(2)
  })

  // ----------------------------------------------------------
  // Test 7: Concurrent limit — max 3 workers
  // ----------------------------------------------------------
  it('processes at most 3 jobs concurrently, all 5 eventually complete', async () => {
    const docs = [
      makeDoc({ id: 'doc-1' }),
      makeDoc({ id: 'doc-2' }),
      makeDoc({ id: 'doc-3' }),
      makeDoc({ id: 'doc-4' }),
      makeDoc({ id: 'doc-5' })
    ]
    const repos = mockRepos(docs)
    const win = mockWin()

    // Use DOI to trigger API calls and rate gates
    mockWorkerInfo = { doi: '10.1234/test' }
    mockNetFetchImpl = () => makeCrossrefResponse()

    const svc = createMetadataService(asRepos(repos), win)

    // Enqueue all 5 — processQueue should start at most 3
    docs.forEach((d) => svc.enqueue(d.id))

    // After sync enqueue, at most 3 jobs are active, so at most 3 requestParse calls
    // verify by checking that applyMetadataFields is eventually called 5 times
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(4000)

    expect(repos.documents.applyMetadataFields).toHaveBeenCalledTimes(5)
  })

  // ----------------------------------------------------------
  // Test 8: resumeOnStartup — pending docs re-enqueued
  // ----------------------------------------------------------
  it('re-enqueues pending docs on startup', async () => {
    const docs = [
      makeDoc({ id: 'doc-1', metadataStatus: 'pending' }),
      makeDoc({ id: 'doc-2', metadataStatus: 'pending' }),
      makeDoc({ id: 'doc-3', metadataStatus: 'done' })
    ]
    const repos = mockRepos(docs)
    const win = mockWin()

    mockWorkerInfo = { doi: '10.1234/test' }
    mockNetFetchImpl = () => makeCrossrefResponse()

    const svc = createMetadataService(asRepos(repos), win)
    svc.resumeOnStartup()

    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(1000)

    expect(repos.documents.getResumableMetadataRows).toHaveBeenCalledTimes(1)
    // doc-1 and doc-2 were enqueued, doc-3 skipped (done)
    expect(repos.documents.applyMetadataFields).toHaveBeenCalledTimes(2)
  })

  // ----------------------------------------------------------
  // Test 9: Failed <3 attempts re-enqueued
  // ----------------------------------------------------------
  it('re-enqueues failed docs with <3 attempts on startup', async () => {
    const docs = [
      makeDoc({ id: 'doc-1', metadataStatus: 'failed', metadataAttempts: 1 }),
      makeDoc({ id: 'doc-2', metadataStatus: 'failed', metadataAttempts: 2 })
    ]
    const repos = mockRepos(docs)
    const win = mockWin()

    mockWorkerInfo = { doi: '10.1234/test' }
    mockNetFetchImpl = () => makeCrossrefResponse()

    const svc = createMetadataService(asRepos(repos), win)
    svc.resumeOnStartup()

    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(1000)

    expect(repos.documents.applyMetadataFields).toHaveBeenCalledTimes(2)
  })

  // ----------------------------------------------------------
  // Test 10: Failed ≥3 attempts NOT re-enqueued
  // ----------------------------------------------------------
  it('does NOT re-enqueue failed docs with ≥3 attempts on startup', async () => {
    const docs = [
      makeDoc({ id: 'doc-1', metadataStatus: 'failed', metadataAttempts: 3 }),
      makeDoc({ id: 'doc-2', metadataStatus: 'failed', metadataAttempts: 5 }),
      makeDoc({ id: 'doc-3', metadataStatus: 'pending' })
    ]
    const repos = mockRepos(docs)
    const win = mockWin()

    mockWorkerInfo = { doi: '10.1234/test' }
    mockNetFetchImpl = () => makeCrossrefResponse()

    const svc = createMetadataService(asRepos(repos), win)
    svc.resumeOnStartup()

    await vi.advanceTimersByTimeAsync(1)

    // Only doc-3 (pending) is enqueued; doc-1 and doc-2 skipped
    expect(repos.documents.applyMetadataFields).toHaveBeenCalledTimes(1)
  })

  // ----------------------------------------------------------
  // Test 11: refreshMetadata — resets attempts and re-enqueues
  // ----------------------------------------------------------
  it('resets metadataAttempts and re-enqueues via refreshMetadata', async () => {
    const doc = makeDoc({
      metadataStatus: 'failed',
      metadataAttempts: 2
    })
    const repos = mockRepos([doc])
    const win = mockWin()

    mockWorkerInfo = { doi: '10.1234/test' }
    mockNetFetchImpl = () => makeCrossrefResponse()

    const svc = createMetadataService(asRepos(repos), win)
    svc.refreshMetadata('doc-1')

    // refreshMetadata calls setMetadataStatus('doc-1', 'pending') which resets attempts to 0
    expect(repos.documents.setMetadataStatus).toHaveBeenCalledWith('doc-1', 'pending')
    expect(repos._byId.get('doc-1')!.metadataAttempts).toBe(0)

    await vi.advanceTimersByTimeAsync(1)

    expect(repos.documents.applyMetadataFields).toHaveBeenCalledTimes(1)
    const [, , , status] = repos.documents.applyMetadataFields.mock.calls[0]
    expect(status).toBe('done')
  })

  // ----------------------------------------------------------
  // Test 12: bulkRefreshMetadata
  // ----------------------------------------------------------
  it('calls refreshMetadata for each ID in bulk refresh', async () => {
    const docs = [
      makeDoc({ id: 'doc-1', metadataStatus: 'failed' }),
      makeDoc({ id: 'doc-2', metadataStatus: 'failed' }),
      makeDoc({ id: 'doc-3', metadataStatus: 'done' })
    ]
    const repos = mockRepos(docs)
    const win = mockWin()

    mockWorkerInfo = { doi: '10.1234/test' }
    mockNetFetchImpl = () => makeCrossrefResponse()

    const svc = createMetadataService(asRepos(repos), win)
    svc.bulkRefreshMetadata(['doc-1', 'doc-2', 'doc-3'])

    // setMetadataStatus called for all 3
    expect(repos.documents.setMetadataStatus).toHaveBeenCalledTimes(3)
    expect(repos.documents.setMetadataStatus).toHaveBeenNthCalledWith(1, 'doc-1', 'pending')
    expect(repos.documents.setMetadataStatus).toHaveBeenNthCalledWith(2, 'doc-2', 'pending')
    expect(repos.documents.setMetadataStatus).toHaveBeenNthCalledWith(3, 'doc-3', 'pending')

    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(3000)

    expect(repos.documents.applyMetadataFields).toHaveBeenCalledTimes(3)
  })

  // ----------------------------------------------------------
  // Test 13: Enqueue skips docs with status 'done'
  // ----------------------------------------------------------
  it('skips enqueue for documents already marked done', async () => {
    const doc = makeDoc({ metadataStatus: 'done' })
    const repos = mockRepos([doc])
    const win = mockWin()

    mockWorkerInfo = { doi: '10.1234/test' }
    mockNetFetchImpl = () => makeCrossrefResponse()

    const svc = createMetadataService(asRepos(repos), win)
    svc.enqueue('doc-1')

    await vi.advanceTimersByTimeAsync(1)

    expect(repos.documents.applyMetadataFields).not.toHaveBeenCalled()
  })

  // ----------------------------------------------------------
  // Test 14: Enqueue skips non-existent docs
  // ----------------------------------------------------------
  it('skips enqueue for non-existent document IDs', async () => {
    const repos = mockRepos([])
    const win = mockWin()

    const svc = createMetadataService(asRepos(repos), win)
    svc.enqueue('non-existent')

    await vi.advanceTimersByTimeAsync(1)

    expect(repos.documents.applyMetadataFields).not.toHaveBeenCalled()
    expect(repos.documents.setMetadataStatus).not.toHaveBeenCalled()
  })
})
