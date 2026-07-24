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
import { logger } from '../../src/main/services/logger'
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
      updateStep: vi.fn(() => {
        throw new Error('DB write failed')
      }),
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

describe('AiAgentService error handling', () => {
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

  it('logs trace-cleanup-failed when trace.finish throws during outer catch', async () => {
    mocks.createReforaDeepAgent.mockReturnValue({
      streamEvents: async function* () {
        yield { event: 'on_chat_model_start', data: {}, run_id: 'llm-1' }
        throw new Error('Network error')
      }
    })

    await expect(service.run(mockReq, 'thread-1')).resolves.toBeUndefined()

    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string
    )
    expect(
      warnCalls.some((m) => m.startsWith('aiAgent:trace-cleanup-failed'))
    ).toBe(true)
  })

  it('still emits emitAiChatError when trace cleanup fails', async () => {
    mocks.createReforaDeepAgent.mockReturnValue({
      streamEvents: async function* () {
        yield { event: 'on_chat_model_start', data: {}, run_id: 'llm-1' }
        throw new Error('Network error')
      }
    })

    await service.run(mockReq, 'thread-1')

    expect(mocks.emitAiChatError).toHaveBeenCalledTimes(1)
    expect(mocks.emitAiChatError).toHaveBeenCalledWith(
      mockWin,
      expect.objectContaining({
        threadId: 'thread-1'
      })
    )
  })

  it('run completes without throwing when trace cleanup fails', async () => {
    mocks.createReforaDeepAgent.mockReturnValue({
      streamEvents: async function* () {
        yield { event: 'on_chat_model_start', data: {}, run_id: 'llm-1' }
        throw new Error('Network error')
      }
    })

    await expect(service.run(mockReq, 'thread-1')).resolves.toBeUndefined()
  })
})
