import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, renderHook, act, waitFor } from '@testing-library/react'
import type {
  AgentTraceStep,
  AiProvider,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatMessage,
  ChatReasoningEvent,
  ChatSendRequest,
  ChatTokenEvent,
  ChatTraceEvent
} from '../../src/shared/ipc-types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() }
  })
}))

import { useWorkspaceStore } from '../../src/renderer/store/workspaceStore'
import { useDocumentStore } from '../../src/renderer/store/documentStore'

const ChatPanelModule = await import('../../src/renderer/components/workspace/ChatPanel')
const ChatPanel = ChatPanelModule.default
const { parseReforaDocLink } = ChatPanelModule
const { useChatStream } = await import('../../src/renderer/hooks/useChatStream')
const { AgentTracePanel } = await import('../../src/renderer/components/workspace/AgentTrace')
const ChatMessages = (await import('../../src/renderer/components/workspace/ChatMessages')).default

const mockChatHistory = vi.fn()
const mockChatSend = vi.fn()
const mockChatCancel = vi.fn()
const mockOpenPdf = vi.fn()
let chatDoneHandler: ((payload: ChatDoneEvent) => void) | undefined
let chatErrorHandler: ((payload: ChatErrorEvent) => void) | undefined
let chatTokenHandler: ((payload: ChatTokenEvent) => void) | undefined
let chatReasoningHandler: ((payload: ChatReasoningEvent) => void) | undefined
let chatTraceHandler: ((payload: ChatTraceEvent) => void) | undefined

const TEST_PROVIDER: AiProvider = {
  id: 'p1',
  presetId: 'openai',
  name: 'Test Provider',
  baseUrl: 'http://localhost',
  apiProtocol: 'openai-responses',
  reasoningControl: 'openai',
  reasoningEffort: 'medium',
  model: 'gpt-4o',
  baseModel: 'gpt-4o',
  variant: '',
  variantFormat: 'dash',
  hasKey: true,
  temperature: null,
  maxTokens: null,
  createdAt: 0
}

function makeMessage(content: string): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    threadId: 'thread-1',
    role: 'assistant',
    content,
    createdAt: Date.now()
  }
}

function setupApi(messages: ChatMessage[]): void {
  const w = window as unknown as { api: Record<string, Record<string, unknown>> }
  w.api.aiProviders.list = async () => [TEST_PROVIDER]
  w.api.aiProviders.listModels = async () => ({ ok: true, models: [] })
  w.api.settings.get = async (_key: string, defaultValue: unknown) => defaultValue
  w.api.settings.set = async () => undefined
  w.api.ai.chatHistory = mockChatHistory
  w.api.ai.chatSend = mockChatSend
  w.api.ai.chatCancel = mockChatCancel
  w.api.ai.chatTraces = async () => []
  w.api.ai.chatThreads = async () => []
  w.api.documents.openPdf = mockOpenPdf
  w.api.events.onAiChatDone = (handler: (payload: ChatDoneEvent) => void) => {
    chatDoneHandler = handler
  }
  w.api.events.onAiChatError = (handler: (payload: ChatErrorEvent) => void) => {
    chatErrorHandler = handler
  }
  w.api.events.onAiChatToken = (handler: (payload: ChatTokenEvent) => void) => {
    chatTokenHandler = handler
  }
  w.api.events.onAiChatReasoning = (handler: (payload: ChatReasoningEvent) => void) => {
    chatReasoningHandler = handler
  }
  w.api.events.onAiChatTrace = (handler: (payload: ChatTraceEvent) => void) => {
    chatTraceHandler = handler
  }
  mockChatHistory.mockResolvedValue(messages)
  mockChatSend.mockResolvedValue({ threadId: 'thread-1' })
  mockChatCancel.mockResolvedValue(undefined)
}

function setupStore(): void {
  useWorkspaceStore.setState({
    activeWorkspaceId: 'ws-1',
    activeThreadId: 'thread-1',
    threads: [],
    chatStreaming: false,
    fetchThreads: vi.fn().mockResolvedValue(undefined),
    deleteThread: vi.fn().mockResolvedValue(undefined),
    startNewChat: vi.fn(),
    setActiveThreadId: vi.fn(),
    setChatStreaming: vi.fn()
  })
  useDocumentStore.setState({ showToast: vi.fn() })
}

