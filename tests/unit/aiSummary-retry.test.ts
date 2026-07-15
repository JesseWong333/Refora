import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  emitUpdated: vi.fn(),
  emitError: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  docGet: vi.fn(),
  getFullText: vi.fn(),
  setSummary: vi.fn(),
  settingsGet: vi.fn(),
  getProvider: vi.fn(),
  getDecryptedKey: vi.fn(),
  pdfGetOrExtract: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: class {
    webContents = { send: vi.fn() }
    isDestroyed = () => false
  }
}))

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    invoke: mocks.invoke
  }))
}))

vi.mock('../../src/main/ipc/events', () => ({
  emitAiSummaryUpdated: mocks.emitUpdated,
  emitAiSummaryError: mocks.emitError
}))

vi.mock('../../src/main/services/logger', () => ({
  default: {},
  logger: mocks.logger
}))

import { createAiSummaryService } from '../../src/main/services/aiSummary'
import type { Repositories } from '../../src/main/db/repositories'
import type { Document, AiProvider } from '../../src/shared/ipc-types'

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'd1',
    filePath: '/abs/doc.pdf',
    originalFolderPath: '/abs',
    fileName: 'doc.pdf',
    fileSize: 100,
    fileHash: 'abc',
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

const provider: AiProvider = {
  id: 'p1',
  name: 'Test',
  baseUrl: 'https://api.test.com/v1',
  model: 'test-model',
  baseModel: 'test-model',
  variant: 'openai',
  variantFormat: 'openai' as never,
  hasKey: true,
  temperature: null,
  maxTokens: null,
  createdAt: 0
}

const repos = {
  documents: { get: mocks.docGet },
  settings: { get: mocks.settingsGet },
  aiSummaries: { getFullText: mocks.getFullText, setSummary: mocks.setSummary }
} as unknown as Repositories

const aiProvidersService = {
  getProvider: mocks.getProvider,
  getDecryptedKey: mocks.getDecryptedKey
} as never

const pdfTextService = { getOrExtract: mocks.pdfGetOrExtract } as never

const mockWin = { isDestroyed: () => false } as never

let service: ReturnType<typeof createAiSummaryService>

const PAPER_TEXT = 'A'.repeat(3000)

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mocks.docGet.mockReturnValue(makeDoc())
  mocks.getFullText.mockReturnValue(null)
  mocks.settingsGet.mockReturnValue('p1')
  mocks.getProvider.mockReturnValue(provider)
  mocks.getDecryptedKey.mockReturnValue('test-key')
  mocks.pdfGetOrExtract.mockResolvedValue(PAPER_TEXT)
  mocks.invoke.mockResolvedValue({ content: '{"core":"summary","keyPoints":["point1"]}' })
  service = createAiSummaryService(repos, mockWin, aiProvidersService, pdfTextService)
})

afterEach(() => {
  service.destroy()
  vi.useRealTimers()
})

const SUCCESS_RESPONSE = { content: '{"core":"summary","keyPoints":["point1"]}' }

function retryableError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

function makeInvokeSequence(...sequences: Array<Promise<unknown> | Error>): typeof mocks.invoke {
  let callIndex = 0
  return vi.fn(() => {
    const item = sequences[callIndex] ?? SUCCESS_RESPONSE
    callIndex++
    if (item instanceof Error) return Promise.reject(item)
    return Promise.resolve(item)
  }) as typeof mocks.invoke
}

function isDone(): boolean {
  return mocks.emitUpdated.mock.calls.length > 0 || mocks.emitError.mock.calls.length > 0
}

async function runToCompletion(maxSteps = 40): Promise<void> {
  service.summarize('d1')
  for (let i = 0; i < maxSteps; i++) {
    await vi.advanceTimersByTimeAsync(2000)
    if (isDone()) return
  }
  throw new Error('Summary did not complete within expected steps')
}

describe('aiSummary retry logic', () => {
  it('retries on retryable errors and succeeds', async () => {
    mocks.invoke = makeInvokeSequence(
      retryableError('rate limit exceeded', 429),
      retryableError('rate limit exceeded', 429),
      SUCCESS_RESPONSE
    )

    await runToCompletion()

    expect(mocks.setSummary).toHaveBeenCalledWith(
      'd1',
      'test-model',
      { core: 'summary', keyPoints: ['point1'] }
    )
    expect(mocks.emitUpdated).toHaveBeenCalled()
    expect(mocks.emitError).not.toHaveBeenCalled()
  })

  it('does not retry on non-retryable errors (401)', async () => {
    const authErr = retryableError('Invalid API key', 401)
    mocks.invoke = makeInvokeSequence(authErr)

    await runToCompletion()

    expect(mocks.setSummary).not.toHaveBeenCalled()
    expect(mocks.emitError).toHaveBeenCalledWith(
      mockWin,
      expect.objectContaining({
        docId: 'd1',
        message: expect.stringContaining('Invalid API key')
      })
    )
  })

  it('retries MAX_RETRIES times then emits error on persistent failure', async () => {
    mocks.invoke = makeInvokeSequence(
      retryableError('Internal Server Error', 500),
      retryableError('Internal Server Error', 500),
      retryableError('Internal Server Error', 500)
    )

    await runToCompletion()

    expect(mocks.setSummary).not.toHaveBeenCalled()
    expect(mocks.emitError).toHaveBeenCalledWith(
      mockWin,
      expect.objectContaining({
        docId: 'd1',
        message: expect.stringContaining('Internal Server Error')
      })
    )
  })

  it('retries on network error codes (ECONNRESET)', async () => {
    const netErr = Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' })
    mocks.invoke = makeInvokeSequence(netErr, SUCCESS_RESPONSE)

    await runToCompletion()

    expect(mocks.setSummary).toHaveBeenCalledWith(
      'd1',
      'test-model',
      { core: 'summary', keyPoints: ['point1'] }
    )
    expect(mocks.emitError).not.toHaveBeenCalled()
  })

  it('does not retry PDF extraction failures', async () => {
    mocks.pdfGetOrExtract.mockRejectedValue(new Error('PDF parse failed'))

    await runToCompletion()

    expect(mocks.pdfGetOrExtract).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.setSummary).not.toHaveBeenCalled()
    expect(mocks.emitError).toHaveBeenCalledWith(
      mockWin,
      expect.objectContaining({
        docId: 'd1',
        message: expect.stringContaining('PDF parse failed')
      })
    )
  })

  it('uses exponential backoff delays (1s, 2s) before retries', async () => {
    mocks.invoke = makeInvokeSequence(
      retryableError('server error', 503),
      retryableError('server error', 503),
      retryableError('server error', 503)
    )

    const warnSpy = mocks.logger.warn
    service.summarize('d1')

    await vi.advanceTimersByTimeAsync(1000)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('attempt=1/3')
    )
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('delay=1000ms')
    )

    await vi.advanceTimersByTimeAsync(2000)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('attempt=2/3')
    )
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('delay=2000ms')
    )

    await vi.advanceTimersByTimeAsync(5000)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('aiSummary:failed'))
  })
})
