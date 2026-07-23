import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withDeepAgentRepositories } from '../helpers/deepAgentRepositories'

const mocks = vi.hoisted(() => ({
  emitAiChatToken: vi.fn(),
  emitAiChatDone: vi.fn(),
  emitAiChatError: vi.fn(),
  emitAiChatInterrupted: vi.fn(),
  emitAiChatRunStatus: vi.fn(),
  emitAiChatTitleUpdated: vi.fn(),
  emitAiChatTrace: vi.fn(),
  emitAiReportCreated: vi.fn(),
  emitWorkspaceItemsChanged: vi.fn(),
  createReforaDeepAgent: vi.fn()
}))

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(class {})
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
  SystemMessage: vi.fn(class {
    constructor(public content: string) {}
  }),
  HumanMessage: vi.fn(class {
    constructor(public content: string) {}
  }),
  AIMessage: vi.fn(class {
    constructor(public content: string) {}
  })
}))

vi.mock('../../src/main/ipc/events', () => ({
  emitAiChatToken: mocks.emitAiChatToken,
  emitAiChatDone: mocks.emitAiChatDone,
  emitAiChatError: mocks.emitAiChatError,
  emitAiChatInterrupted: vi.fn(),
  emitAiChatRunStatus: vi.fn(),
  emitAiChatTitleUpdated: vi.fn(),
  emitAiChatTrace: mocks.emitAiChatTrace,
  emitAiReportCreated: mocks.emitAiReportCreated,
  emitWorkspaceItemsChanged: mocks.emitWorkspaceItemsChanged
}))

vi.mock('../../src/main/services/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('../../src/main/services/reforaDeepAgent', () => ({
  createReforaDeepAgent: mocks.createReforaDeepAgent
}))

import { createAiAgentService } from '../../src/main/services/aiAgent'
import type { Repositories } from '../../src/main/db/repositories'
import type { AiProvider, ChatSendRequest } from '../../src/shared/ipc-types'

function makeMockRepos(): Repositories {
  let stepCounter = 0
  return withDeepAgentRepositories({
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
  } as unknown as Repositories)
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
    mocks.createReforaDeepAgent.mockReturnValue({
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
    mocks.createReforaDeepAgent.mockReturnValue({
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
    mocks.createReforaDeepAgent.mockReturnValue({
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
    mocks.createReforaDeepAgent.mockReturnValue({
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
    expect(mocks.emitAiChatDone).not.toHaveBeenCalled()
    expect(mocks.emitAiChatError).not.toHaveBeenCalled()
    expect(repos.agentRuns.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: 'cancelled',
        error: 'Cancelled because Refora closed'
      })
    )
  })

  it('marks a superseded run cancelled without persisting a replacement response', async () => {
    mocks.createReforaDeepAgent
      .mockReturnValueOnce({ streamEvents: makeCancellableStream(['Old partial']) })
      .mockReturnValueOnce({ streamEvents: makeNormalStream(['New response']) })

    const firstRun = service.run(mockReq, 'thread-1', 'run-old')
    await new Promise((resolve) => setTimeout(resolve, 10))
    const secondRun = service.run({ ...mockReq, text: 'New request' }, 'thread-1', 'run-new')
    await Promise.all([firstRun, secondRun])

    expect(repos.agentRuns.update).toHaveBeenCalledWith(
      'run-old',
      expect.objectContaining({
        status: 'cancelled',
        error: 'Cancelled because a newer run replaced this run'
      })
    )
    expect(mocks.emitAiChatDone).toHaveBeenCalledTimes(1)
    expect(mocks.emitAiChatDone).toHaveBeenCalledWith(
      mockWin,
      expect.objectContaining({ runId: 'run-new', finalText: 'New response' })
    )
  })

  it('does not persist a superseded response while checkpoint lookup is pending', async () => {
    let resolveOldCheckpoint: ((checkpointId: string) => void) | undefined
    const getHead = vi.fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolveOldCheckpoint = resolve
      }))
      .mockResolvedValueOnce('checkpoint-new')
    service = createAiAgentService(
      repos,
      () => mockWin as never,
      aiProvidersService as never,
      pdfTextService as never,
      { summarize: vi.fn(), destroy: vi.fn() } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      { checkpointer: {}, getHead } as never
    )
    mocks.createReforaDeepAgent
      .mockReturnValueOnce({ streamEvents: makeNormalStream(['Old response']) })
      .mockReturnValueOnce({ streamEvents: makeNormalStream(['New response']) })

    const firstRun = service.run(mockReq, 'thread-1', 'run-old')
    await vi.waitFor(() => expect(getHead).toHaveBeenCalledTimes(1))
    const secondRun = service.run({ ...mockReq, text: 'New request' }, 'thread-1', 'run-new')
    await secondRun
    resolveOldCheckpoint?.('checkpoint-old')
    await firstRun

    const persistedContent = (repos.chat.addMessage as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[2])
    expect(persistedContent).not.toContain('Old response')
    expect(persistedContent).toContain('New response')
  })

  it('waits for an active run to stop before deleting its checkpoints', async () => {
    let streamFinished = false
    mocks.createReforaDeepAgent.mockReturnValue({
      streamEvents: async function* (
        _input: unknown,
        options: { signal?: AbortSignal } | undefined
      ) {
        yield { event: 'on_chat_model_start', data: {}, run_id: 'llm-delete' }
        await new Promise<void>((resolve) => {
          if (options?.signal?.aborted) {
            resolve()
            return
          }
          options?.signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        await new Promise((resolve) => setTimeout(resolve, 20))
        streamFinished = true
        yield {
          event: 'on_chat_model_stream',
          data: { chunk: { content: 'Late response' } },
          run_id: 'llm-delete'
        }
      }
    })
    const deleteCheckpoint = vi.fn(async () => undefined)
    service = createAiAgentService(
      repos,
      () => mockWin as never,
      aiProvidersService as never,
      pdfTextService as never,
      { summarize: vi.fn(), destroy: vi.fn() } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        checkpointer: {},
        deleteThread: deleteCheckpoint
      } as never
    )

    const runPromise = service.run(mockReq, 'thread-1', 'run-delete')
    await new Promise((resolve) => setTimeout(resolve, 10))
    const deletePromise = service.deleteThread('thread-1')

    expect(deleteCheckpoint).not.toHaveBeenCalled()
    expect(streamFinished).toBe(false)
    await deletePromise
    await runPromise
    expect(streamFinished).toBe(true)
    expect(deleteCheckpoint).toHaveBeenCalledWith('thread-1')
    expect(repos.chat.addMessage).toHaveBeenCalledTimes(1)
  })

  it('activeRuns is cleaned up after run completes normally', async () => {
    mocks.createReforaDeepAgent.mockReturnValue({
      streamEvents: makeNormalStream(['Done'])
    })

    await service.run(mockReq, 'thread-1')
    expect(mocks.emitAiChatDone).toHaveBeenCalledTimes(1)

    service.cancel('thread-1')

    await service.run(mockReq, 'thread-1')
    expect(mocks.emitAiChatDone).toHaveBeenCalledTimes(2)
  })

  it('normal completion without cancel produces expected output', async () => {
    mocks.createReforaDeepAgent.mockReturnValue({
      streamEvents: makeNormalStream(['Hello', ' world'])
    })

    await service.run(mockReq, 'thread-1')

    expect(mocks.emitAiChatDone).toHaveBeenCalledTimes(1)
    const payload = mocks.emitAiChatDone.mock.calls[0][1]
    expect(payload.finalText).toBe('Hello world')
    expect(mocks.emitAiChatError).not.toHaveBeenCalled()
  })
})
