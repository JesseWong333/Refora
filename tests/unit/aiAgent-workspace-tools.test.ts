import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withDeepAgentRepositories } from '../helpers/deepAgentRepositories'
import type { Repositories } from '../../src/main/db/repositories'
import type { AiProvidersService } from '../../src/main/services/aiProviders'
import type { PdfTextService } from '../../src/main/services/pdfText'
import type {
  AiProvider,
  ChatSendRequest,
  Document,
  WorkspaceConnection,
  WorkspaceItem
} from '../../src/shared/ipc-types'

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

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn()
}))

vi.mock('../../src/main/services/reforaDeepAgent', () => ({
  createReforaDeepAgent: ({ tools }: { tools: CapturedTool[] }) => {
    mocks.tools = tools
    return { streamEvents: async function* () {} }
  }
}))

vi.mock('../../src/main/ipc/events', () => ({
  emitAiChatToken: vi.fn(),
  emitAiChatReasoning: vi.fn(),
  emitAiChatDone: vi.fn(),
  emitAiChatError: vi.fn(),
  emitAiChatInterrupted: vi.fn(),
  emitAiChatRunStatus: vi.fn(),
  emitAiChatTrace: vi.fn(),
  emitAiChatTitleUpdated: vi.fn(),
  emitAiReportCreated: vi.fn(),
  emitWorkspaceItemsChanged: mocks.emitWorkspaceItemsChanged
}))

vi.mock('../../src/main/services/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    filePath: '/library/paper.pdf',
    originalFolderPath: '/library',
    fileName: 'paper.pdf',
    fileSize: 100,
    fileHash: null,
    title: 'Graph Neural Networks for Molecules',
    authors: 'Smith, Alice; Zhang, Bo',
    year: '2024',
    venue: 'ICML',
    volume: null,
    issue: null,
    pages: null,
    abstract: 'Graph neural networks learn molecular representations and predict properties.',
    keywords: 'graph neural networks, molecular learning',
    url: null,
    doi: null,
    note: null,
    affiliations: null,
    starred: 0,
    addedAt: 0,
    lastReadAt: null,
    updatedAt: 0,
    metadataSource: null,
    metadataStatus: 'done',
    metadataAttempts: 0,
    editedFields: [],
    remoteValues: null,
    fileMissing: 0,
    ...overrides
  }
}

function makeItem(
  id: string,
  kind: WorkspaceItem['kind'],
  targetId: string,
  sortOrder: number
): WorkspaceItem {
  return {
    id,
    workspaceId: 'ws-1',
    kind,
    docId: kind === 'document' ? targetId : null,
    reportId: kind === 'report' ? targetId : null,
    noteId: kind === 'note' ? targetId : null,
    assetId: kind === 'asset' ? targetId : null,
    sortOrder,
    width: 300,
    height: 200,
    x: sortOrder * 100,
    y: 0,
    zIndex: sortOrder,
    addedAt: sortOrder
  }
}

const workspaceItemsList = vi.fn<() => WorkspaceItem[]>()
const documentsGet = vi.fn<(id: string) => Document | null>()
const documentsList = vi.fn<() => Document[]>()
const reportsList = vi.fn()
const notesList = vi.fn()
const assetsList = vi.fn()
const connectionsList = vi.fn<() => WorkspaceConnection[]>()
const connectionsCreate = vi.fn()

const repos = withDeepAgentRepositories({
  documents: { get: documentsGet, list: documentsList },
  chat: {
    addMessage: vi.fn(),
    listMessages: vi.fn(() => []),
    getThread: vi.fn(() => null),
    updateTitle: vi.fn()
  },
  settings: { get: vi.fn(() => 'provider-1') },
  workspaceItems: { list: workspaceItemsList, add: vi.fn() },
  workspaceConnections: { list: connectionsList, create: connectionsCreate },
  workspaceNotes: { list: notesList },
  workspaceAssets: { list: assetsList },
  aiSummaries: { getSummary: vi.fn(() => null) },
  aiReports: { list: reportsList, create: vi.fn() },
  agentTraces: {
    addStep: vi.fn(() => ({ id: 'step-1' })),
    updateStep: vi.fn(() => ({ id: 'step-1' }))
  },
  transaction: vi.fn((fn: () => unknown) => fn())
} as unknown as Repositories)

