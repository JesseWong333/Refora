import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Document, AiProvider, AiSummaryContent } from '../../src/shared/ipc-types'
import type { Repositories } from '../../src/main/db/repositories'

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn()
}))

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(class {
    invoke = mockInvoke
  })
}))

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString())
  }
}))

const { mockEmitUpdated, mockEmitError } = vi.hoisted(() => ({
  mockEmitUpdated: vi.fn(),
  mockEmitError: vi.fn()
}))

vi.mock('../../src/main/ipc/events', () => ({
  emitAiSummaryUpdated: mockEmitUpdated,
  emitAiSummaryError: mockEmitError
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

const mockDoc = { id: 'doc-1', filePath: '/test/file.pdf' } as unknown as Document
const mockProvider: AiProvider = {
  id: 'p1',
  name: 'Test',
  baseUrl: 'https://api.test.com/v1',
  model: 'gpt-4o',
  baseModel: 'gpt-4o',
  variant: '',
  variantFormat: 'dash',
  hasKey: true,
  temperature: null,
  maxTokens: null,
  createdAt: 1700000000000
}

function makeMockRepos(): Repositories {
  return {
    documents: { get: vi.fn(() => mockDoc) },
    settings: { get: vi.fn(() => 'p1') },
    aiSummaries: {
      setSummary: vi.fn(),
      getFullText: vi.fn(() => null)
    }
  } as unknown as Repositories & { aiSummaries: { setSummary: ReturnType<typeof vi.fn>; getFullText: ReturnType<typeof vi.fn> } }
}

function makeMockAiProviders() {
  return {
    getProvider: vi.fn(() => mockProvider),
    getDecryptedKey: vi.fn(() => 'secret-key')
  }
}

function makeMockPdfText(text: string = 'Short text content') {
  return {
    getOrExtract: vi.fn(async () => text)
  }
}

function makeMockWin() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() }
  } as never
}

let repos: ReturnType<typeof makeMockRepos>
let aiProviders: ReturnType<typeof makeMockAiProviders>
let pdfText: ReturnType<typeof makeMockPdfText>
let service: ReturnType<typeof createAiSummaryService>
const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockReset()
  repos = makeMockRepos()
  aiProviders = makeMockAiProviders()
  pdfText = makeMockPdfText()
  service = createAiSummaryService(repos, makeMockWin(), aiProviders as never, pdfText as never)
})

afterEach(() => {
  service.destroy()
})

