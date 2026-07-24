import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { withDeepAgentRepositories } from '../helpers/deepAgentRepositories'

const mockStreamEvents = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/services/reforaDeepAgent', () => ({
  createReforaDeepAgent: () => ({ streamEvents: mockStreamEvents })
}))

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn()
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

vi.mock('../../src/main/services/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import { createAiAgentService } from '../../src/main/services/aiAgent'
import type {
  AgentTraceStep,
  ChatMessage,
  ChatSendRequest
} from '../../src/shared/ipc-types'
import type { Repositories } from '../../src/main/db/repositories'
import type { AiProvidersService } from '../../src/main/services/aiProviders'
import type { PdfTextService } from '../../src/main/services/pdfText'

let lastStreamInput: { messages: unknown[] } | null = null
let stepCounter = 0

function makeStep(overrides: Partial<AgentTraceStep> = {}): AgentTraceStep {
  stepCounter++
  return {
    id: `step-${stepCounter}`,
    threadId: 't1',
    runId: 'run-1',
    kind: 'run',
    name: null,
    input: null,
    output: null,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    seq: stepCounter,
    ...overrides
  }
}

function createService(listMessagesReturn: ChatMessage[] = []) {
  const addMessage = vi.fn()
  const listMessages = vi.fn(() => listMessagesReturn)
  const addTraceStep = vi.fn(() => makeStep())
  const updateTraceStep = vi.fn((id: string, patch: Partial<AgentTraceStep>) =>
    makeStep({ id, status: patch.status ?? 'done', output: patch.output, endedAt: Date.now() })
  )

  const repos = withDeepAgentRepositories({
    chat: {
      addMessage,
      listMessages,
      createThread: vi.fn(),
      listThreads: vi.fn(),
      getThread: vi.fn(),
      updateTitle: vi.fn()
    },
    settings: {
      get: vi.fn(() => 'provider-1'),
      set: vi.fn(),
      getAll: vi.fn(() => []),
      getMany: vi.fn(() => [])
    },
    workspaceItems: {
      list: vi.fn(() => []),
      add: vi.fn(),
      remove: vi.fn(),
      reorder: vi.fn()
    },
    documents: {
      get: vi.fn(() => null),
      list: vi.fn(() => [])
    },
    aiSummaries: {
      getSummary: vi.fn(() => null)
    },
    aiReports: {
      create: vi.fn()
    },
    agentTraces: {
      addStep: addTraceStep,
      updateStep: updateTraceStep,
      listByThread: vi.fn(() => []),
      listByRun: vi.fn(() => [])
    },
    aiProviders: {},
    categories: {},
    watchFolders: {},
    workspaces: {},
    transaction: vi.fn((fn: () => unknown) => fn())
  } as unknown as Repositories)

  const aiProvidersService = {
    getProvider: vi.fn(() => ({
      id: 'p1',
      name: 'Test Provider',
      baseUrl: 'https://api.test.com/v1',
      model: 'test-model',
      baseModel: 'test-model',
      variant: '',
      variantFormat: 'none' as const,
      hasKey: true,
      temperature: null,
      maxTokens: null,
      createdAt: 0
    })),
    getDecryptedKey: vi.fn(() => 'test-api-key')
  } as unknown as AiProvidersService

  const pdfTextService = {
    getOrExtract: vi.fn().mockResolvedValue('')
  } as unknown as PdfTextService

  const winFn = (() => ({
    isDestroyed: () => false
  })) as unknown as Parameters<typeof createAiAgentService>[1]

  const service = createAiAgentService(repos, winFn, aiProvidersService, pdfTextService, { summarize: vi.fn(), destroy: vi.fn() } as never)
  return { service, addMessage, listMessages, addTraceStep, updateTraceStep }
}

function makeReq(overrides: Partial<ChatSendRequest> = {}): ChatSendRequest {
  return {
    workspaceId: 'ws-1',
    text: 'What papers do we have?',
    providerId: 'p1',
    ...overrides
  }
}

function setupStreamEvents(
  events: Array<Record<string, unknown>>
): void {
  lastStreamInput = null
  mockStreamEvents.mockImplementation(
    async function* (input: { messages: unknown[] }) {
      lastStreamInput = input
      for (const e of events) yield e
    }
  )
}

beforeEach(() => {
  mockStreamEvents.mockReset()
  stepCounter = 0
  lastStreamInput = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('aiAgent tool call persistence', () => {
  describe('on_tool_end', () => {
    const toolEvents = [
      {
        event: 'on_tool_start',
        name: 'search_workspace_docs',
        data: { input: 'machine learning' },
        run_id: 'tool-run-1'
      },
      {
        event: 'on_tool_end',
        name: 'search_workspace_docs',
        data: {
          input: 'machine learning',
          output: '[{"docId":"d1","title":"ML Paper"}]'
        },
        run_id: 'tool-run-1'
      },
      {
        event: 'on_chat_model_stream',
        data: { chunk: { content: 'Based on the search, we have one paper.' } },
        run_id: 'llm-run-1'
      }
    ]

    it('saves tool call results as tool role messages with v2 JSON content', async () => {
      const { service, addMessage } = createService()
      setupStreamEvents(toolEvents)

      await service.run(makeReq(), 't1')

      const toolCall = addMessage.mock.calls.find(
        (call: unknown[]) => call[1] === 'tool'
      )
      expect(toolCall).toBeDefined()
      expect(toolCall![0]).toBe('t1')
      expect(toolCall![2]).toBeTypeOf('string')
      const parsed = JSON.parse(toolCall![2] as string)
      expect(parsed.v).toBe(2)
      expect(parsed.name).toBe('search_workspace_docs')
      expect(parsed.toolCallId).toBeDefined()
      expect(parsed.input).toBe('machine learning')
      expect(parsed.output).toBe('[{"docId":"d1","title":"ML Paper"}]')
    })

    it('saves the assistant message after tool messages', async () => {
      const { service, addMessage } = createService()
      setupStreamEvents(toolEvents)

      await service.run(makeReq(), 't1')

      const calls = addMessage.mock.calls as unknown[][]
      const roles = calls.map((c) => c[1])
      const toolIndex = roles.indexOf('tool')
      const assistantIndex = roles.indexOf('assistant')

      expect(toolIndex).toBeGreaterThanOrEqual(0)
      expect(assistantIndex).toBeGreaterThan(toolIndex)
    })

    it('saves user, tool, and assistant in correct order', async () => {
      const { service, addMessage } = createService()
      setupStreamEvents(toolEvents)

      await service.run(makeReq(), 't1')

      const calls = addMessage.mock.calls as unknown[][]
      const roles = calls.map((c) => c[1])

      expect(roles).toContain('user')
      expect(roles).toContain('tool')
      expect(roles).toContain('assistant')
      const userIndex = roles.indexOf('user')
      const toolIndex = roles.indexOf('tool')
      const assistantIndex = roles.indexOf('assistant')
      expect(userIndex).toBeLessThan(toolIndex)
      expect(toolIndex).toBeLessThan(assistantIndex)
    })

    it('keeps academic tool inputs and results out of chat and trace persistence', async () => {
      const { service, addMessage, addTraceStep, updateTraceStep } = createService()
      setupStreamEvents([
        {
          event: 'on_chat_model_start',
          data: {},
          run_id: 'llm-tool-call-1'
        },
        {
          event: 'on_chat_model_end',
          data: {
            output: new AIMessage({
              content: '',
              tool_calls: [{
                id: 'academic-tool-1',
                name: 'search_arxiv',
                args: { query: 'secret frontier query' }
              }]
            })
          },
          run_id: 'llm-tool-call-1'
        },
        {
          event: 'on_tool_start',
          name: 'search_arxiv',
          data: { input: { query: 'secret frontier query' } },
          run_id: 'academic-tool-1'
        },
        {
          event: 'on_tool_end',
          name: 'search_arxiv',
          data: { output: '{"papers":[{"title":"secret result"}]}' },
          run_id: 'academic-tool-1'
        },
        {
          event: 'on_chat_model_stream',
          data: { chunk: { content: 'A concise answer.' } },
          run_id: 'llm-run-1'
        }
      ])

      await service.run(makeReq(), 't1')

      expect(addMessage.mock.calls.some((call: unknown[]) => call[1] === 'tool')).toBe(false)
      const persistedTrace = JSON.stringify([
        addTraceStep.mock.calls,
        updateTraceStep.mock.calls
      ])
      expect(persistedTrace).not.toContain('secret frontier query')
      expect(persistedTrace).not.toContain('secret result')
      expect(persistedTrace).toContain('Academic research data kept transient')
    })

    it('starts streamed file activity before execution and reuses that trace step', async () => {
      const { service, addTraceStep, updateTraceStep } = createService()
      setupStreamEvents([
        {
          event: 'on_chat_model_stream',
          data: {
            chunk: {
              content: '',
              tool_call_chunks: [{
                id: 'write-call-1',
                index: 0,
                name: 'write_file',
                args: '{"file_path":"/outputs/report.md"'
              }]
            }
          },
          run_id: 'llm-write-1'
        },
        {
          event: 'on_tool_start',
          name: 'write_file',
          data: {
            input: {
              input: '{"file_path":"/outputs/report.md","content":"Report"}'
            }
          },
          run_id: 'tool-write-1'
        },
        {
          event: 'on_tool_end',
          name: 'write_file',
          data: { output: "Successfully wrote to '/outputs/report.md'" },
          run_id: 'tool-write-1'
        },
        {
          event: 'on_chat_model_stream',
          data: { chunk: { content: 'Created the report.' } },
          run_id: 'llm-answer-1'
        }
      ])

      await service.run(makeReq(), 't1')

      const writeCallIndex = addTraceStep.mock.calls.findIndex(
        ([input]) => input.name === 'write_file'
      )
      expect(writeCallIndex).toBeGreaterThanOrEqual(0)
      expect(addTraceStep.mock.calls.filter(([input]) => input.name === 'write_file'))
        .toHaveLength(1)
      expect(addTraceStep.mock.calls[writeCallIndex][0]).toMatchObject({
        kind: 'tool',
        name: 'write_file',
        input: null,
        status: 'running'
      })
      const writeStepId = addTraceStep.mock.results[writeCallIndex].value.id
      expect(updateTraceStep).toHaveBeenCalledWith(writeStepId, {
        input: '{"file_path":"/outputs/report.md","content":"Report"}'
      })
      expect(updateTraceStep).toHaveBeenCalledWith(
        writeStepId,
        expect.objectContaining({ status: 'done' })
      )
    })
  })

  describe('on_tool_error', () => {
    const errorEvents = [
      {
        event: 'on_tool_start',
        name: 'read_paper_fulltext',
        data: { input: 'd1' },
        run_id: 'tool-run-1'
      },
      {
        event: 'on_tool_error',
        name: 'read_paper_fulltext',
        data: { input: 'd1', error: 'File not found' },
        run_id: 'tool-run-1'
      },
      {
        event: 'on_chat_model_stream',
        data: { chunk: { content: 'Sorry, I could not read the paper.' } },
        run_id: 'llm-run-1'
      }
    ]

    it('saves tool error results as tool role messages', async () => {
      const { service, addMessage } = createService()
      setupStreamEvents(errorEvents)

      await service.run(makeReq(), 't1')

      const toolCall = addMessage.mock.calls.find(
        (call: unknown[]) => call[1] === 'tool'
      )
      expect(toolCall).toBeDefined()
      const parsed = JSON.parse(toolCall![2] as string)
      expect(parsed.v).toBe(2)
      expect(parsed.name).toBe('read_paper_fulltext')
      expect(parsed.toolCallId).toBeDefined()
      expect(parsed.input).toBe('d1')
      expect(parsed.output).toBe('File not found')
    })
  })

  describe('history reconstruction', () => {
    it('converts tool role messages to ToolMessage with synthetic AIMessage', async () => {
      const toolContent = JSON.stringify({
        name: 'search_workspace_docs',
        input: 'machine learning',
        output: '[{"docId":"d1"}]'
      })
      const history: ChatMessage[] = [
        {
          id: 'm1',
          threadId: 't1',
          role: 'user',
          content: 'What papers do we have?',
          createdAt: 1
        },
        {
          id: 'm2',
          threadId: 't1',
          role: 'tool',
          content: toolContent,
          createdAt: 2
        },
        {
          id: 'm3',
          threadId: 't1',
          role: 'assistant',
          content: 'We have one ML paper.',
          createdAt: 3
        }
      ]

      const { service } = createService(history)
      setupStreamEvents([
        {
          event: 'on_chat_model_stream',
          data: { chunk: { content: 'Follow-up answer.' } },
          run_id: 'llm-run-1'
        }
      ])

      await service.run(makeReq({ text: 'Tell me more about d1' }), 't1')

      expect(lastStreamInput).not.toBeNull()
      const messages = lastStreamInput!.messages

      expect(messages[0]).toBeInstanceOf(HumanMessage)

      const toolHistoryMsg = messages.find((m) => m instanceof ToolMessage)
      expect(toolHistoryMsg).toBeDefined()
      expect((toolHistoryMsg as ToolMessage).tool_call_id).toBe('legacy_m2')
      expect((toolHistoryMsg as ToolMessage).name).toBe('search_workspace_docs')
      expect((toolHistoryMsg as ToolMessage).content).toContain('[{"docId":"d1"}]')

      const syntheticAi = messages.find(
        (m) =>
          m instanceof AIMessage &&
          Array.isArray((m as AIMessage).tool_calls) &&
          (m as AIMessage).tool_calls!.some(
            (c) => c.id === 'legacy_m2' && c.name === 'search_workspace_docs'
          )
      )
      expect(syntheticAi).toBeDefined()

      const assistantHistoryMsg = messages.find(
        (m) =>
          m instanceof AIMessage &&
          typeof m.content === 'string' &&
          m.content === 'We have one ML paper.'
      )
      expect(assistantHistoryMsg).toBeDefined()
    })
  })
})
