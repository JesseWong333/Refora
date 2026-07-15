import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Repositories } from '../../src/main/db/repositories'
import type { AiProvidersService } from '../../src/main/services/aiProviders'
import type { PdfTextService } from '../../src/main/services/pdfText'
import type { ChatSendRequest, Document } from '../../src/shared/ipc-types'
import { createAiAgentService } from '../../src/main/services/aiAgent'

interface SearchLibraryTool {
  invoke(input: string): Promise<string>
}

const { capturedTools, createAgentMock } = vi.hoisted(() => {
  const capturedTools = { value: [] as unknown[] }
  const mockAgent = {
    streamEvents: async function* () {}
  }
  const createAgentMock = vi.fn((opts: { tools: unknown[] }) => {
    capturedTools.value = opts.tools
    return mockAgent
  })
  return { capturedTools, createAgentMock }
})

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn()
}))
vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: createAgentMock
}))
vi.mock('../../src/main/services/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))
vi.mock('../../src/main/ipc/events', () => ({
  emitAiChatToken: vi.fn(),
  emitAiChatDone: vi.fn(),
  emitAiChatError: vi.fn(),
  emitAiChatTrace: vi.fn(),
  emitAiReportCreated: vi.fn(),
  emitWorkspaceItemsChanged: vi.fn()
}))

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'd1',
    filePath: '/lib/d1.pdf',
    originalFolderPath: '',
    fileName: 'd1.pdf',
    fileSize: 100,
    fileHash: null,
    title: 'Default Title',
    authors: 'Default Author',
    year: '2020',
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

describe('aiAgent search_library tool', () => {
  const mockDocumentsSearch = vi.fn()
  let searchLibraryTool: SearchLibraryTool

  function buildRepos(): Repositories {
    return {
      documents: { search: mockDocumentsSearch, get: vi.fn(() => null) },
      chat: { addMessage: vi.fn(), listMessages: vi.fn().mockReturnValue([]), getThread: vi.fn(() => null), updateTitle: vi.fn() },
      settings: { get: vi.fn() },
      workspaceItems: { list: vi.fn().mockReturnValue([]), add: vi.fn() },
      aiSummaries: { getSummary: vi.fn() },
      aiReports: { create: vi.fn() },
      agentTraces: {
        addStep: vi.fn().mockReturnValue({ id: 'run-step' }),
        updateStep: vi.fn().mockReturnValue({ id: 'run-step' })
      }
    } as unknown as Repositories
  }

  const aiProvidersService = {
    getProvider: vi.fn().mockReturnValue({
      id: 'p1',
      name: 'Test',
      baseUrl: 'http://localhost',
      model: 'gpt-4o',
      baseModel: '',
      variant: '',
      variantFormat: 'none',
      hasKey: true,
      temperature: null,
      maxTokens: null,
      createdAt: 0
    }),
    getDecryptedKey: vi.fn().mockReturnValue('test-key')
  } as unknown as AiProvidersService

  const pdfTextService = { getOrExtract: vi.fn().mockResolvedValue('') } as unknown as PdfTextService
  const aiSummaryService = { summarize: vi.fn(), destroy: vi.fn() } as never

  const mockWin = { isDestroyed: () => false, webContents: { send: vi.fn() } }
  const win = (() => mockWin) as unknown as Parameters<typeof createAiAgentService>[1]

  const req: ChatSendRequest = {
    workspaceId: 'ws-1',
    text: 'search the library for quantum papers',
    providerId: 'p1',
    model: 'gpt-4o'
  }

  beforeEach(async () => {
    mockDocumentsSearch.mockReset()
    createAgentMock.mockClear()

    const repos = buildRepos()
    const service = createAiAgentService(repos, win, aiProvidersService, pdfTextService, aiSummaryService)
    await service.run(req, 'thread-1')

    expect(createAgentMock).toHaveBeenCalledTimes(1)
    const found = capturedTools.value.find(
      (t) =>
        typeof t === 'object' &&
        t !== null &&
        (t as { name?: string }).name === 'search_library'
    )
    expect(found).toBeTruthy()
    searchLibraryTool = found as unknown as SearchLibraryTool
  })

  it('registers search_library among the agent tools', () => {
    const names = capturedTools.value.map((t) => (t as { name: string }).name)
    expect(names).toContain('search_library')
  })

  it('calls documents.search with the query and returns mapped JSON', async () => {
    mockDocumentsSearch.mockReturnValue([
      makeDoc({ id: 'd1', title: 'Quantum Computing', authors: 'Alice', year: '2021', fileName: 'q.pdf' })
    ])
    const result = await searchLibraryTool.invoke('quantum')
    expect(mockDocumentsSearch).toHaveBeenCalledWith('quantum')
    expect(JSON.parse(result)).toEqual([
      { docId: 'd1', title: 'Quantum Computing', authors: 'Alice', year: '2021' }
    ])
  })

  it('trims the query before searching', async () => {
    mockDocumentsSearch.mockReturnValue([])
    await searchLibraryTool.invoke('  spaced  ')
    expect(mockDocumentsSearch).toHaveBeenCalledWith('spaced')
  })

  it('returns [] for an empty query without calling search', async () => {
    const result = await searchLibraryTool.invoke('   ')
    expect(mockDocumentsSearch).not.toHaveBeenCalled()
    expect(result).toBe('[]')
  })

  it('truncates results to 20 entries', async () => {
    const docs = Array.from({ length: 25 }, (_, i) =>
      makeDoc({
        id: `d${i}`,
        title: `Paper ${i}`,
        authors: `Author ${i}`,
        year: String(2000 + i)
      })
    )
    mockDocumentsSearch.mockReturnValue(docs)
    const result = await searchLibraryTool.invoke('paper')
    expect(JSON.parse(result)).toHaveLength(20)
  })

  it('falls back to fileName when title is null', async () => {
    mockDocumentsSearch.mockReturnValue([
      makeDoc({ id: 'd9', title: null, fileName: 'fallback.pdf', authors: 'Bob', year: '2019' })
    ])
    const result = await searchLibraryTool.invoke('fallback')
    expect(JSON.parse(result)).toEqual([
      { docId: 'd9', title: 'fallback.pdf', authors: 'Bob', year: '2019' }
    ])
  })
})

describe('aiAgent search_workspace_docs tool', () => {
  const mockDocumentsSearch = vi.fn()
  const mockDocumentsGet = vi.fn()
  const mockWorkspaceItemsList = vi.fn()
  const mockGetSummary = vi.fn()
  let searchWorkspaceDocsTool: SearchLibraryTool

  function buildRepos(): Repositories {
    return {
      documents: { search: mockDocumentsSearch, get: mockDocumentsGet },
      chat: { addMessage: vi.fn(), listMessages: vi.fn().mockReturnValue([]), getThread: vi.fn(() => null), updateTitle: vi.fn() },
      settings: { get: vi.fn() },
      workspaceItems: { list: mockWorkspaceItemsList, add: vi.fn() },
      aiSummaries: { getSummary: mockGetSummary },
      aiReports: { create: vi.fn() },
      agentTraces: {
        addStep: vi.fn().mockReturnValue({ id: 'run-step' }),
        updateStep: vi.fn().mockReturnValue({ id: 'run-step' })
      }
    } as unknown as Repositories
  }

  const aiProvidersService = {
    getProvider: vi.fn().mockReturnValue({
      id: 'p1', name: 'Test', baseUrl: 'http://localhost', model: 'gpt-4o',
      baseModel: '', variant: '', variantFormat: 'none', hasKey: true,
      temperature: null, maxTokens: null, createdAt: 0
    }),
    getDecryptedKey: vi.fn().mockReturnValue('test-key')
  } as unknown as AiProvidersService

  const pdfTextService = { getOrExtract: vi.fn().mockResolvedValue('') } as unknown as PdfTextService
  const aiSummaryService = { summarize: vi.fn(), destroy: vi.fn() } as never
  const mockWin = { isDestroyed: () => false, webContents: { send: vi.fn() } }
  const win = (() => mockWin) as unknown as Parameters<typeof createAiAgentService>[1]

  const req: ChatSendRequest = {
    workspaceId: 'ws-1', text: 'search workspace', providerId: 'p1', model: 'gpt-4o'
  }

  beforeEach(async () => {
    mockDocumentsSearch.mockReset()
    mockDocumentsGet.mockReset().mockReturnValue(null)
    mockWorkspaceItemsList.mockReset().mockReturnValue([])
    mockGetSummary.mockReset().mockReturnValue(null)
    createAgentMock.mockClear()

    const repos = buildRepos()
    const service = createAiAgentService(repos, win, aiProvidersService, pdfTextService, aiSummaryService)
    await service.run(req, 'thread-1')

    const found = capturedTools.value.find(
      (t) => typeof t === 'object' && t !== null && (t as { name?: string }).name === 'search_workspace_docs'
    )
    expect(found).toBeTruthy()
    searchWorkspaceDocsTool = found as unknown as SearchLibraryTool
  })

  it('filters search results to workspace documents only', async () => {
    mockWorkspaceItemsList.mockReturnValue([
      { id: 'wi-1', workspaceId: 'ws-1', kind: 'document', docId: 'd1', reportId: null, sortOrder: 0, addedAt: 0 },
      { id: 'wi-2', workspaceId: 'ws-1', kind: 'document', docId: 'd2', reportId: null, sortOrder: 1, addedAt: 0 }
    ])
    mockDocumentsSearch.mockReturnValue([
      makeDoc({ id: 'd1', title: 'In Workspace', authors: 'A', year: '2021' }),
      makeDoc({ id: 'd2', title: 'Also In Workspace', authors: 'B', year: '2022' }),
      makeDoc({ id: 'd3', title: 'Not In Workspace', authors: 'C', year: '2023' })
    ])
    const result = await searchWorkspaceDocsTool.invoke('test')
    const parsed = JSON.parse(result)
    expect(parsed).toHaveLength(2)
    expect(parsed.map((d: { docId: string }) => d.docId)).toEqual(['d1', 'd2'])
  })

  it('returns all workspace docs for empty query without calling search', async () => {
    mockWorkspaceItemsList.mockReturnValue([
      { id: 'wi-1', workspaceId: 'ws-1', kind: 'document', docId: 'd1', reportId: null, sortOrder: 0, addedAt: 0 }
    ])
    mockDocumentsGet.mockReturnValue(makeDoc({ id: 'd1', title: 'Doc One' }))
    const result = await searchWorkspaceDocsTool.invoke('   ')
    expect(mockDocumentsSearch).not.toHaveBeenCalled()
    const parsed = JSON.parse(result)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].docId).toBe('d1')
  })

  it('finds documents via abstract (proves FTS not includes)', async () => {
    mockWorkspaceItemsList.mockReturnValue([
      { id: 'wi-1', workspaceId: 'ws-1', kind: 'document', docId: 'd1', reportId: null, sortOrder: 0, addedAt: 0 }
    ])
    mockDocumentsSearch.mockReturnValue([
      makeDoc({ id: 'd1', title: 'Generic Title', abstract: 'This paper discusses transformer architectures', authors: 'A', year: '2021' })
    ])
    const result = await searchWorkspaceDocsTool.invoke('transformer')
    const parsed = JSON.parse(result)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].docId).toBe('d1')
  })

  it('includes authors, year, and hasSummary fields in results', async () => {
    mockWorkspaceItemsList.mockReturnValue([
      { id: 'wi-1', workspaceId: 'ws-1', kind: 'document', docId: 'd1', reportId: null, sortOrder: 0, addedAt: 0 }
    ])
    mockDocumentsSearch.mockReturnValue([
      makeDoc({ id: 'd1', title: 'Paper', authors: 'Author X', year: '2024' })
    ])
    mockGetSummary.mockReturnValue({ content: { core: 'summary', keyPoints: [] } })
    const result = await searchWorkspaceDocsTool.invoke('paper')
    const parsed = JSON.parse(result)
    expect(parsed[0]).toEqual({
      docId: 'd1',
      title: 'Paper',
      authors: 'Author X',
      year: '2024',
      hasSummary: true
    })
  })

  it('returns empty array when no workspace docs match', async () => {
    mockWorkspaceItemsList.mockReturnValue([
      { id: 'wi-1', workspaceId: 'ws-1', kind: 'document', docId: 'd1', reportId: null, sortOrder: 0, addedAt: 0 }
    ])
    mockDocumentsSearch.mockReturnValue([
      makeDoc({ id: 'd99', title: 'Not in workspace' })
    ])
    const result = await searchWorkspaceDocsTool.invoke('nonexistent')
    expect(JSON.parse(result)).toEqual([])
  })
})
