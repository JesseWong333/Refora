import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChatMessage, ChatSendRequest } from '../../src/shared/ipc-types'
import type { Repositories } from '../../src/main/db/repositories'
import type { AiProvidersService } from '../../src/main/services/aiProviders'
import type { PdfTextService } from '../../src/main/services/pdfText'

const { mockStreamEvents } = vi.hoisted(() => ({
  mockStreamEvents: vi.fn()
}))

vi.mock('electron', () => ({
  shell: { openPath: vi.fn(), trashItem: vi.fn() },
  BrowserWindow: vi.fn()
}))

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(class {})
}))

vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: vi.fn(() => ({ streamEvents: mockStreamEvents }))
}))

vi.mock('@langchain/core/tools', () => ({
  DynamicTool: vi.fn(class {
    constructor(opts: object) {
      Object.assign(this, opts)
    }
  }),
  DynamicStructuredTool: vi.fn(class {
    constructor(opts: object) {
      Object.assign(this, opts)
    }
  })
}))

vi.mock('@langchain/core/messages', () => ({
  SystemMessage: class {
    content: unknown
    constructor(content: unknown) {
      this.content = content
    }
  },
  HumanMessage: class {
    content: unknown
    constructor(content: unknown) {
      this.content = content
    }
  },
  AIMessage: class {
    content: unknown
    tool_calls?: unknown[]
    constructor(content: unknown) {
      this.content = content
    }
  },
  ToolMessage: class {
    content: unknown
    tool_call_id: string
    name?: string
    constructor(fields: unknown) {
      const f = fields as { content?: unknown; tool_call_id?: string; name?: string }
      this.content = f?.content
      this.tool_call_id = f?.tool_call_id ?? ''
      this.name = f?.name
    }
  }
}))

vi.mock('../../src/main/ipc/events', () => ({
  emitAiChatToken: vi.fn(),
  emitAiChatDone: vi.fn(),
  emitAiChatError: vi.fn(),
  emitAiChatTrace: vi.fn(),
  emitAiReportCreated: vi.fn(),
  emitWorkspaceItemsChanged: vi.fn()
}))

vi.mock('../../src/main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const aiAgentModule = await import('../../src/main/services/aiAgent')
const createAiAgentService = aiAgentModule.createAiAgentService

let lastStreamInput: { messages: unknown[] } | null = null

function makeMessage(id: number, role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: `msg-${id}`,
    threadId: 'thread-1',
    role,
    content,
    createdAt: id * 1000
  }
}

function makeMockRepos(messages: ChatMessage[]): Repositories {
  return {
    chat: {
      listMessages: vi.fn(() => messages),
      addMessage: vi.fn(() => makeMessage(999, 'assistant', '')),
      createThread: vi.fn(),
      listThreads: vi.fn(() => []),
      getThread: vi.fn(() => null),
      deleteThread: vi.fn(),
      updateTitle: vi.fn()
    },
    settings: {
      get: vi.fn((key: string) => (key === 'activeProviderId' ? 'prov-1' : ''))
    },
    workspaceItems: {
      list: vi.fn(() => []),
      add: vi.fn()
    },
    documents: {
      get: vi.fn(() => null),
      search: vi.fn(() => [])
    },
    aiSummaries: {
      getSummary: vi.fn(() => null)
    },
    aiReports: {
      create: vi.fn(() => ({
        id: 'r1',
        workspaceId: 'ws-1',
        title: '',
        contentMd: '',
        sourceDocIds: [],
        model: '',
        createdAt: 0
      }))
    },
    agentTraces: {
      addStep: vi.fn(() => ({
        id: 'step-1',
        threadId: 'thread-1',
        runId: 'run-1',
        kind: 'run',
        name: null,
        input: null,
        output: null,
        status: 'running',
        startedAt: 0,
        endedAt: null,
        seq: 0
      })),
      updateStep: vi.fn(() => ({
        id: 'step-1',
        threadId: 'thread-1',
        runId: 'run-1',
        kind: 'run',
        name: null,
        input: null,
        output: null,
        status: 'done',
        startedAt: 0,
        endedAt: 0,
        seq: 0
      })),
      listByThread: vi.fn(() => []),
      listByRun: vi.fn(() => [])
    }
  } as unknown as Repositories
}

