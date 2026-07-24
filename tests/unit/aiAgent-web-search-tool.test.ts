import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repositories } from '../../src/main/db/repositories'
import type { AiProvidersService } from '../../src/main/services/aiProviders'
import type { PdfTextService } from '../../src/main/services/pdfText'
import type { WebSearchService } from '../../src/main/services/webSearch'
import { withDeepAgentRepositories } from '../helpers/deepAgentRepositories'

const mocks = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  createAgent: vi.fn((options: Record<string, unknown>) => {
    mocks.options = options
    return { streamEvents: async function* () {} }
  })
}))

vi.mock('@langchain/openai', () => ({ ChatOpenAI: vi.fn() }))
vi.mock('../../src/main/services/reforaDeepAgent', () => ({
  createReforaDeepAgent: mocks.createAgent
}))
vi.mock('../../src/main/services/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
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
  emitWorkspaceItemsChanged: vi.fn()
}))

import { createAiAgentService } from '../../src/main/services/aiAgent'

function buildRepos(): Repositories {
  return withDeepAgentRepositories({
    documents: { search: vi.fn(), get: vi.fn(() => null) },
    chat: {
      addMessage: vi.fn(),
      listMessages: vi.fn(() => []),
      getThread: vi.fn(() => null),
      updateTitle: vi.fn()
    },
    settings: { get: vi.fn() },
    workspaceItems: { list: vi.fn(() => []), add: vi.fn() },
    aiSummaries: { getSummary: vi.fn() },
    aiReports: { create: vi.fn() },
    agentTraces: {
      addStep: vi.fn().mockReturnValue({ id: 'run-step' }),
      updateStep: vi.fn().mockReturnValue({ id: 'run-step' })
    }
  } as unknown as Repositories)
}

describe('aiAgent web_search tool', () => {
  const aiProviders = {
    getProvider: vi.fn(() => ({
      id: 'p1',
      presetId: 'openai',
      name: 'Test',
      baseUrl: 'https://api.example.com/v1',
      apiProtocol: 'openai-compatible',
      reasoningControl: 'none',
      reasoningEffort: 'none',
      model: 'model',
      models: null,
      baseModel: 'model',
      variant: '',
      variantFormat: 'none',
      hasKey: true,
      temperature: null,
      maxTokens: null,
      createdAt: 0
    })),
    getDecryptedKey: vi.fn(() => 'key')
  } as unknown as AiProvidersService
  const pdfText = { getOrExtract: vi.fn() } as unknown as PdfTextService
  const aiSummary = { summarize: vi.fn(), destroy: vi.fn() } as never
  const window = {
    isDestroyed: () => false,
    webContents: { send: vi.fn() }
  }
  const webSearch = {
    isEnabled: vi.fn(() => true),
    search: vi.fn().mockResolvedValue({
      provider: 'ddgs',
      query: 'current topic',
      results: [{ title: 'Result', url: 'https://example.com', snippet: 'Evidence' }]
    }),
    fetchPage: vi.fn().mockResolvedValue({
      requestedUrl: 'https://example.com',
      url: 'https://example.com',
      status: 200,
      contentType: 'text/html',
      content: '# Evidence',
      truncated: false
    })
  } as unknown as WebSearchService

  beforeEach(() => {
    mocks.options = null
    mocks.createAgent.mockClear()
    webSearch.search.mockClear()
    webSearch.fetchPage.mockClear()
  })

  it('registers web_search and web_fetch for the main Agent and every subagent', async () => {
    const service = createAiAgentService(
      buildRepos(),
      (() => window) as never,
      aiProviders,
      pdfText,
      aiSummary,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      webSearch
    )

    await service.run({
      workspaceId: 'ws-1',
      text: 'find current sources',
      providerId: 'p1',
      model: 'model'
    }, 'thread-1')

    const options = mocks.options as {
      tools: Array<{ name: string; invoke(input: unknown): Promise<string> }>
      readOnlyTools: Array<{ name: string }>
    }
    const searchTool = options.tools.find((candidate) => candidate.name === 'web_search')
    const fetchTool = options.tools.find((candidate) => candidate.name === 'web_fetch')
    expect(searchTool).toBeTruthy()
    expect(fetchTool).toBeTruthy()
    expect(options.readOnlyTools.map((candidate) => candidate.name)).toEqual(
      expect.arrayContaining(['web_search', 'web_fetch'])
    )

    const output = await searchTool!.invoke({ query: 'current topic', maxResults: 3 })
    expect(webSearch.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'current topic', maxResults: 3 }),
      expect.any(AbortSignal)
    )
    expect(JSON.parse(output)).toMatchObject({ provider: 'ddgs' })

    const fetched = await fetchTool!.invoke({
      url: 'https://example.com',
      maxChars: 5000
    })
    expect(webSearch.fetchPage).toHaveBeenCalledWith(
      { url: 'https://example.com', maxChars: 5000 },
      expect.any(AbortSignal)
    )
    expect(JSON.parse(fetched)).toMatchObject({ content: '# Evidence' })
  })
})
