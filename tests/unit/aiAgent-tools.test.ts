import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withDeepAgentRepositories } from '../helpers/deepAgentRepositories'
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
  tools: [] as CapturedTool[],
  messages: [] as unknown[],
  systemPrompt: ''
}))

vi.mock('electron', () => ({
  shell: {
    openPath: mocks.openPath
  }
}))

vi.mock('../../src/main/services/pdfPath', () => ({
  resolvePdfFilePath: (filePath: string) => filePath
}))

vi.mock('../../src/main/services/reforaDeepAgent', () => ({
  createReforaDeepAgent: ({
    enabledToolNames,
    executeHostOperation,
    systemPrompt
  }: {
    enabledToolNames: string[]
    executeHostOperation: (
      name: string,
      args: Record<string, unknown>,
      toolCallId: string | null
    ) => Promise<string>
    systemPrompt: string
  }) => {
    mocks.tools = enabledToolNames.map((name) => ({
      name,
      func: (input: unknown) => executeHostOperation(
        name,
        typeof input === 'string'
          ? {
              [name === 'search_library' || name === 'search_workspace_docs'
                ? 'query'
                : 'docId']: input
            }
          : input as Record<string, unknown>,
        null
      )
    }))
    mocks.systemPrompt = systemPrompt
    return {
      streamEvents: async function* (input: { messages: unknown[] }) {
        mocks.messages = input.messages
        yield* []
      }
    }
  }
}))