function makeMockAiProviders(): AiProvidersService {
  return {
    getProvider: vi.fn(() => ({
      id: 'prov-1',
      name: 'Test',
      baseUrl: 'http://localhost',
      model: 'gpt-4o',
      baseModel: 'gpt-4o',
      variant: '',
      variantFormat: 'none',
      hasKey: true,
      temperature: 0.7,
      maxTokens: 4096,
      createdAt: 0
    })),
    getDecryptedKey: vi.fn(() => 'test-key')
  } as unknown as AiProvidersService
}

function makeMockPdfText(): PdfTextService {
  return {
    getOrExtract: vi.fn(() => Promise.resolve(''))
  } as unknown as PdfTextService
}

const mockWin = { isDestroyed: () => false }

function makeReq(overrides: Partial<ChatSendRequest> = {}): ChatSendRequest {
  return {
    workspaceId: 'ws-1',
    text: 'test question',
    providerId: 'prov-1',
    model: 'gpt-4o',
    ...overrides
  }
}

async function runAgentWithHistory(messages: ChatMessage[]): Promise<void> {
  const repos = makeMockRepos(messages)
  const service = createAiAgentService(
    repos,
    () => mockWin,
    makeMockAiProviders(),
    makeMockPdfText(),
    { summarize: vi.fn(), destroy: vi.fn() } as never
  )
  await service.run(makeReq(), 'thread-1')
}

function getHistoryContents(): string[] {
  if (!lastStreamInput) return []
  return (lastStreamInput.messages.slice(1) as Array<{ content: string }>).map((m) => m.content)
}

function getHistoryMessageCount(): number {
  if (!lastStreamInput) return 0
  return lastStreamInput.messages.length - 1
}

beforeEach(() => {
  lastStreamInput = null
  mockStreamEvents.mockReset()
  mockStreamEvents.mockImplementation(async function* (input: { messages: unknown[] }) {
    lastStreamInput = input
    yield* []
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('AiAgent history token-aware truncation', () => {
  it('passes all short messages when under budget', async () => {
    const messages = [
      makeMessage(0, 'user', 'short-1'),
      makeMessage(1, 'assistant', 'short-2'),
      makeMessage(2, 'user', 'short-3')
    ]

    await runAgentWithHistory(messages)

    expect(lastStreamInput).not.toBeNull()
    expect(getHistoryMessageCount()).toBe(3)
    const contents = getHistoryContents()
    expect(contents).toContain('short-1')
    expect(contents).toContain('short-2')
    expect(contents).toContain('short-3')
  })

  it('truncates long history over budget, keeping most recent', async () => {
    const messages = Array.from({ length: 30 }, (_, i) =>
      makeMessage(i, 'user', `msg-${i}-${'x'.repeat(1200)}`)
    )

    await runAgentWithHistory(messages)

    expect(lastStreamInput).not.toBeNull()
    expect(getHistoryMessageCount()).toBeLessThan(30)
    const contents = getHistoryContents()
    expect(contents.some((c) => c.startsWith('msg-29-'))).toBe(true)
  })

  it('caps at maxMessages (50)', async () => {
    const messages = Array.from({ length: 60 }, (_, i) =>
      makeMessage(i, 'user', `m-${i}`)
    )

    await runAgentWithHistory(messages)

    expect(lastStreamInput).not.toBeNull()
    expect(getHistoryMessageCount()).toBeLessThanOrEqual(50)
  })

  it('guarantees at least minMessages (2) even when over budget', async () => {
    const messages = Array.from({ length: 3 }, (_, i) =>
      makeMessage(i, 'user', 'x'.repeat(50000))
    )

    await runAgentWithHistory(messages)

    expect(lastStreamInput).not.toBeNull()
    expect(getHistoryMessageCount()).toBeGreaterThanOrEqual(2)
  })

  it('always includes the most recent message', async () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      makeMessage(i, 'user', `msg-${i}-${'x'.repeat(2000)}`)
    )

    await runAgentWithHistory(messages)

    expect(lastStreamInput).not.toBeNull()
    const contents = getHistoryContents()
    expect(contents.some((c) => c.startsWith('msg-19-'))).toBe(true)
  })
})