beforeEach(() => {
  mockChatHistory.mockReset()
  mockChatSend.mockReset()
  mockChatCancel.mockReset()
  mockOpenPdf.mockReset()
  chatDoneHandler = undefined
  chatErrorHandler = undefined
  chatTokenHandler = undefined
  chatReasoningHandler = undefined
  chatTraceHandler = undefined
  mockOpenPdf.mockResolvedValue(null)
  setupStore()
})

afterEach(() => {
  cleanup()
  useWorkspaceStore.setState({
    activeWorkspaceId: null,
    activeThreadId: null,
    threads: []
  })
})

describe('parseReforaDocLink', () => {
  it('parses a simple doc link', () => {
    expect(parseReforaDocLink('refora://doc/abc')).toEqual({
      docId: 'abc',
      query: undefined
    })
  })

  it('parses a doc link with query parameter', () => {
    const result = parseReforaDocLink('refora://doc/abc?q=some+quote')
    expect(result).not.toBeNull()
    expect(result!.docId).toBe('abc')
    expect(result!.query).toBe('q=some+quote')
  })

  it('decodes encoded docId', () => {
    const result = parseReforaDocLink('refora://doc/my%20doc')
    expect(result).not.toBeNull()
    expect(result!.docId).toBe('my doc')
  })

  it('does not throw on malformed percent-sequences', () => {
    expect(() => parseReforaDocLink('refora://doc/%')).not.toThrow()
    expect(() => parseReforaDocLink('refora://doc/a%zz')).not.toThrow()
    const result = parseReforaDocLink('refora://doc/%')
    expect(result).not.toBeNull()
    expect(result!.docId).toBe('%')
  })

  it('returns null for https links', () => {
    expect(parseReforaDocLink('https://example.com')).toBeNull()
  })

  it('returns null for empty href', () => {
    expect(parseReforaDocLink('')).toBeNull()
  })

  it('returns null for malformed refora links', () => {
    expect(parseReforaDocLink('refora://other/abc')).toBeNull()
    expect(parseReforaDocLink('refora://doc')).toBeNull()
  })
})