vi.mock('../../src/main/ipc/events', () => ({
  emitAiChatToken: vi.fn(),
  emitAiChatDone: vi.fn(),
  emitAiChatError: vi.fn(),
  emitAiChatInterrupted: vi.fn(),
  emitAiChatRunStatus: vi.fn(),
  emitAiChatTitleUpdated: vi.fn(),
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

const repos = withDeepAgentRepositories({
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
} as unknown as Repositories)

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

  it('uses only library context and tools for a global chat', async () => {
    vi.mocked(repos.workspaceItems.list).mockClear()
    const { createAiAgentService } = await import('../../src/main/services/aiAgent')
    const service = createAiAgentService(
      repos,
      () => mockWin,
      aiProvidersService,
      pdfTextService,
      aiSummaryService
    )

    await service.run({ ...req, workspaceId: null }, 'global-thread')

    const toolNames = mocks.tools.map((tool) => tool.name)
    expect(toolNames).toEqual([
      'search_library',
      'find_related_papers',
      'read_paper_fulltext',
      'read_paper_ocr_fulltext',
      'prepare_paper_ocr',
      'get_paper_summary',
      'get_paper_metadata',
      'open_paper',
      'request_summary',
      'install_runtime_packages',
      'publish_workspace_artifacts',
      'propose_workspace_memory_update'
    ])
    expect(repos.workspaceItems.list).not.toHaveBeenCalled()
    expect(mocks.systemPrompt).toContain("user's local library")
    expect(mocks.systemPrompt).toContain('Always try read_paper_fulltext before OCR')
    expect(mocks.systemPrompt).toContain(
      'Never ask the user to approve OCR in assistant text'
    )
    expect(mocks.systemPrompt).not.toContain('Workspace paper catalog')
    expect(mocks.systemPrompt).not.toContain('A workspace is selected')
  })

  it('always registers academic tools and lets the Agent decide whether to call them', async () => {
    const search = vi.fn(async () => ({
      papers: [],
      total: 0,
      fetchedAt: '2026-01-01T00:00:00.000Z',
      cached: false
    }))
    const academicResearch = {
      arxivClient: { search },
      arxivPaperService: { getPaper: vi.fn() },
      identityService: { resolve: vi.fn() },
      graphService: {
        getCitingPapers: vi.fn(),
        getReferencedPapers: vi.fn(),
        getRecommendations: vi.fn()
      },
      frontierService: {
        start: vi.fn(),
        expand: vi.fn(),
        continuePage: vi.fn(),
        deleteThread: vi.fn()
      }
    }
    const { createAiAgentService } = await import('../../src/main/services/aiAgent')
    const service = createAiAgentService(
      repos,
      () => mockWin,
      aiProvidersService,
      pdfTextService,
      aiSummaryService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      academicResearch as never
    )

    await service.run({
      ...req,
      threadId: 'thread-academic'
    }, 'thread-academic')

    const toolNames = mocks.tools.map((tool) => tool.name)
    expect(toolNames).toEqual(expect.arrayContaining([
      'search_arxiv',
      'get_arxiv_paper',
      'resolve_academic_identity',
      'get_citing_papers',
      'get_referenced_papers',
      'get_semantic_recommendations',
      'explore_research_frontier'
    ]))
    expect(mocks.systemPrompt).toContain(
      'make the semantic relevance judgment yourself'
    )
    expect(mocks.systemPrompt).toContain(
      'Do not turn provider order, citation count, or metadata similarity into a definitive relevance score'
    )
    expect(mocks.systemPrompt).toContain(
      'do not use them for unrelated questions'
    )
    expect(mocks.systemPrompt).toContain('/memories/research.md')

    const result = await getTool('search_arxiv').func({
      query: 'research agents',
      pageSize: 10,
      sort: 'submitted_date',
      categories: []
    })
    expect(JSON.parse(result)).toMatchObject({ papers: [], total: 0 })
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'research agents', pageSize: 10 }),
      expect.any(AbortSignal)
    )
  })

  it('does not expose research memory instructions or paths in global chat', async () => {
    const academicResearch = {
      arxivClient: { search: vi.fn() },
      arxivPaperService: { getPaper: vi.fn() },
      identityService: { resolve: vi.fn() },
      graphService: {
        getCitingPapers: vi.fn(),
        getReferencedPapers: vi.fn(),
        getRecommendations: vi.fn()
      },
      frontierService: {
        start: vi.fn(),
        expand: vi.fn(),
        continuePage: vi.fn(),
        deleteThread: vi.fn()
      }
    }
    const { createAiAgentService } = await import('../../src/main/services/aiAgent')
    const service = createAiAgentService(
      repos,
      () => mockWin,
      aiProvidersService,
      pdfTextService,
      aiSummaryService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      academicResearch as never
    )

    await service.run({
      ...req,
      workspaceId: null
    }, 'global-academic')

    expect(mocks.systemPrompt).not.toContain('/memories/research.md')
    expect(mocks.tools.map((tool) => tool.name)).toContain(
      'propose_workspace_memory_update'
    )
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

  describe('read_paper_ocr_fulltext pagination', () => {
    it('reads quality OCR Markdown from cache without starting OCR', async () => {
      const readCachedForAgent = vi.fn(async () => ({
        result: {
          profile: 'quality',
          resultKey: 'ocr-result-1'
        },
        markdown: '# OCR paper\n\n' + 'x'.repeat(15000)
      }))
      mockDocumentsGet.mockReturnValue(makeDoc())
      const { createAiAgentService } = await import('../../src/main/services/aiAgent')
      const service = createAiAgentService(
        repos,
        () => mockWin,
        aiProvidersService,
        pdfTextService,
        aiSummaryService,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { readCachedForAgent } as never
      )
      await service.run(req, 'ocr-thread')

      const tool = getTool('read_paper_ocr_fulltext')
      const parsed = JSON.parse(await tool.func({
        docId: 'doc-1',
        offset: 0,
        limit: 8000
      }))

      expect(parsed).toMatchObject({
        docId: 'doc-1',
        title: 'Test Paper',
        source: 'mineru_ocr',
        profile: 'quality',
        resultKey: 'ocr-result-1',
        offset: 0,
        limit: 8000,
        nextOffset: 8000,
        chunkIndex: 0,
        chunkCount: 2
      })
      expect(parsed.text).toHaveLength(8000)
      expect(readCachedForAgent).toHaveBeenCalledWith('doc-1')
    })

    it('directs the Agent to the approved preparation tool when cache is missing', async () => {
      const readCachedForAgent = vi.fn(async () => null)
      mockDocumentsGet.mockReturnValue(makeDoc())
      const { createAiAgentService } = await import('../../src/main/services/aiAgent')
      const service = createAiAgentService(
        repos,
        () => mockWin,
        aiProvidersService,
        pdfTextService,
        aiSummaryService,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { readCachedForAgent } as never
      )
      await service.run(req, 'ocr-cache-miss-thread')

      const result = await getTool('read_paper_ocr_fulltext').func({ docId: 'doc-1' })

      expect(JSON.parse(result)).toEqual({
        status: 'ocr_cache_missing',
        docId: 'doc-1',
        nextTool: 'prepare_paper_ocr',
        approval: 'handled_by_application',
        instruction:
          'Call prepare_paper_ocr now. Do not ask for approval in assistant text; the application will show the approval UI.'
      })
      expect(readCachedForAgent).toHaveBeenCalledWith('doc-1')
    })

    it('returns an unavailable error when OCR is not configured', async () => {
      mockDocumentsGet.mockReturnValue(makeDoc())
      const tool = getTool('read_paper_ocr_fulltext')
      const result = await tool.func({ docId: 'doc-1' })

      expect(JSON.parse(result)).toEqual({
        error: 'OCR service is unavailable',
        docId: 'doc-1'
      })
    })
  })

  describe('prepare_paper_ocr', () => {
    it('runs balanced OCR and returns reusable cache metadata', async () => {
      const prepareForAgent = vi.fn(async () => ({
        result: {
          profile: 'balanced',
          resultKey: 'ocr-result-2'
        },
        markdown: '# Prepared OCR'
      }))
      mockDocumentsGet.mockReturnValue(makeDoc())
      const { createAiAgentService } = await import('../../src/main/services/aiAgent')
      const service = createAiAgentService(
        repos,
        () => mockWin,
        aiProvidersService,
        pdfTextService,
        aiSummaryService,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { prepareForAgent } as never
      )
      await service.run(req, 'ocr-prepare-thread')

      const parsed = JSON.parse(
        await getTool('prepare_paper_ocr').func({ docId: 'doc-1' })
      )

      expect(parsed).toEqual({
        docId: 'doc-1',
        title: 'Test Paper',
        source: 'mineru_ocr',
        profile: 'balanced',
        resultKey: 'ocr-result-2',
        totalChars: 14,
        message: 'Balanced OCR cache is ready. Continue with read_paper_ocr_fulltext.'
      })
      expect(prepareForAgent).toHaveBeenCalledWith('doc-1', expect.any(AbortSignal))
    })
  })
})
