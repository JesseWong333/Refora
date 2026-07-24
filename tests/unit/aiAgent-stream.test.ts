import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withDeepAgentRepositories } from '../helpers/deepAgentRepositories'

const mocks = vi.hoisted(() => ({
  emitAiChatToken: vi.fn(),
  emitAiChatReasoning: vi.fn(),
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
  emitAiChatReasoning: mocks.emitAiChatReasoning,
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

interface StreamEvent {
  event: string
  data: unknown
  run_id: string
}

function makeStream(events: StreamEvent[]) {
  return async function* () {
    for (const evt of events) {
      yield evt
    }
  }
}

function streamEvent(chunk: Record<string, unknown>): StreamEvent {
  return { event: 'on_chat_model_stream', data: { chunk }, run_id: 'r1' }
}

function tokenCalls(): string[] {
  return mocks.emitAiChatToken.mock.calls.map((c) => (c[1] as { token: string }).token)
}

function reasoningCalls(): string[] {
  return mocks.emitAiChatReasoning.mock.calls.map((c) => (c[1] as { token: string }).token)
}

describe('AiAgentService stream content handling', () => {
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

  it('emits string content directly', async () => {
    mocks.createReforaDeepAgent.mockReturnValue({
      streamEvents: makeStream([streamEvent({ content: 'Hello' })])
    })

    await service.run(mockReq, 'thread-1')

    expect(tokenCalls()).toEqual(['Hello'])
    expect(mocks.emitAiChatDone).toHaveBeenCalledTimes(1)
  })

  it('extracts text from array content with text block', async () => {
    mocks.createReforaDeepAgent.mockReturnValue({
      streamEvents: makeStream([
        streamEvent({ content: [{ type: 'text', text: 'World' }] })
      ])
    })

    await service.run(mockReq, 'thread-1')

    expect(tokenCalls()).toEqual(['World'])
  })

  it('extracts text from array content with reasoning block', async () => {
    mocks.createReforaDeepAgent.mockReturnValue({
      streamEvents: makeStream([
        streamEvent({ content: [{ type: 'reasoning', reasoning: 'thinking...' }] })
      ])
    })

    await service.run(mockReq, 'thread-1')

    expect(tokenCalls()).toEqual([])
    expect(reasoningCalls()).toEqual(['thinking...'])
  })

  it('extracts Python Responses API reasoning summary deltas', async () => {
    mocks.createReforaDeepAgent.mockReturnValue({
      streamEvents: makeStream([
        streamEvent({
          content: [{
            type: 'reasoning',
            summary: [
              { index: 0, type: 'summary_text', text: 'inspect ' },
              { index: 1, type: 'summary_text', text: 'sources' }
            ]
          }]
        })
      ])
    })

    await service.run(mockReq, 'thread-1')

    expect(tokenCalls()).toEqual([])
    expect(reasoningCalls()).toEqual(['inspect ', 'sources'])
  })

  it('concatenates mixed text and reasoning blocks', async () => {
    mocks.createReforaDeepAgent.mockReturnValue({
      streamEvents: makeStream([
        streamEvent({
          content: [
            { type: 'text', text: 'A' },
            { type: 'reasoning', reasoning: 'B' }
          ]
        })
      ])
    })

    await service.run(mockReq, 'thread-1')

    expect(tokenCalls()).toEqual(['A'])
    expect(reasoningCalls()).toEqual(['B'])
  })

  it('falls back to additional_kwargs.reasoning_content', async () => {
    mocks.createReforaDeepAgent.mockReturnValue({
      streamEvents: makeStream([
        streamEvent({
          content: '',
          additional_kwargs: { reasoning_content: 'secret' }
        })
      ])
    })

    await service.run(mockReq, 'thread-1')

    expect(tokenCalls()).toEqual([])
    expect(reasoningCalls()).toEqual(['secret'])
  })

  it('does not emit a token for empty string content', async () => {
    mocks.createReforaDeepAgent.mockReturnValue({
      streamEvents: makeStream([streamEvent({ content: '' })])
    })

    await service.run(mockReq, 'thread-1')

    expect(mocks.emitAiChatToken).not.toHaveBeenCalled()
  })

  it('does not emit a token for non-text/non-reasoning array content', async () => {
    mocks.createReforaDeepAgent.mockReturnValue({
      streamEvents: makeStream([
        streamEvent({ content: [{ type: 'image_url', image_url: '...' }] })
      ])
    })

    await service.run(mockReq, 'thread-1')

    expect(mocks.emitAiChatToken).not.toHaveBeenCalled()
  })

  it('persists reasoning, tool, and answer segments in event order', async () => {
    mocks.createReforaDeepAgent.mockReturnValue({
      streamEvents: makeStream([
        { event: 'on_chat_model_start', data: {}, run_id: 'llm-1' },
        streamEvent({ content: [{ type: 'reasoning', reasoning: 'Inspect sources' }] }),
        { event: 'on_chat_model_end', data: {}, run_id: 'llm-1' },
        { event: 'on_tool_start', data: { input: 'graph' }, run_id: 'tool-1', name: 'search_library' },
        { event: 'on_tool_end', data: { output: '[]' }, run_id: 'tool-1', name: 'search_library' },
        { event: 'on_chat_model_start', data: {}, run_id: 'llm-2' },
        { event: 'on_chat_model_stream', data: { chunk: { content: 'Final answer' } }, run_id: 'llm-2' },
        { event: 'on_chat_model_end', data: {}, run_id: 'llm-2' }
      ] as StreamEvent[])
    })

    await service.run(mockReq, 'thread-1')

    const kinds = vi.mocked(repos.agentTraces.addStep).mock.calls.map(
      ([input]) => (input as { kind: string }).kind
    )
    expect(kinds).toEqual(['run', 'llm', 'reasoning', 'tool', 'llm', 'message'])
    expect(mocks.emitAiChatReasoning).toHaveBeenCalledWith(
      mockWin,
      expect.objectContaining({ runId: expect.any(String), stepId: 'step-2', token: 'Inspect sources' })
    )
    expect(mocks.emitAiChatToken).toHaveBeenCalledWith(
      mockWin,
      expect.objectContaining({ runId: expect.any(String), stepId: 'step-5', token: 'Final answer' })
    )
    expect(vi.mocked(repos.agentTraces.updateStep).mock.calls).toEqual(
      expect.arrayContaining([
        ['step-2', expect.objectContaining({ output: 'Inspect sources', status: 'done' })],
        ['step-5', expect.objectContaining({ output: 'Final answer', status: 'done' })]
      ])
    )
  })
})