describe('ChatPanel citation links', () => {
  it('renders refora://doc/ link as a clickable button', async () => {
    setupApi([makeMessage('See [Test Paper](refora://doc/doc-123) for details.')])
    render(<ChatPanel />)

    const btn = await screen.findByRole('button', { name: /Test Paper/i })
    expect(btn.tagName).toBe('BUTTON')
    fireEvent.click(btn)

    await vi.waitFor(() => {
      expect(mockOpenPdf).toHaveBeenCalledWith('doc-123')
    })
  })

  it('does not render citation as an <a> with target=_blank', async () => {
    setupApi([makeMessage('See [Test Paper](refora://doc/doc-123) for details.')])
    render(<ChatPanel />)

    await screen.findByRole('button', { name: /Test Paper/i })
    const links = screen.queryAllByRole('link')
    const citationLinks = links.filter((l) => /Test Paper/i.test(l.textContent ?? ''))
    expect(citationLinks).toHaveLength(0)
  })

  it('renders regular https links as external <a> with target=_blank', async () => {
    setupApi([makeMessage('Check [Example](https://example.com) site.')])
    render(<ChatPanel />)

    const link = await screen.findByRole('link', { name: /Example/i })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('renders multiple citation links as separate buttons', async () => {
    setupApi([
      makeMessage('See [First](refora://doc/doc-a) and [Second](refora://doc/doc-b).')
    ])
    render(<ChatPanel />)

    const btnA = await screen.findByRole('button', { name: /First/i })
    const btnB = await screen.findByRole('button', { name: /Second/i })
    expect(btnA.tagName).toBe('BUTTON')
    expect(btnB.tagName).toBe('BUTTON')

    fireEvent.click(btnA)
    await vi.waitFor(() => {
      expect(mockOpenPdf).toHaveBeenCalledWith('doc-a')
    })

    fireEvent.click(btnB)
    await vi.waitFor(() => {
      expect(mockOpenPdf).toHaveBeenCalledWith('doc-b')
    })
  })

  it('extracts docId correctly when query parameter is present', async () => {
    setupApi([makeMessage('See [Title](refora://doc/abc?q=some+quote).')])
    render(<ChatPanel />)

    const btn = await screen.findByRole('button', { name: /Title/i })
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.getAttribute('title')).toBe('q=some+quote')

    fireEvent.click(btn)
    await vi.waitFor(() => {
      expect(mockOpenPdf).toHaveBeenCalledWith('abc')
    })
  })
})

describe('ChatPanel tool message filtering', () => {
  it('does not render tool messages in the chat history', async () => {
    const toolContent = JSON.stringify({ v: 2, name: 'search_workspace_docs', toolCallId: 'call_1', input: 'q', output: '[]' })
    const msgs: ChatMessage[] = [
      { id: 'm1', threadId: 't1', role: 'user', content: 'hello', createdAt: 0 },
      { id: 'm2', threadId: 't1', role: 'tool', content: toolContent, createdAt: 1 },
      { id: 'm3', threadId: 't1', role: 'assistant', content: 'hi there', createdAt: 2 }
    ]
    setupApi(msgs)
    render(<ChatPanel />)

    await screen.findByText('hello')
    await screen.findByText('hi there')
    expect(screen.queryByText(/search_workspace_docs/)).toBeNull()
    expect(screen.queryByText(/toolCallId/)).toBeNull()
  })
})

function renderMessages(overrides: Partial<Parameters<typeof ChatMessages>[0]> = {}) {
  return render(
    <ChatMessages
      messages={[]}
      traceSteps={[]}
      streaming
      streamingText=""
      streamingReasoning=""
      elapsedSeconds={4}
      loadingHistory={false}
      providers={[]}
      onRegenerate={vi.fn()}
      onSuggestionClick={vi.fn()}
      scrollRef={{ current: null }}
      inputAreaHeight={0}
      stickToBottomRef={{ current: true }}
      {...overrides}
    />
  )
}

describe('ChatMessages presentation', () => {
  it('renders live reasoning in a collapsible activity panel', () => {
    renderMessages({ streamingReasoning: 'Comparing the cited methods.' })

    expect(screen.getByText('workspace.chat.deepThinking')).toBeInTheDocument()
    expect(screen.getByText('Comparing the cited methods.')).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'workspace.chat.reasoningCollapse' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle.querySelector('svg')).not.toBeNull()

    fireEvent.click(toggle)
    expect(screen.queryByText('Comparing the cited methods.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'workspace.chat.reasoningExpand' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders a completed assistant answer without extra header chrome', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', threadId: 't1', role: 'user', content: 'Compare them', createdAt: 1 },
      { id: 'a1', threadId: 't1', role: 'assistant', content: 'The methods differ.', createdAt: 2 }
    ]

    const { container } = renderMessages({ messages, streaming: false })

    expect(container.querySelector('.chat-user-message')).toHaveTextContent('Compare them')
    expect(container.querySelector('.chat-response-group')).toHaveTextContent('The methods differ.')
    expect(container.querySelector('.chat-assistant-header')).toBeNull()
    expect(screen.getAllByText('workspace.chat.traceLlmDone')).toHaveLength(1)

    const runToggle = container.querySelector('.chat-run-toggle') as HTMLButtonElement
    expect(runToggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(runToggle)
    expect(runToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('The methods differ.')).toBeInTheDocument()
  })

  it('renders reasoning, tools, and answer segments in trace order', () => {
    const messages: ChatMessage[] = [
      { id: 'a1', threadId: 't1', role: 'assistant', content: 'Final answer', createdAt: 2 }
    ]
    const base = {
      threadId: 't1',
      runId: 'run-1',
      input: null,
      status: 'done' as const,
      startedAt: 1,
      endedAt: 2,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null
    }
    const traceSteps: AgentTraceStep[] = [
      { ...base, id: 'llm', kind: 'llm', name: 'model_call', input: '{}', output: '', seq: 0 },
      { ...base, id: 'reasoning', kind: 'reasoning', name: 'model_reasoning', output: 'Inspect sources', seq: 1 },
      { ...base, id: 'progress', kind: 'message', name: 'assistant_message', output: 'Checking sources.', seq: 2 },
      { ...base, id: 'tool', kind: 'tool', name: 'search_library', output: '[]', seq: 3 },
      { ...base, id: 'answer', kind: 'message', name: 'assistant_message', output: 'Final answer', seq: 4 }
    ]

    const { container } = renderMessages({ messages, traceSteps, streaming: false })
    const kinds = [...container.querySelectorAll('[data-timeline-kind]')].map(
      (element) => element.getAttribute('data-timeline-kind')
    )

    expect(kinds).toEqual(['reasoning', 'message', 'tool', 'message'])
    expect(container.querySelector('.chat-assistant-avatar')).toBeNull()
    expect(container.querySelector('.chat-reasoning-icon')).toBeNull()
    expect(container.querySelector('.chat-timeline-answer-label')).toBeNull()
    expect(container.querySelector('[data-timeline-kind="llm"]')).toBeNull()
    expect(container.querySelector('[data-timeline-kind="tool"] .agent-trace-kind-icon')).not.toBeNull()
    expect(screen.getAllByText('workspace.chat.traceLlmDone')).toHaveLength(1)
    expect(screen.getByText('workspace.chat.deepThinking')).toBeInTheDocument()
    expect(screen.queryByText('Inspect sources')).not.toBeInTheDocument()
    const reasoningToggle = screen.getByRole('button', { name: 'workspace.chat.reasoningExpand' })
    expect(reasoningToggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(reasoningToggle)
    expect(screen.getByText('Inspect sources')).toBeInTheDocument()
    expect(screen.getByText('Checking sources.')).toBeInTheDocument()
    expect(screen.getByText('workspace.chat.toolSearchLibraryDone')).toBeInTheDocument()
    expect(screen.getByText('Final answer')).toBeInTheDocument()

    const runToggle = container.querySelector('.chat-run-toggle') as HTMLButtonElement
    fireEvent.click(runToggle)
    expect(screen.queryByText('workspace.chat.deepThinking')).not.toBeInTheDocument()
    expect(screen.queryByText('Checking sources.')).not.toBeInTheDocument()
    expect(screen.queryByText('workspace.chat.toolSearchLibraryDone')).not.toBeInTheDocument()
    expect(screen.getByText('Final answer')).toBeInTheDocument()
  })
})

function renderChatStream(activeThreadId: string | null = 'thread-1') {
  setupApi([])
  return renderHook(() =>
    useChatStream({
      activeWorkspaceId: 'ws-1',
      activeProviderId: 'p1',
      activeThreadId,
      requestModel: '',
      deepThinking: false,
      setActiveThreadId: vi.fn(),
      setChatStreaming: vi.fn(),
      fetchThreads: vi.fn().mockResolvedValue(undefined)
    })
  )
}

describe('useChatStream lifecycle', () => {
  it('merges live reasoning and answer tokens into their timeline steps', async () => {
    const { result } = renderChatStream()
    await waitFor(() => expect(result.current.loadingHistory).toBe(false))

    await act(async () => {
      await result.current.sendText('Compare these papers', [], 'thread-1')
    })

    const reasoningStep: AgentTraceStep = {
      id: 'reasoning-1',
      threadId: 'thread-1',
      runId: 'run-1',
      kind: 'reasoning',
      name: 'model_reasoning',
      input: null,
      output: null,
      status: 'running',
      startedAt: 1,
      endedAt: null,
      seq: 0,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null
    }
    const messageStep: AgentTraceStep = {
      ...reasoningStep,
      id: 'message-1',
      kind: 'message',
      name: 'assistant_message',
      seq: 1
    }

    act(() => {
      chatTraceHandler?.({ threadId: 'thread-1', runId: 'run-1', step: reasoningStep })
      chatReasoningHandler?.({ threadId: 'thread-1', runId: 'run-1', stepId: 'reasoning-1', token: 'Inspect ' })
      chatReasoningHandler?.({ threadId: 'thread-1', runId: 'run-1', stepId: 'reasoning-1', token: 'sources' })
      chatTraceHandler?.({ threadId: 'thread-1', runId: 'run-1', step: messageStep })
      chatTokenHandler?.({ threadId: 'thread-1', runId: 'run-1', stepId: 'message-1', token: 'Answer' })
    })

    await waitFor(() => {
      expect(result.current.traceSteps.find((step) => step.id === 'reasoning-1')?.output).toBe('Inspect sources')
      expect(result.current.traceSteps.find((step) => step.id === 'message-1')?.output).toBe('Answer')
    })
  })

  it('keeps failed send context available for retry after a stream error', async () => {
    const { result } = renderChatStream()
    await waitFor(() => expect(result.current.loadingHistory).toBe(false))

    await act(async () => {
      await result.current.sendText('Compare these papers', ['doc-1'], 'thread-1')
    })
    act(() => {
      chatErrorHandler?.({ threadId: 'thread-1', message: 'Provider unavailable' })
    })

    expect(result.current.error).toBe('Provider unavailable')
    expect(result.current.canRetry).toBe(true)

    act(() => {
      result.current.handleRetry()
    })
    await waitFor(() => expect(mockChatSend).toHaveBeenCalledTimes(2))
    expect(mockChatSend.mock.calls[1][0] as ChatSendRequest).toMatchObject({
      text: 'Compare these papers',
      attachments: [{ type: 'document', docId: 'doc-1' }]
    })
  })

  it('preserves attachments when regenerating a completed response', async () => {
    const { result } = renderChatStream()
    await waitFor(() => expect(result.current.loadingHistory).toBe(false))

    await act(async () => {
      await result.current.sendText('Summarize this paper', ['doc-2'], 'thread-1')
    })
    act(() => {
      chatDoneHandler?.({ threadId: 'thread-1', finalText: 'Summary' })
    })

    expect(result.current.canRetry).toBe(false)
    act(() => {
      result.current.handleRegenerate()
    })
    await waitFor(() => expect(mockChatSend).toHaveBeenCalledTimes(2))
    expect(mockChatSend.mock.calls[1][0] as ChatSendRequest).toMatchObject({
      text: 'Summarize this paper',
      attachments: [{ type: 'document', docId: 'doc-2' }]
    })
  })

  it('cancels a new thread after its id arrives when stop is clicked immediately', async () => {
    let resolveSend: ((value: { threadId: string }) => void) | undefined
    const { result } = renderChatStream(null)
    mockChatSend.mockImplementation(
      () => new Promise<{ threadId: string }>((resolve) => {
        resolveSend = resolve
      })
    )
    let sendPromise: Promise<void> | undefined

    await act(async () => {
      sendPromise = result.current.sendText('Start a new chat', [], null)
      await Promise.resolve()
    })
    act(() => {
      result.current.handleCancel()
    })

    expect(mockChatCancel).not.toHaveBeenCalled()
    await act(async () => {
      resolveSend?.({ threadId: 'new-thread' })
      await sendPromise
    })
    expect(mockChatCancel).toHaveBeenCalledWith('new-thread')
    expect(result.current.streaming).toBe(false)
  })
})

describe('AgentTracePanel structure', () => {
  it('keeps expand-all outside the panel toggle button', () => {
    Element.prototype.scrollIntoView = vi.fn()
    const traceStep: AgentTraceStep = {
      id: 'step-1',
      threadId: 'thread-1',
      runId: 'run-1',
      kind: 'llm',
      name: null,
      input: 'Prompt',
      output: null,
      status: 'done',
      startedAt: 0,
      endedAt: 1,
      seq: 0,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null
    }
    render(<AgentTracePanel steps={[traceStep]} streaming={false} />)
    const panelToggle = screen.getByRole('button', { name: /workspace.chat.trace/ })
    fireEvent.click(panelToggle)
    expect(panelToggle.querySelector('button')).toBeNull()
    expect(screen.getByRole('button', { name: 'workspace.chat.expandAll' })).toBeInTheDocument()
  })

  it('uses completed tool labels and pretty prints JSON details', () => {
    Element.prototype.scrollIntoView = vi.fn()
    const traceStep: AgentTraceStep = {
      id: 'step-1',
      threadId: 'thread-1',
      runId: 'run-1',
      kind: 'tool',
      name: 'search_library',
      input: '{"query":"graph","limit":3}',
      output: null,
      status: 'done',
      startedAt: 0,
      endedAt: 10,
      seq: 0,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null
    }
    render(<AgentTracePanel steps={[traceStep]} streaming={false} />)

    fireEvent.click(screen.getByRole('button', { name: /workspace.chat.trace/ }))
    fireEvent.click(screen.getByText('workspace.chat.toolSearchLibraryDone'))

    expect(screen.getByText(/"query": "graph"/)).toBeInTheDocument()
  })
})
