import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withDeepAgentRepositories } from '../helpers/deepAgentRepositories'
import type { Repositories } from '../../src/main/db/repositories'
import type { AiProvidersService } from '../../src/main/services/aiProviders'
import type { PdfTextService } from '../../src/main/services/pdfText'
import type { AiProvider, ChatSendRequest, Document, AiSummaryContent } from '../../src/shared/ipc-types'

interface CapturedTool {
  name: string
  invoke(input: unknown): Promise<string>
}

const mocks = vi.hoisted(() => ({
  tools: [] as CapturedTool[],
  emitWorkspaceItemsChanged: vi.fn()
}))

vi.mock('electron', () => ({
  shell: { openPath: vi.fn() }
}))

vi.mock('../../src/main/services/reforaDeepAgent', () => ({
  createReforaDeepAgent: ({
    enabledToolNames,
    executeHostOperation
  }: {
    enabledToolNames: string[]
    executeHostOperation: (
      name: string,
      args: Record<string, unknown>,
      toolCallId: string | null
    ) => Promise<string>
  }) => {
    mocks.tools = enabledToolNames.map((name) => ({
      name,
      invoke: (input: unknown) => executeHostOperation(
        name,
        input as Record<string, unknown>,
        null
      )
    }))
    return {
      streamEvents: async function* () {}
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
  emitWorkspaceItemsChanged: mocks.emitWorkspaceItemsChanged
}))

vi.mock('../../src/main/services/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const mockWin = { isDestroyed: () => false }

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    filePath: '/path/to/paper.pdf',
    originalFolderPath: '/original',
    fileName: 'paper.pdf',
    fileSize: 1000,
    fileHash: 'abc',
    title: 'Test Paper',
    authors: 'Author A',
    year: '2024',
    venue: 'ICML',
    volume: null,
    issue: null,
    pages: null,
    abstract: 'An abstract.',
    keywords: 'machine learning',
    url: null,
    doi: null,
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

const mockDocumentsGet = vi.fn<(id: string) => Document | null>()
const mockWorkspaceItemsList = vi.fn<() => { kind: string; docId: string | null }[]>()
const mockWorkspaceItemsAdd = vi.fn()
const mockGetSummary = vi.fn<(docId: string) => { content: AiSummaryContent | null } | null>()
const mockSummarize = vi.fn()

const repos = withDeepAgentRepositories({
  documents: { get: mockDocumentsGet },
  chat: {
    addMessage: vi.fn(),
    listMessages: vi.fn(() => []),
    getThread: vi.fn(() => null),
    updateTitle: vi.fn()
  },
  settings: { get: vi.fn(() => 'p1') },
  workspaceItems: { list: mockWorkspaceItemsList, add: mockWorkspaceItemsAdd },
  aiSummaries: { getSummary: mockGetSummary },
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

const pdfTextService = { getOrExtract: vi.fn(() => '') } as unknown as PdfTextService
const aiSummaryService = { summarize: mockSummarize, destroy: vi.fn() } as never

const req: ChatSendRequest = {
  workspaceId: 'ws-1',
  text: 'hello',
  providerId: 'p1'
}

function getTool(name: string): CapturedTool {
  const tool = mocks.tools.find((t) => t.name === name)
  if (!tool) throw new Error(`Tool not found: ${name}`)
  return tool
}

describe('add_docs_to_workspace tool', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockDocumentsGet.mockReturnValue(null)
    mockWorkspaceItemsList.mockReturnValue([])
    mockWorkspaceItemsAdd.mockReturnValue([])
    mockGetSummary.mockReturnValue(null)
    mockSummarize.mockReset()
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

  it('adds valid docIds not already in workspace', async () => {
    mockDocumentsGet.mockReturnValue(makeDoc({ id: 'doc-1' }))
    mockWorkspaceItemsList.mockReturnValue([])
    const tool = getTool('add_docs_to_workspace')
    const result = await tool.invoke({ docIds: 'doc-1' })
    const parsed = JSON.parse(result)
    expect(parsed.added).toEqual(['doc-1'])
    expect(parsed.alreadyInWorkspace).toEqual([])
    expect(parsed.missing).toEqual([])
    expect(mockWorkspaceItemsAdd).toHaveBeenCalledWith('ws-1', 'document', ['doc-1'])
  })

  it('reports alreadyInWorkspace for docs already pinned', async () => {
    mockDocumentsGet.mockReturnValue(makeDoc({ id: 'doc-1' }))
    mockWorkspaceItemsList.mockReturnValue([{ kind: 'document', docId: 'doc-1' }])
    const tool = getTool('add_docs_to_workspace')
    const result = await tool.invoke({ docIds: 'doc-1' })
    const parsed = JSON.parse(result)
    expect(parsed.added).toEqual([])
    expect(parsed.alreadyInWorkspace).toEqual(['doc-1'])
    expect(parsed.missing).toEqual([])
    expect(mockWorkspaceItemsAdd).not.toHaveBeenCalled()
  })

  it('reports missing for nonexistent docIds without throwing', async () => {
    mockDocumentsGet.mockReturnValue(null)
    const tool = getTool('add_docs_to_workspace')
    const result = await tool.invoke({ docIds: 'nope-1' })
    const parsed = JSON.parse(result)
    expect(parsed.added).toEqual([])
    expect(parsed.alreadyInWorkspace).toEqual([])
    expect(parsed.missing).toEqual(['nope-1'])
    expect(mockWorkspaceItemsAdd).not.toHaveBeenCalled()
  })

  it('returns error for empty docIds without DB writes', async () => {
    const tool = getTool('add_docs_to_workspace')
    const result = await tool.invoke({ docIds: '' })
    const parsed = JSON.parse(result)
    expect(parsed.error).toBeTruthy()
    expect(parsed.added).toEqual([])
    expect(mockWorkspaceItemsAdd).not.toHaveBeenCalled()
  })

  it('handles mixed valid, existing, and missing docIds', async () => {
    mockDocumentsGet.mockImplementation((id: string) => {
      if (id === 'doc-1' || id === 'doc-3') return makeDoc({ id })
      return null
    })
    mockWorkspaceItemsList.mockReturnValue([{ kind: 'document', docId: 'doc-1' }])
    const tool = getTool('add_docs_to_workspace')
    const result = await tool.invoke({ docIds: 'doc-1,doc-2,doc-3' })
    const parsed = JSON.parse(result)
    expect(parsed.added).toEqual(['doc-3'])
    expect(parsed.alreadyInWorkspace).toEqual(['doc-1'])
    expect(parsed.missing).toEqual(['doc-2'])
  })

  it('emits workspaceItemsChanged when docs are added', async () => {
    mockDocumentsGet.mockReturnValue(makeDoc({ id: 'doc-1' }))
    mockWorkspaceItemsList.mockReturnValue([])
    const tool = getTool('add_docs_to_workspace')
    await tool.invoke({ docIds: 'doc-1' })
    expect(mocks.emitWorkspaceItemsChanged).toHaveBeenCalledWith(
      mockWin,
      expect.objectContaining({
        workspaceId: 'ws-1',
        reason: 'agent_add_docs',
        docIds: ['doc-1']
      })
    )
  })

  it('does not emit when nothing is added', async () => {
    mockDocumentsGet.mockReturnValue(makeDoc({ id: 'doc-1' }))
    mockWorkspaceItemsList.mockReturnValue([{ kind: 'document', docId: 'doc-1' }])
    const tool = getTool('add_docs_to_workspace')
    await tool.invoke({ docIds: 'doc-1' })
    expect(mocks.emitWorkspaceItemsChanged).not.toHaveBeenCalled()
  })

  it('accepts JSON array string for docIds', async () => {
    mockDocumentsGet.mockReturnValue(makeDoc({ id: 'doc-1' }))
    mockWorkspaceItemsList.mockReturnValue([])
    const tool = getTool('add_docs_to_workspace')
    const result = await tool.invoke({ docIds: JSON.stringify(['doc-1']) })
    const parsed = JSON.parse(result)
    expect(parsed.added).toEqual(['doc-1'])
  })
})

describe('request_summary tool', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockDocumentsGet.mockReturnValue(null)
    mockGetSummary.mockReturnValue(null)
    mockSummarize.mockReset()
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

  it('returns ready with summary when one already exists', async () => {
    const content: AiSummaryContent = { core: 'Core summary', keyPoints: ['point 1'] }
    mockDocumentsGet.mockReturnValue(makeDoc({ id: 'doc-1' }))
    mockGetSummary.mockReturnValue({ content })
    const tool = getTool('request_summary')
    const result = await tool.invoke({ docId: 'doc-1' })
    const parsed = JSON.parse(result)
    expect(parsed.status).toBe('ready')
    expect(parsed.summary).toEqual(content)
    expect(mockSummarize).not.toHaveBeenCalled()
  })

  it('queues summary when none exists', async () => {
    mockDocumentsGet.mockReturnValue(makeDoc({ id: 'doc-1' }))
    mockGetSummary.mockReturnValue(null)
    const tool = getTool('request_summary')
    const result = await tool.invoke({ docId: 'doc-1' })
    const parsed = JSON.parse(result)
    expect(parsed.status).toBe('queued')
    expect(parsed.docId).toBe('doc-1')
    expect(mockSummarize).toHaveBeenCalledTimes(1)
    expect(mockSummarize).toHaveBeenCalledWith('doc-1')
  })

  it('queues summary when existing summary has no content', async () => {
    mockDocumentsGet.mockReturnValue(makeDoc({ id: 'doc-1' }))
    mockGetSummary.mockReturnValue({ content: null })
    const tool = getTool('request_summary')
    const result = await tool.invoke({ docId: 'doc-1' })
    const parsed = JSON.parse(result)
    expect(parsed.status).toBe('queued')
    expect(mockSummarize).toHaveBeenCalledTimes(1)
  })

  it('returns error for nonexistent document', async () => {
    mockDocumentsGet.mockReturnValue(null)
    const tool = getTool('request_summary')
    const result = await tool.invoke({ docId: 'nope' })
    const parsed = JSON.parse(result)
    expect(parsed.status).toBe('error')
    expect(parsed.message).toBeTruthy()
    expect(mockSummarize).not.toHaveBeenCalled()
  })
})
