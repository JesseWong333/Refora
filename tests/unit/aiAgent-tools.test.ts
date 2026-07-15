import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Repositories } from '../../src/main/db/repositories'
import type { AiProvidersService } from '../../src/main/services/aiProviders'
import type { PdfTextService } from '../../src/main/services/pdfText'
import type { AiProvider, ChatSendRequest, Document } from '../../src/shared/ipc-types'

interface CapturedTool {
  name: string
  func: (input: unknown) => Promise<string>
}

const mocks = vi.hoisted(() => ({
  openPath: vi.fn<(path: string) => Promise<string>>(),
  tools: [] as CapturedTool[]
}))

vi.mock('electron', () => ({
  shell: {
    openPath: mocks.openPath
  }
}))

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn()
}))

vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: ({ tools }: { tools: CapturedTool[] }) => {
    mocks.tools = tools
    return {
      streamEvents: async function* () {}
    }
  }
}))

vi.mock('@langchain/core/tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@langchain/core/tools')>()
  return {
    DynamicTool: actual.DynamicTool,
    DynamicStructuredTool: actual.DynamicStructuredTool
  }
})

vi.mock('@langchain/core/messages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@langchain/core/messages')>()
  return {
    SystemMessage: actual.SystemMessage,
    HumanMessage: actual.HumanMessage,
    AIMessage: actual.AIMessage
  }
})

vi.mock('../../src/main/ipc/events', () => ({
  emitAiChatToken: vi.fn(),
  emitAiChatDone: vi.fn(),
  emitAiChatError: vi.fn(),
  emitAiChatTrace: vi.fn(),
  emitAiReportCreated: vi.fn(),
  emitWorkspaceItemsChanged: vi.fn(),
  emitDocumentUpdated: vi.fn()
}))

vi.mock('../../src/main/services/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

const mockWin = { isDestroyed: () => false }

const mockDocumentsGet = vi.fn<(id: string) => Document | null>()

const repos = {
  documents: { get: mockDocumentsGet, setLastReadAt: vi.fn() },
  chat: {
    addMessage: vi.fn(),
    listMessages: vi.fn(() => []),
    getThread: vi.fn(() => null),
    updateTitle: vi.fn()
  },
  settings: { get: vi.fn(() => '') },
  workspaceItems: { list: vi.fn(() => [{ kind: 'document', docId: 'doc-1', id: 'item-1', workspaceId: 'ws-1', sortOrder: 0, addedAt: 0, reportId: null }]), add: vi.fn() },
  aiSummaries: { getSummary: vi.fn(() => null) },
  aiReports: { create: vi.fn(() => ({ id: 'r1' })) },
  agentTraces: {
    addStep: vi.fn(() => ({ id: 'step-1' })),
    updateStep: vi.fn(() => ({ id: 'step-1' }))
  }
} as unknown as Repositories

const aiProvidersService = {
  getProvider: vi.fn(
    (): AiProvider => ({
      id: 'p1',
      name: 'test',
      baseUrl: 'http://localhost',
      model: 'gpt-4o',
      baseModel: 'gpt-4o',
      variant: '',
      variantFormat: 'dash',
      hasKey: true,
      temperature: null,
      maxTokens: null,
      createdAt: 0
    })
  ),
  getDecryptedKey: vi.fn(() => 'key')
} as unknown as AiProvidersService

const pdfTextService = {
  getOrExtract: vi.fn(() => '')
} as unknown as PdfTextService

const aiSummaryService = { summarize: vi.fn(), destroy: vi.fn() } as never

const req: ChatSendRequest = {
  workspaceId: 'ws-1',
  text: 'hello',
  providerId: 'p1'
}

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    filePath: '/path/to/paper.pdf',
    originalFolderPath: '/original',
    fileName: 'paper.pdf',
    fileSize: 1000,
    fileHash: 'abc',
    title: 'Test Paper',
    authors: 'Author A; Author B',
    year: '2024',
    venue: 'ICML',
    volume: '1',
    issue: '2',
    pages: '1-10',
    abstract: 'An abstract.',
    keywords: 'machine learning',
    url: 'https://example.com',
    doi: '10.1000/test',
    note: null,
    starred: 0,
    addedAt: 0,
    lastReadAt: null,
    updatedAt: 0,
    metadataSource: null,
    metadataStatus: 'pending',
    metadataAttempts: 0,
    editedFields: [],
    remoteValues: null,
    fileMissing: 0,
    ...overrides
  }
}