describe('AiSummaryService', () => {
  describe('splitText logic (via invoke call count)', () => {
    it('empty text: 0 invoke calls, setSummary with empty content', async () => {
      pdfText.getOrExtract.mockResolvedValue('')
      service.summarize('doc-1')
      await vi.waitFor(() => expect(repos.aiSummaries.setSummary).toHaveBeenCalledTimes(1))
      expect(mockInvoke).not.toHaveBeenCalled()
      const content = repos.aiSummaries.setSummary.mock.calls[0][2] as AiSummaryContent
      expect(content).toEqual({ core: '', keyPoints: [] })
    })

    it('short text (<= chunk size): 2 invoke calls (1 chunk + 1 final)', async () => {
      pdfText.getOrExtract.mockResolvedValue('Short text')
      mockInvoke.mockResolvedValue({ content: 'chunk summary' })
      mockInvoke.mockResolvedValueOnce({ content: 'chunk summary' })
      mockInvoke.mockResolvedValueOnce({ content: '{"core":"Core","keyPoints":["a"]}' })

      service.summarize('doc-1')
      await vi.waitFor(() => expect(repos.aiSummaries.setSummary).toHaveBeenCalledTimes(1))
      expect(mockInvoke).toHaveBeenCalledTimes(2)
    })

    it('long text (> chunk size): multiple chunks + 1 final invoke', async () => {
      const longText = 'x'.repeat(6500)
      pdfText.getOrExtract.mockResolvedValue(longText)
      mockInvoke.mockResolvedValue({ content: 'chunk summary' })
      mockInvoke.mockResolvedValueOnce({ content: 'chunk1' })
      mockInvoke.mockResolvedValueOnce({ content: 'chunk2' })
      mockInvoke.mockResolvedValueOnce({ content: 'chunk3' })
      mockInvoke.mockResolvedValueOnce({ content: '{"core":"Final","keyPoints":[]}' })

      service.summarize('doc-1')
      await vi.waitFor(() => expect(repos.aiSummaries.setSummary).toHaveBeenCalledTimes(1))
      expect(mockInvoke).toHaveBeenCalledTimes(4)
    })
  })

  describe('processSummary error paths', () => {
    it('when doc not found: calls emit with docId, returns early', async () => {
      repos.documents.get = vi.fn(() => null)
      service.summarize('doc-1')
      await flush(10)
      expect(mockEmitUpdated).toHaveBeenCalledWith(expect.anything(), 'doc-1')
      expect(mockEmitError).not.toHaveBeenCalled()
      expect(pdfText.getOrExtract).not.toHaveBeenCalled()
    })

    it('when pdfText extraction fails: calls emitError with Failed to extract PDF text', async () => {
      pdfText.getOrExtract.mockRejectedValue(new Error('extraction error'))
      service.summarize('doc-1')
      await vi.waitFor(() => expect(mockEmitError).toHaveBeenCalledTimes(1))
      const payload = mockEmitError.mock.calls[0][1] as { docId: string; message: string }
      expect(payload.docId).toBe('doc-1')
      expect(payload.message).toContain('Failed to extract PDF text')
    })

    it('when no active provider: calls emitError with No AI provider configured', async () => {
      repos.settings.get = vi.fn(() => '')
      service.summarize('doc-1')
      await vi.waitFor(() => expect(mockEmitError).toHaveBeenCalledTimes(1))
      const payload = mockEmitError.mock.calls[0][1] as { docId: string; message: string }
      expect(payload.message).toContain('No AI provider configured')
    })

    it('when provider decryption fails: calls emitError', async () => {
      aiProviders.getProvider.mockImplementation(() => {
        throw new Error('provider not found')
      })
      service.summarize('doc-1')
      await vi.waitFor(() => expect(mockEmitError).toHaveBeenCalledTimes(1))
      const payload = mockEmitError.mock.calls[0][1] as { docId: string; message: string }
      expect(payload.message).toContain('AI provider unavailable')
    })

    it('when getDecryptedKey fails: calls emitError', async () => {
      aiProviders.getDecryptedKey.mockImplementation(() => {
        throw new Error('decryption failed')
      })
      service.summarize('doc-1')
      await vi.waitFor(() => expect(mockEmitError).toHaveBeenCalledTimes(1))
      const payload = mockEmitError.mock.calls[0][1] as { docId: string; message: string }
      expect(payload.message).toContain('AI provider unavailable')
    })
  })

  describe('processSummary normal flow', () => {
    it('single chunk: calls invoke twice, setSummary, and emit', async () => {
      pdfText.getOrExtract.mockResolvedValue('Some text content')
      mockInvoke.mockResolvedValueOnce({ content: 'chunk summary' })
      mockInvoke.mockResolvedValueOnce({
        content: '{"core":"Core summary","keyPoints":["point1","point2"]}'
      })

      service.summarize('doc-1')
      await vi.waitFor(() => expect(repos.aiSummaries.setSummary).toHaveBeenCalledTimes(1))

      expect(mockInvoke).toHaveBeenCalledTimes(2)
      const [docId, model, content] = repos.aiSummaries.setSummary.mock.calls[0] as [
        string,
        string,
        AiSummaryContent
      ]
      expect(docId).toBe('doc-1')
      expect(model).toBe('gpt-4o')
      expect(content).toEqual({ core: 'Core summary', keyPoints: ['point1', 'point2'] })
      expect(mockEmitUpdated).toHaveBeenCalledWith(expect.anything(), 'doc-1')
    })

    it('JSON parse failure: setSummary called with fallback content (core=raw text, keyPoints=[])', async () => {
      pdfText.getOrExtract.mockResolvedValue('Some text content')
      mockInvoke.mockResolvedValueOnce({ content: 'chunk summary' })
      mockInvoke.mockResolvedValueOnce({ content: 'This is not JSON at all' })

      service.summarize('doc-1')
      await vi.waitFor(() => expect(repos.aiSummaries.setSummary).toHaveBeenCalledTimes(1))

      const content = repos.aiSummaries.setSummary.mock.calls[0][2] as AiSummaryContent
      expect(content).toEqual({ core: 'This is not JSON at all', keyPoints: [] })
    })

    it('JSON with code fences: strips fences and parses correctly', async () => {
      pdfText.getOrExtract.mockResolvedValue('Some text content')
      mockInvoke.mockResolvedValueOnce({ content: 'chunk summary' })
      mockInvoke.mockResolvedValueOnce({
        content: '```json\n{"core":"Fenced","keyPoints":["a"]}\n```'
      })

      service.summarize('doc-1')
      await vi.waitFor(() => expect(repos.aiSummaries.setSummary).toHaveBeenCalledTimes(1))

      const content = repos.aiSummaries.setSummary.mock.calls[0][2] as AiSummaryContent
      expect(content).toEqual({ core: 'Fenced', keyPoints: ['a'] })
    })

    it('handles array content from model response', async () => {
      pdfText.getOrExtract.mockResolvedValue('Some text content')
      mockInvoke.mockResolvedValueOnce({ content: [{ type: 'text', text: 'chunk summary' }] })
      mockInvoke.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"core":"Array","keyPoints":[]}' }]
      })

      service.summarize('doc-1')
      await vi.waitFor(() => expect(repos.aiSummaries.setSummary).toHaveBeenCalledTimes(1))

      const content = repos.aiSummaries.setSummary.mock.calls[0][2] as AiSummaryContent
      expect(content).toEqual({ core: 'Array', keyPoints: [] })
    })

    it('optional fields methods and contribution are preserved', async () => {
      pdfText.getOrExtract.mockResolvedValue('Some text content')
      mockInvoke.mockResolvedValueOnce({ content: 'chunk summary' })
      mockInvoke.mockResolvedValueOnce({
        content:
          '{"core":"Core","keyPoints":["a"],"methods":"Survey of methods","contribution":"Key contribution"}'
      })

      service.summarize('doc-1')
      await vi.waitFor(() => expect(repos.aiSummaries.setSummary).toHaveBeenCalledTimes(1))

      const content = repos.aiSummaries.setSummary.mock.calls[0][2] as AiSummaryContent
      expect(content.methods).toBe('Survey of methods')
      expect(content.contribution).toBe('Key contribution')
    })
  })

  describe('destroyed mid-process', () => {
    it('destroyed before setSummary: setSummary not called', async () => {
      pdfText.getOrExtract.mockResolvedValue('Some text content')
      mockInvoke.mockResolvedValueOnce({ content: 'chunk summary' })
      let resolveFinal!: (v: { content: string }) => void
      mockInvoke.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFinal = resolve
        })
      )

      service.summarize('doc-1')
      await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2))

      service.destroy()
      resolveFinal({ content: '{"core":"x","keyPoints":[]}' })
      await flush(50)

      expect(repos.aiSummaries.setSummary).not.toHaveBeenCalled()
    })

    it('destroyed after text extraction but before provider resolution: setSummary not called', async () => {
      let resolveExtract!: (v: string) => void
      pdfText.getOrExtract.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveExtract = resolve
        })
      )

      service.summarize('doc-1')
      await flush(10)

      service.destroy()
      resolveExtract('Some text content')
      await flush(50)

      expect(repos.aiSummaries.setSummary).not.toHaveBeenCalled()
      expect(aiProviders.getProvider).not.toHaveBeenCalled()
    })
  })

  describe('summarize queue', () => {
    it('respects MAX_CONCURRENT=2 limit', async () => {
      pdfText.getOrExtract.mockResolvedValue('text')
      let active = 0
      let maxConcurrent = 0
      mockInvoke.mockImplementation(async () => {
        active++
        maxConcurrent = Math.max(maxConcurrent, active)
        await flush(20)
        active--
        return { content: 'summary' }
      })

      service.summarize('doc-1')
      service.summarize('doc-2')
      service.summarize('doc-3')
      service.summarize('doc-4')

      await vi.waitFor(() => expect(repos.aiSummaries.setSummary).toHaveBeenCalledTimes(4))
      expect(maxConcurrent).toBeLessThanOrEqual(2)
    })

    it('destroy clears queue: pending jobs do not call setSummary', async () => {
      pdfText.getOrExtract.mockResolvedValue('text')
      mockInvoke.mockImplementation(() => new Promise((r) => setTimeout(r, 10000)))

      service.summarize('doc-1')
      service.summarize('doc-2')
      service.summarize('doc-3')
      service.summarize('doc-4')

      service.destroy()
      await flush(50)

      expect(repos.aiSummaries.setSummary).not.toHaveBeenCalled()
    })
  })
})
