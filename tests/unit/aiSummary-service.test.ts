import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiProvider, AiSummaryContent, Document } from '../../src/shared/ipc-types'
import type { Repositories } from '../../src/main/db/repositories'

const mocks = vi.hoisted(() => ({
  emitUpdated: vi.fn(),
  emitError: vi.fn(),
  generateSummary: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: vi.fn()
}))

vi.mock('../../src/main/ipc/events', () => ({
  emitAiSummaryUpdated: mocks.emitUpdated,
  emitAiSummaryError: mocks.emitError
}))

vi.mock('../../src/main/services/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

import { createAiSummaryService } from '../../src/main/services/aiSummary'

const doc = { id: 'doc-1', filePath: '/test/file.pdf' } as unknown as Document
const provider: AiProvider = {
  id: 'p1',
  presetId: 'openai',
  name: 'Test',
  baseUrl: 'https://api.test.com/v1',
  apiProtocol: 'openai-chat',
  reasoningControl: 'none',
  reasoningEffort: 'none',
  model: 'gpt-4o',
  baseModel: 'gpt-4o',
  variant: '',
  variantFormat: 'none',
  hasKey: true,
  temperature: null,
  maxTokens: null,
  createdAt: 1700000000000
}

function makeRepos(): Repositories {
  return {
    documents: { get: vi.fn(() => doc) },
    settings: { get: vi.fn(() => 'p1') },
    aiSummaries: {
      setSummary: vi.fn()
    }
  } as unknown as Repositories
}

function makeWin() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() }
  } as never
}

let repos: ReturnType<typeof makeRepos>
let pdfText: { getOrExtract: ReturnType<typeof vi.fn> }
let providers: {
  getProvider: ReturnType<typeof vi.fn>
  getDecryptedKey: ReturnType<typeof vi.fn>
}
let service: ReturnType<typeof createAiSummaryService>

beforeEach(() => {
  vi.clearAllMocks()
  repos = makeRepos()
  pdfText = { getOrExtract: vi.fn(async () => 'Extracted paper text') }
  providers = {
    getProvider: vi.fn(() => provider),
    getDecryptedKey: vi.fn(() => 'secret-key')
  }
  mocks.generateSummary.mockResolvedValue({
    core: 'Core summary',
    keyPoints: ['point 1', 'point 2']
  })
  service = createAiSummaryService(
    repos,
    makeWin(),
    providers as never,
    pdfText as never,
    { generateSummary: mocks.generateSummary } as never
  )
})

afterEach(() => {
  service.destroy()
})

describe('AiSummaryService Python backend', () => {
  it('extracts text, delegates the complete summary job to Python, and persists the result', async () => {
    service.summarize('doc-1')

    await vi.waitFor(() => {
      expect(repos.aiSummaries.setSummary).toHaveBeenCalledTimes(1)
    })
    expect(mocks.generateSummary).toHaveBeenCalledWith(
      {
        provider: {
          model: 'gpt-4o',
          baseUrl: 'https://api.test.com/v1',
          apiKey: 'secret-key',
          useResponsesApi: false,
          modelKwargs: {},
          temperature: null,
          maxTokens: 450
        },
        text: 'Extracted paper text'
      },
      expect.any(AbortSignal)
    )
    expect(repos.aiSummaries.setSummary).toHaveBeenCalledWith(
      'doc-1',
      'gpt-4o',
      { core: 'Core summary', keyPoints: ['point 1', 'point 2'] }
    )
    expect(mocks.emitUpdated).toHaveBeenCalledWith(expect.anything(), 'doc-1')
  })

  it('preserves an empty summary returned by Python', async () => {
    pdfText.getOrExtract.mockResolvedValue('')
    mocks.generateSummary.mockResolvedValue({ core: '', keyPoints: [] })

    service.summarize('doc-1')

    await vi.waitFor(() => {
      expect(repos.aiSummaries.setSummary).toHaveBeenCalledTimes(1)
    })
    const content = vi.mocked(repos.aiSummaries.setSummary).mock.calls[0][2] as AiSummaryContent
    expect(content).toEqual({ core: '', keyPoints: [] })
  })

  it('reports extraction, provider, and Python generation failures without persisting', async () => {
    pdfText.getOrExtract.mockRejectedValueOnce(new Error('extract failed'))
    service.summarize('doc-1')
    await vi.waitFor(() => expect(mocks.emitError).toHaveBeenCalledTimes(1))
    expect(mocks.emitError.mock.calls[0][1].message).toContain('Failed to extract PDF text')
    expect(repos.aiSummaries.setSummary).not.toHaveBeenCalled()

    vi.clearAllMocks()
    pdfText.getOrExtract.mockResolvedValue('text')
    providers.getProvider.mockImplementationOnce(() => {
      throw new Error('provider missing')
    })
    service.summarize('doc-1')
    await vi.waitFor(() => expect(mocks.emitError).toHaveBeenCalledTimes(1))
    expect(mocks.emitError.mock.calls[0][1].message).toContain('AI provider unavailable')

    vi.clearAllMocks()
    providers.getProvider.mockReturnValue(provider)
    mocks.generateSummary.mockRejectedValueOnce(Object.assign(new Error('bad key'), { status: 401 }))
    service.summarize('doc-1')
    await vi.waitFor(() => expect(mocks.emitError).toHaveBeenCalledTimes(1))
    expect(mocks.emitError.mock.calls[0][1].message).toContain('Summary generation failed')
  })

  it('does not persist a late Python result after destruction', async () => {
    let resolve!: (value: AiSummaryContent) => void
    mocks.generateSummary.mockReturnValueOnce(new Promise((done) => {
      resolve = done
    }))

    service.summarize('doc-1')
    await vi.waitFor(() => expect(mocks.generateSummary).toHaveBeenCalledTimes(1))
    service.destroy()
    resolve({ core: 'late', keyPoints: [] })
    await new Promise((done) => setTimeout(done, 10))

    expect(repos.aiSummaries.setSummary).not.toHaveBeenCalled()
  })
})
