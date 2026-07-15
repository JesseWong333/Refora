import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  emitAiChatToken: vi.fn(),
  emitAiChatDone: vi.fn(),
  emitAiChatError: vi.fn(),
  emitAiChatTrace: vi.fn(),
  emitAiReportCreated: vi.fn(),
  emitWorkspaceItemsChanged: vi.fn(),
  createReactAgent: vi.fn()
}))

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn()
}))

vi.mock('@langchain/core/tools', () => ({
  DynamicTool: vi.fn((opts: Record<string, unknown>) => opts),
  DynamicStructuredTool: vi.fn((opts: Record<string, unknown>) => opts)
}))

vi.mock('@langchain/core/messages', () => ({
  SystemMessage: vi.fn((content: string) => ({ content })),
  HumanMessage: vi.fn((content: string) => ({ content })),
  AIMessage: vi.fn((content: string) => ({ content }))
}))

vi.mock('../../src/main/ipc/events', () => ({
  emitAiChatToken: mocks.emitAiChatToken,
  emitAiChatDone: mocks.emitAiChatDone,
  emitAiChatError: mocks.emitAiChatError,
  emitAiChatTrace: mocks.emitAiChatTrace,
  emitAiReportCreated: mocks.emitAiReportCreated,
  emitWorkspaceItemsChanged: mocks.emitWorkspaceItemsChanged
}))

vi.mock('../../src/main/services/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: mocks.createReactAgent
}))

import { createAiAgentService } from '../../src/main/services/aiAgent'
import type { Repositories } from '../../src/main/db/repositories'
import type { AiProvider, ChatSendRequest } from '../../src/shared/ipc-types'

function makeMockRepos(): Repositories {
  let stepCounter = 0
  return {
    chat: {
      addMessage: vi.fn(),
      listMessages: vi.fn(() => []),
      getThread: vi.fn(() => null),
      updateTitle: vi.fn()
    },
    settings: {
      get: vi.fn((_key: string, def: unknown) => def)
    },
    workspaceItems: {
      list: vi.fn(() => []),
      add: vi.fn(() => [])
    },
    documents: {
      get: vi.fn(() => null)
    },
    aiSummaries: {
      getSummary: vi.fn(() => null)
    },
    aiReports: {
      create: vi.fn((input: Record<string, unknown>) => ({
        id: 'report-1',
        workspaceId: input.workspaceId,
        title: input.title,
        contentMd: input.contentMd,
        sourceDocIds: input.sourceDocIds,
        model: input.model,
        createdAt: Date.now()
      }))
    },
    agentTraces: {
      addStep: vi.fn((input: Record<string, unknown>) => ({
        id: `step-${stepCounter++}`,
        threadId: input.threadId,
        runId: input.runId,
        kind: input.kind,
        name: input.name ?? null,
        input: input.input ?? null,
        output: input.output ?? null,
        status: input.status,
        startedAt: input.startedAt,
        endedAt: input.endedAt ?? null,
        seq: input.seq
      })),
      updateStep: vi.fn(
        (id: string, patch: { output?: string | null; status?: string; endedAt?: number | null }) => ({
          id,
          threadId: '',
          runId: '',
          kind: 'run',
          name: null,
          input: null,
          output: patch.output ?? null,
          status: patch.status ?? 'done',
          startedAt: 0,
          endedAt: patch.endedAt ?? null,
          seq: 0
        })
      ),
      listByThread: vi.fn(() => []),
      listByRun: vi.fn(() => [])
    }
  } as unknown as Repositories
}

function makeMockWin() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() }
  }
}

function makeMockAiProvidersService() {
  const provider: AiProvider = {
    id: 'p1',
    name: 'Test Provider',
    baseUrl: 'http://localhost:8080',
    model: 'test-model',
    baseModel: 'test-model',
    variant: '',
    variantFormat: 'dash',
    hasKey: true,
    temperature: null,
    maxTokens: null,
    createdAt: 0
  }
  return {
    getProvider: vi.fn(() => provider),
    getDecryptedKey: vi.fn(() => 'test-key')
  }
}

function makeMockPdfTextService() {
  return {
    getOrExtract: vi.fn(async () => '')
  }
}

const mockReq: ChatSendRequest = {
  workspaceId: 'ws-1',
  threadId: 'thread-1',
  text: 'Hello',
  providerId: 'p1'
}

function makeCancellableStream(tokens: string[]) {
  return async function* (
    _input: unknown,
    options: { signal?: AbortSignal } | undefined
  ) {
    yield { event: 'on_chat_model_start', data: {}, run_id: 'llm-1' }
    for (const token of tokens) {
      yield {
        event: 'on_chat_model_stream',
        data: { chunk: { content: token } },
        run_id: 'llm-1'
      }
    }
    await new Promise((r) => setTimeout(r, 50))
    if (options?.signal?.aborted) {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }
    yield { event: 'on_chat_model_end', data: {}, run_id: 'llm-1' }
  }
}