function getTool(name: string): CapturedTool {
  const tool = mocks.tools.find((t) => t.name === name)
  if (!tool) throw new Error(`Tool not found: ${name}`)
  return tool
}

describe('AI agent tools', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockDocumentsGet.mockReturnValue(null)
    mocks.openPath.mockResolvedValue('')
    const { createAiAgentService } = await import('../../src/main/services/aiAgent')
    const service = createAiAgentService(
      repos,
      () => mockWin,
      aiProvidersService,
      pdfTextService,
      aiSummaryService
    )
    await service.run(req, 'thread-1')
  })

  describe('get_paper_metadata', () => {
    it('returns correct JSON when document exists', async () => {
      const doc = makeDoc()
      mockDocumentsGet.mockReturnValue(doc)
      const tool = getTool('get_paper_metadata')
      const result = await tool.func('doc-1')
      expect(JSON.parse(result)).toEqual({
        docId: 'doc-1',
        title: 'Test Paper',
        authors: 'Author A; Author B',
        year: '2024',
        venue: 'ICML',
        volume: '1',
        issue: '2',
        pages: '1-10',
        abstract: 'An abstract.',
        keywords: 'machine learning',
        doi: '10.1000/test',
        url: 'https://example.com'
      })
      expect(mockDocumentsGet).toHaveBeenCalledWith('doc-1')
    })

    it('returns "Document not found." when doc does not exist', async () => {
      mockDocumentsGet.mockReturnValue(null)
      const tool = getTool('get_paper_metadata')
      const result = await tool.func('nope')
      expect(result).toBe('Document not found.')
    })
  })

  describe('open_paper', () => {
    it('calls shell.openPath with the document filePath', async () => {
      const doc = makeDoc()
      mockDocumentsGet.mockReturnValue(doc)
      mocks.openPath.mockResolvedValue('')
      const tool = getTool('open_paper')
      await tool.func('doc-1')
      expect(mocks.openPath).toHaveBeenCalledWith('/path/to/paper.pdf')
    })

    it('returns error when doc does not exist', async () => {
      vi.mocked(repos.workspaceItems.list).mockReturnValue([
        { kind: 'document', docId: 'doc-1', id: 'item-1', workspaceId: 'ws-1', sortOrder: 0, addedAt: 0, reportId: null },
        { kind: 'document', docId: 'nope', id: 'item-2', workspaceId: 'ws-1', sortOrder: 0, addedAt: 0, reportId: null }
      ])
      mockDocumentsGet.mockReturnValue(null)
      const tool = getTool('open_paper')
      const result = await tool.func('nope')
      expect(result).toContain('Failed to open')
    })

    it('returns error when fileMissing is truthy', async () => {
      const doc = makeDoc({ fileMissing: 1 })
      mockDocumentsGet.mockReturnValue(doc)
      const tool = getTool('open_paper')
      const result = await tool.func('doc-1')
      expect(result).toContain('Failed to open')
      expect(mocks.openPath).not.toHaveBeenCalled()
    })

    it('returns error message when shell.openPath returns an error string', async () => {
      const doc = makeDoc()
      mockDocumentsGet.mockReturnValue(doc)
      mocks.openPath.mockResolvedValue('Failed to launch')
      const tool = getTool('open_paper')
      const result = await tool.func('doc-1')
      expect(result).toBe('Failed to open: Failed to launch')
    })
  })

  describe('read_paper_fulltext pagination', () => {
    const mockGetOrExtract = vi.mocked(pdfTextService.getOrExtract)

    it('returns first chunk with correct pagination metadata', async () => {
      mockDocumentsGet.mockReturnValue(makeDoc())
      mockGetOrExtract.mockResolvedValue('x'.repeat(20000))
      const tool = getTool('read_paper_fulltext')
      const result = await tool.func({ docId: 'doc-1', offset: 0, limit: 8000 })
      const parsed = JSON.parse(result)
      expect(parsed).toMatchObject({
        docId: 'doc-1',
        title: 'Test Paper',
        offset: 0,
        limit: 8000,
        totalChars: 20000,
        nextOffset: 8000,
        chunkIndex: 0,
        chunkCount: 3
      })
      expect(parsed.text).toBe('x'.repeat(8000))
      expect(parsed.text).toHaveLength(8000)
    })

    it('returns second chunk when offset=8000', async () => {
      mockDocumentsGet.mockReturnValue(makeDoc())
      mockGetOrExtract.mockResolvedValue('x'.repeat(20000))
      const tool = getTool('read_paper_fulltext')
      const result = await tool.func({ docId: 'doc-1', offset: 8000, limit: 8000 })
      const parsed = JSON.parse(result)
      expect(parsed).toMatchObject({
        offset: 8000,
        nextOffset: 16000,
        chunkIndex: 1,
        chunkCount: 3,
        totalChars: 20000
      })
      expect(parsed.text).toHaveLength(8000)
    })

    it('returns last chunk when offset=16000 with nextOffset=null', async () => {
      mockDocumentsGet.mockReturnValue(makeDoc())
      mockGetOrExtract.mockResolvedValue('x'.repeat(20000))
      const tool = getTool('read_paper_fulltext')
      const result = await tool.func({ docId: 'doc-1', offset: 16000, limit: 8000 })
      const parsed = JSON.parse(result)
      expect(parsed).toMatchObject({
        offset: 16000,
        nextOffset: null,
        chunkIndex: 2,
        chunkCount: 3,
        totalChars: 20000
      })
      expect(parsed.text).toHaveLength(4000)
    })

    it('returns empty text and message when offset is past end', async () => {
      mockDocumentsGet.mockReturnValue(makeDoc())
      mockGetOrExtract.mockResolvedValue('x'.repeat(20000))
      const tool = getTool('read_paper_fulltext')
      const result = await tool.func({ docId: 'doc-1', offset: 999999, limit: 8000 })
      const parsed = JSON.parse(result)
      expect(parsed).toMatchObject({
        text: '',
        nextOffset: null,
        totalChars: 20000,
        message: 'offset past end'
      })
    })

    it('clamps limit below 500 to 500', async () => {
      mockDocumentsGet.mockReturnValue(makeDoc())
      mockGetOrExtract.mockResolvedValue('x'.repeat(20000))
      const tool = getTool('read_paper_fulltext')
      const result = await tool.func({ docId: 'doc-1', offset: 0, limit: 100 })
      const parsed = JSON.parse(result)
      expect(parsed.limit).toBe(500)
      expect(parsed.text).toHaveLength(500)
    })

    it('returns error JSON when document is not found', async () => {
      mockDocumentsGet.mockReturnValue(null)
      const tool = getTool('read_paper_fulltext')
      const result = await tool.func({ docId: 'nope', offset: 0, limit: 8000 })
      expect(JSON.parse(result)).toEqual({ error: 'Document not found', docId: 'nope' })
    })

    it('uses default offset=0 and limit=8000 when only docId is provided', async () => {
      mockDocumentsGet.mockReturnValue(makeDoc())
      mockGetOrExtract.mockResolvedValue('x'.repeat(20000))
      const tool = getTool('read_paper_fulltext')
      const result = await tool.func({ docId: 'doc-1' })
      const parsed = JSON.parse(result)
      expect(parsed).toMatchObject({
        offset: 0,
        limit: 8000,
        totalChars: 20000,
        nextOffset: 8000,
        chunkIndex: 0,
        chunkCount: 3
      })
      expect(parsed.text).toHaveLength(8000)
    })
  })
})