const provider: AiProvider = {
  id: 'provider-1',
  presetId: 'openai',
  name: 'Test provider',
  baseUrl: 'https://example.com/v1',
  apiProtocol: 'openai-compatible',
  reasoningControl: 'none',
  reasoningEffort: 'none',
  model: 'gpt-4o',
  models: null,
  baseModel: 'gpt-4o',
  variant: '',
  variantFormat: 'none',
  hasKey: true,
  temperature: null,
  maxTokens: null,
  createdAt: 0
}

const aiProvidersService = {
  getProvider: vi.fn(() => provider),
  getDecryptedKey: vi.fn(() => 'key')
} as unknown as AiProvidersService

const pdfTextService = { getOrExtract: vi.fn(async () => '') } as unknown as PdfTextService
const aiSummaryService = { summarize: vi.fn(), destroy: vi.fn() } as never
const mockWin = { isDestroyed: () => false }
const req: ChatSendRequest = {
  workspaceId: 'ws-1',
  text: 'Inspect this workspace',
  providerId: 'provider-1'
}

function getTool(name: string): CapturedTool {
  const tool = mocks.tools.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`Tool not found: ${name}`)
  return tool
}

describe('AI agent workspace tools', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    workspaceItemsList.mockReturnValue([])
    documentsGet.mockReturnValue(null)
    documentsList.mockReturnValue([])
    reportsList.mockReturnValue([])
    notesList.mockReturnValue([])
    assetsList.mockReturnValue([])
    connectionsList.mockReturnValue([])
    connectionsCreate.mockImplementation(
      (
        workspaceId: string,
        sourceItemId: string,
        targetItemId: string,
        sourceAnchor: WorkspaceConnection['sourceAnchor'],
        targetAnchor: WorkspaceConnection['targetAnchor']
      ): WorkspaceConnection => ({
        id: `connection-${sourceItemId}-${targetItemId}`,
        workspaceId,
        sourceItemId,
        targetItemId,
        sourceAnchor,
        targetAnchor,
        createdAt: 1
      })
    )
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

  it('registers only the three requested new tool names', () => {
    const names = mocks.tools.map((tool) => tool.name)
    expect(names).toContain('list_workspace_context')
    expect(names).toContain('create_workspace_connections')
    expect(names).toContain('find_related_papers')
  })

  it('lists document, report, note, asset, and connection context with itemIds', async () => {
    const items = [
      makeItem('item-doc', 'document', 'doc-1', 0),
      makeItem('item-report', 'report', 'report-1', 1),
      makeItem('item-note', 'note', 'note-1', 2),
      makeItem('item-asset', 'asset', 'asset-1', 3)
    ]
    workspaceItemsList.mockReturnValue(items)
    documentsGet.mockReturnValue(makeDoc())
    vi.mocked(repos.aiSummaries.getSummary).mockReturnValue({ content: { core: 'Summary', keyPoints: [] } } as never)
    reportsList.mockReturnValue([
      { id: 'report-1', workspaceId: 'ws-1', title: 'Survey', contentMd: '', sourceDocIds: ['doc-1'], model: null, createdAt: 1 }
    ])
    notesList.mockReturnValue([
      { id: 'note-1', workspaceId: 'ws-1', title: 'Ideas', contentMd: '', noteType: 'markdown', createdAt: 1, updatedAt: 1 }
    ])
    assetsList.mockReturnValue([
      { id: 'asset-1', workspaceId: 'ws-1', fileName: 'data.csv', mimeType: 'text/plain', previewKind: 'text', fileMissing: 0 }
    ])
    connectionsList.mockReturnValue([
      {
        id: 'connection-1',
        workspaceId: 'ws-1',
        sourceItemId: 'item-doc',
        targetItemId: 'item-note',
        sourceAnchor: 'right',
        targetAnchor: 'left',
        createdAt: 1
      }
    ])

    const result = JSON.parse(await getTool('list_workspace_context').invoke({}))

    expect(result.itemCount).toBe(4)
    expect(result.items.map((item: { itemId: string }) => item.itemId)).toEqual([
      'item-doc',
      'item-report',
      'item-note',
      'item-asset'
    ])
    expect(result.items[0]).toMatchObject({ docId: 'doc-1', hasSummary: true })
    expect(result.items[1]).toMatchObject({ reportId: 'report-1', title: 'Survey' })
    expect(result.items[2]).toMatchObject({ noteId: 'note-1', title: 'Ideas' })
    expect(result.items[3]).toMatchObject({ assetId: 'asset-1', fileName: 'data.csv' })
    expect(result.connections).toEqual([
      {
        connectionId: 'connection-1',
        sourceItemId: 'item-doc',
        targetItemId: 'item-note',
        sourceAnchor: 'right',
        targetAnchor: 'left'
      }
    ])
  })

  it('creates valid current-workspace connections and reports rejected requests', async () => {
    workspaceItemsList.mockReturnValue([
      makeItem('item-1', 'document', 'doc-1', 0),
      makeItem('item-2', 'document', 'doc-2', 1),
      makeItem('item-3', 'note', 'note-1', 2),
      makeItem('item-4', 'report', 'report-1', 3)
    ])
    connectionsList.mockReturnValue([
      {
        id: 'existing',
        workspaceId: 'ws-1',
        sourceItemId: 'item-3',
        targetItemId: 'item-4',
        sourceAnchor: 'right',
        targetAnchor: 'left',
        createdAt: 1
      }
    ])

    const result = JSON.parse(
      await getTool('create_workspace_connections').invoke({
        connections: [
          { sourceItemId: 'item-1', targetItemId: 'item-2' },
          { sourceItemId: 'item-1', targetItemId: 'item-1' },
          { sourceItemId: 'item-1', targetItemId: 'missing' },
          { sourceItemId: 'item-3', targetItemId: 'item-4' }
        ]
      })
    )

    expect(result.created).toHaveLength(1)
    expect(result.errors).toHaveLength(3)
    expect(connectionsCreate).toHaveBeenCalledTimes(1)
    expect(connectionsCreate).toHaveBeenCalledWith(
      'ws-1',
      'item-1',
      'item-2',
      'right',
      'left'
    )
    expect(mocks.emitWorkspaceItemsChanged).toHaveBeenCalledWith(mockWin, {
      workspaceId: 'ws-1',
      reason: 'other'
    })
  })

  it('ranks related papers from the local library and marks workspace membership', async () => {
    const seed = makeDoc()
    const closeMatch = makeDoc({
      id: 'doc-related',
      title: 'Graph Networks for Molecular Property Prediction',
      authors: 'Smith, Alice',
      year: '2023',
      abstract: 'Molecular graph neural networks predict chemical properties.',
      keywords: 'graph neural networks, molecular learning'
    })
    const weakerMatch = makeDoc({
      id: 'doc-weaker',
      title: 'Graph Learning Systems',
      authors: 'Other, Author',
      year: '2020',
      venue: 'NeurIPS',
      abstract: 'Graph representations for general systems.',
      keywords: 'graph learning'
    })
    const unrelated = makeDoc({
      id: 'doc-unrelated',
      title: 'Medieval Poetry',
      authors: 'Historian, One',
      year: '2024',
      venue: 'History Journal',
      abstract: 'A study of poetry manuscripts.',
      keywords: 'poetry, manuscripts'
    })
    documentsGet.mockImplementation((id) => (id === seed.id ? seed : null))
    documentsList.mockReturnValue([seed, weakerMatch, unrelated, closeMatch])
    workspaceItemsList.mockReturnValue([makeItem('item-related', 'document', 'doc-related', 0)])

    const result = JSON.parse(
      await getTool('find_related_papers').invoke({ docId: seed.id, limit: 2 })
    )

    expect(documentsList).toHaveBeenCalledWith({ mode: 'all' })
    expect(result.seedDocId).toBe(seed.id)
    expect(result.results.map((paper: { docId: string }) => paper.docId)).toEqual([
      'doc-related',
      'doc-weaker'
    ])
    expect(result.results[0]).toMatchObject({ inWorkspace: true })
    expect(result.results[0].score).toBeGreaterThan(result.results[1].score)
  })

  it('returns an error when the related-paper seed does not exist', async () => {
    documentsGet.mockReturnValue(null)
    const result = JSON.parse(
      await getTool('find_related_papers').invoke({ docId: 'missing', limit: 5 })
    )
    expect(result).toEqual({ error: 'Document not found', docId: 'missing' })
    expect(documentsList).not.toHaveBeenCalled()
  })
})