function makeNormalStream(tokens: string[]) {
  return async function* () {
    yield { event: 'on_chat_model_start', data: {}, run_id: 'llm-1' }
    for (const token of tokens) {
      yield {
        event: 'on_chat_model_stream',
        data: { chunk: { content: token } },
        run_id: 'llm-1'
      }
    }
    yield { event: 'on_chat_model_end', data: {}, run_id: 'llm-1' }
  }
}

describe('AiAgentService cancellation', () => {
  let repos: Repositories
  let mockWin: ReturnType<typeof makeMockWin>
  let aiProvidersService: ReturnType<typeof makeMockAiProvidersService>
  let pdfTextService: ReturnType<typeof makeMockPdfTextService>
  let service: ReturnType<typeof createAiAgentService>

  beforeEach(() => {
    vi.clearAllMocks()
    repos = makeMockRepos()
    mockWin = makeMockWin()
    aiProvidersService = makeMockAiProvidersService()
    pdfTextService = makeMockPdfTextService()
    service = createAiAgentService(
      repos,
      () => mockWin as never,
      aiProvidersService as never,
      pdfTextService as never,
      { summarize: vi.fn(), destroy: vi.fn() } as never
    )
  })

  it('cancel(threadId) causes the stream to abort', async () => {
    mocks.createReactAgent.mockReturnValue({
      streamEvents: makeCancellableStream(['Partial'])
    })

    const runPromise = service.run(mockReq, 'thread-1')
    await new Promise((r) => setTimeout(r, 10))
    service.cancel('thread-1')
    await runPromise

    expect(mocks.emitAiChatDone).toHaveBeenCalledWith(
      mockWin,
      expect.objectContaining({
        threadId: 'thread-1',
        finalText: 'Partial'
      })
    )
    expect(mocks.emitAiChatError).not.toHaveBeenCalled()
  })

  it('preserves partial text without appending cancellation marker', async () => {
    mocks.createReactAgent.mockReturnValue({
      streamEvents: makeCancellableStream(['Partial response'])
    })

    const runPromise = service.run(mockReq, 'thread-1')
    await new Promise((r) => setTimeout(r, 10))
    service.cancel('thread-1')
    await runPromise

    expect(mocks.emitAiChatDone).toHaveBeenCalledTimes(1)
    const payload = mocks.emitAiChatDone.mock.calls[0][1]
    expect(payload.finalText).toBe('Partial response')
    expect(payload.finalText).not.toContain('[Response cancelled by user]')
  })

  it('emitAiChatDone is called (not emitAiChatError) on cancel', async () => {
    mocks.createReactAgent.mockReturnValue({
      streamEvents: makeCancellableStream([])
    })

    const runPromise = service.run(mockReq, 'thread-1')
    await new Promise((r) => setTimeout(r, 10))
    service.cancel('thread-1')
    await runPromise

    expect(mocks.emitAiChatDone).toHaveBeenCalledTimes(1)
    expect(mocks.emitAiChatDone.mock.calls[0][1].finalText).toBe('[Response cancelled by user]')
    expect(mocks.emitAiChatError).not.toHaveBeenCalled()
  })

  it('destroy() aborts all active runs', async () => {
    let signalWasAborted = false
    mocks.createReactAgent.mockReturnValue({
      streamEvents: async function* (
        _input: unknown,
        options: { signal?: AbortSignal } | undefined
      ) {
        yield { event: 'on_chat_model_start', data: {}, run_id: 'llm-1' }
        await new Promise((r) => setTimeout(r, 100))
        signalWasAborted = !!options?.signal?.aborted
        if (options?.signal?.aborted) {
          const err = new Error('Aborted')
          err.name = 'AbortError'
          throw err
        }
      }
    })

    const runPromise = service.run(mockReq, 'thread-1')
    await new Promise((r) => setTimeout(r, 10))
    service.destroy()
    await runPromise

    expect(signalWasAborted).toBe(true)
    expect(mocks.emitAiChatDone).toHaveBeenCalled()
  })

  it('activeRuns is cleaned up after run completes normally', async () => {
    mocks.createReactAgent.mockReturnValue({
      streamEvents: makeNormalStream(['Done'])
    })

    await service.run(mockReq, 'thread-1')
    expect(mocks.emitAiChatDone).toHaveBeenCalledTimes(1)

    service.cancel('thread-1')

    await service.run(mockReq, 'thread-1')
    expect(mocks.emitAiChatDone).toHaveBeenCalledTimes(2)
  })

  it('normal completion without cancel produces expected output', async () => {
    mocks.createReactAgent.mockReturnValue({
      streamEvents: makeNormalStream(['Hello', ' world'])
    })

    await service.run(mockReq, 'thread-1')

    expect(mocks.emitAiChatDone).toHaveBeenCalledTimes(1)
    const payload = mocks.emitAiChatDone.mock.calls[0][1]
    expect(payload.finalText).toBe('Hello world')
    expect(mocks.emitAiChatError).not.toHaveBeenCalled()
  })
})
