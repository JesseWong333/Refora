import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, renderHook, act, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import type {
  AgentTraceStep,
  AiProvider,
  AiReasoningEffort,
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
import { AI_PROVIDERS_CHANGED_EVENT } from '../../src/renderer/utils/aiProviderEvents'

const ChatPanelModule = await import('../../src/renderer/components/workspace/ChatPanel')
const ChatPanel = ChatPanelModule.default
const { parseReforaDocLink } = ChatPanelModule
const { useChatStream } = await import('../../src/renderer/hooks/useChatStream')
const { AgentTracePanel } = await import('../../src/renderer/components/workspace/AgentTrace')
const ChatMessages = (await import('../../src/renderer/components/workspace/ChatMessages')).default
const ChatInput = (await import('../../src/renderer/components/workspace/ChatInput')).default

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
  models: null,
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
  mockChatSend.mockImplementation(async (req: ChatSendRequest) => ({
    threadId: req.threadId ?? 'thread-1',
    runId: req.runId ?? 'run-1'
  }))
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

describe('ChatPanel tab header', () => {
  it('keeps the close control in the tab and the chat actions on the right', () => {
    const onClose = vi.fn()
    setupApi([])

    render(<ChatPanel onClose={onClose} />)

    const tab = screen.getByTestId('panel-tab')
    const actions = screen.getByTestId('panel-tab-actions')
    const close = screen.getByRole('button', { name: 'workspace.chat.closePanel' })
    expect(tab).toContainElement(screen.getByText('workspace.chat.newConversation'))
    expect(tab).toContainElement(close)
    expect(actions).toContainElement(
      screen.getByRole('button', { name: 'workspace.chat.threadHistory' })
    )
    expect(actions).toContainElement(
      screen.getByRole('button', { name: 'workspace.chat.newChat' })
    )

    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
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

describe('ChatPanel provider restoration', () => {
  it('falls back to a valid provider model when saved settings are stale', async () => {
    setupApi([])
    const settingsSet = vi.fn().mockResolvedValue(undefined)
    const w = window as unknown as { api: Record<string, Record<string, unknown>> }
    w.api.settings.get = async (key: string, defaultValue: unknown) => {
      if (key === 'activeProviderId') return 'removed-provider'
      if (key === 'chatSelectedModel') return 'removed-model'
      if (key === 'chatSelectedVariant') return 'max'
      return defaultValue
    }
    w.api.settings.set = settingsSet

    render(<ChatPanel />)

    const selector = await screen.findByRole('button', {
      name: 'workspace.chat.selectProvider'
    })
    await waitFor(() => expect(selector).toHaveTextContent('gpt-4o'))
    expect(selector).not.toHaveTextContent('removed-model')
    const effortButton = screen.getByRole('button', {
      name: 'workspace.chat.reasoningEffort'
    })
    expect(effortButton).toHaveTextContent('settings.aiProviders.effort.medium')
    expect(screen.queryByText('workspace.chat.reasoningEffort')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'workspace.chat.deepThinking' })
    ).not.toBeInTheDocument()
    fireEvent.click(effortButton)
    fireEvent.click(screen.getByRole('option', {
      name: 'settings.aiProviders.effort.high'
    }))
    expect(settingsSet).toHaveBeenCalledWith('chatReasoningEffort', 'high')
    fireEvent.click(selector)
    expect(screen.queryByPlaceholderText('model-id')).toBeNull()
    expect(settingsSet).toHaveBeenCalledWith('activeProviderId', 'p1')
  })

  it('refreshes the configured provider and model after settings changes', async () => {
    setupApi([])
    const ollamaProvider: AiProvider = {
      ...TEST_PROVIDER,
      id: 'ollama-1',
      presetId: 'ollama-local',
      name: 'Ollama',
      model: 'Kimi2.6',
      baseModel: 'Kimi2.6',
      hasKey: false
    }
    let activeProviderId = TEST_PROVIDER.id
    const w = window as unknown as { api: Record<string, Record<string, unknown>> }
    w.api.aiProviders.list = async () => [TEST_PROVIDER, ollamaProvider]
    w.api.settings.get = async (key: string, defaultValue: unknown) => {
      if (key === 'activeProviderId' || key === 'chatSelectedProviderId') {
        return activeProviderId
      }
      if (key === 'chatSelectedModel') {
        return activeProviderId === ollamaProvider.id ? ollamaProvider.model : TEST_PROVIDER.model
      }
      return defaultValue
    }

    render(<ChatPanel />)

    const selector = await screen.findByRole('button', {
      name: 'workspace.chat.selectProvider'
    })
    await waitFor(() => expect(selector).toHaveTextContent('Test Provider/gpt-4o'))

    activeProviderId = ollamaProvider.id
    window.dispatchEvent(new Event(AI_PROVIDERS_CHANGED_EVENT))

    await waitFor(() => expect(selector).toHaveTextContent('Ollama/Kimi2.6'))
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
      activeRunId={null}
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

  it('does not pair a failed run without an answer to the next assistant message', () => {
    const messages: ChatMessage[] = [
      { id: 'a1', threadId: 't1', role: 'assistant', content: 'Successful answer', createdAt: 20 }
    ]
    const traceSteps: AgentTraceStep[] = [
      {
        id: 'failed-run', threadId: 't1', runId: 'run-failed', kind: 'run', name: 'agent_run',
        input: null, output: 'Provider failed', status: 'error', startedAt: 1, endedAt: 2,
        seq: 0, inputTokens: null, outputTokens: null, totalTokens: null
      },
      {
        id: 'success-run', threadId: 't1', runId: 'run-success', kind: 'run', name: 'agent_run',
        input: null, output: null, status: 'done', startedAt: 10, endedAt: 12,
        seq: 0, inputTokens: null, outputTokens: null, totalTokens: null
      },
      {
        id: 'success-message', threadId: 't1', runId: 'run-success', kind: 'message',
        name: 'assistant_message', input: null, output: 'Successful answer', status: 'done',
        startedAt: 11, endedAt: 12, seq: 1, inputTokens: null, outputTokens: null,
        totalTokens: null
      }
    ]

    renderMessages({ messages, traceSteps, streaming: false })

    expect(screen.getByText('Successful answer')).toBeInTheDocument()
    expect(screen.queryByText('workspace.chat.traceCompletedError')).toBeNull()
    expect(screen.getByText('workspace.chat.traceLlmDone')).toBeInTheDocument()
  })
})

describe('ChatInput attachment loading', () => {
  it('keeps toolbar controls inside the available input width', () => {
    const props = {
      input: '',
      onInputChange: vi.fn(),
      streaming: false,
      selectedAttachments: [],
      onSelectedAttachmentsChange: vi.fn(),
      attachMenuOpen: false,
      onAttachMenuOpenChange: vi.fn(),
      activeWorkspaceId: 'ws-1',
      providers: [TEST_PROVIDER],
      canSend: false,
      onSend: vi.fn(),
      onCancel: vi.fn(),
      textareaRef: { current: null },
      inputAreaRef: { current: null },
      toolbar: <div>Toolbar</div>
    }

    render(<ChatInput {...props} />)

    const controls = screen.getByTestId('chat-input-controls')
    expect(controls).toHaveClass('min-w-0', 'flex-1', 'justify-end')
    expect(controls.parentElement).toHaveClass('min-w-0')
  })

  it('ignores documents returned for a workspace that is no longer active', async () => {
    let resolveFirst!: (value: Array<{ kind: string; docId: string }>) => void
    const w = window as unknown as { api: Record<string, Record<string, unknown>> }
    w.api.workspaceItems.list = vi.fn((workspaceId: string) => {
      if (workspaceId === 'ws-1') {
        return new Promise((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve([{ kind: 'document', docId: 'doc-2' }])
    })
    w.api.documents.get = vi.fn(async (docId: string) => ({
      id: docId,
      title: docId === 'doc-1' ? 'First workspace paper' : 'Second workspace paper'
    }))
    const props = {
      input: '',
      onInputChange: vi.fn(),
      streaming: false,
      selectedAttachments: [],
      onSelectedAttachmentsChange: vi.fn(),
      attachMenuOpen: true,
      onAttachMenuOpenChange: vi.fn(),
      providers: [TEST_PROVIDER],
      canSend: false,
      onSend: vi.fn(),
      onCancel: vi.fn(),
      textareaRef: { current: null },
      inputAreaRef: { current: null }
    }
    const { rerender } = render(<ChatInput {...props} activeWorkspaceId="ws-1" />)

    rerender(<ChatInput {...props} activeWorkspaceId="ws-2" />)
    expect(await screen.findByText('Second workspace paper')).toBeInTheDocument()
    resolveFirst([{ kind: 'document', docId: 'doc-1' }])
    await act(async () => Promise.resolve())

    expect(screen.queryByText('First workspace paper')).toBeNull()
    expect(screen.getByText('Second workspace paper')).toBeInTheDocument()
  })
})

function renderChatStream(
  activeThreadId: string | null = 'thread-1',
  reasoningEffort?: AiReasoningEffort
) {
  setupApi([])
  return renderHook(() =>
    useChatStream({
      activeWorkspaceId: 'ws-1',
      activeProviderId: 'p1',
      activeThreadId,
      requestModel: '',
      deepThinking: reasoningEffort != null && reasoningEffort !== 'none',
      reasoningEffort,
      setActiveThreadId: vi.fn(),
      setChatStreaming: vi.fn(),
      fetchThreads: vi.fn().mockResolvedValue(undefined)
    })
  )
}

describe('useChatStream lifecycle', () => {
  it('keeps a new chat alive after the Strict Mode effect replay', async () => {
    setupApi([])
    const setActiveThreadId = vi.fn()
    const { result } = renderHook(
      () => useChatStream({
        activeWorkspaceId: 'ws-1',
        activeProviderId: 'p1',
        activeThreadId: null,
        requestModel: '',
        deepThinking: false,
        setActiveThreadId,
        setChatStreaming: vi.fn(),
        fetchThreads: vi.fn().mockResolvedValue(undefined)
      }),
      { wrapper: StrictMode }
    )

    await waitFor(() => expect(result.current.loadingHistory).toBe(false))
    await act(async () => {
      await result.current.sendText('Start a new chat', [], null)
    })

    expect(mockChatCancel).not.toHaveBeenCalled()
    expect(setActiveThreadId).toHaveBeenCalledWith('thread-1')
    expect(result.current.streaming).toBe(true)
  })

  it('sends the selected reasoning effort with the chat request', async () => {
    const { result } = renderChatStream('thread-1', 'high')
    await waitFor(() => expect(result.current.loadingHistory).toBe(false))

    await act(async () => {
      await result.current.sendText('Think carefully', [], 'thread-1')
    })

    expect(mockChatSend.mock.calls[0][0] as ChatSendRequest).toMatchObject({
      features: { deepThinking: true, reasoningEffort: 'high' }
    })
  })

  it('merges live reasoning and answer tokens into their timeline steps', async () => {
    const { result } = renderChatStream()
    await waitFor(() => expect(result.current.loadingHistory).toBe(false))

    await act(async () => {
      await result.current.sendText('Compare these papers', [], 'thread-1')
    })
    const runId = (mockChatSend.mock.calls[0][0] as ChatSendRequest).runId!

    const reasoningStep: AgentTraceStep = {
      id: 'reasoning-1',
      threadId: 'thread-1',
      runId,
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
      chatTraceHandler?.({ threadId: 'thread-1', runId, step: reasoningStep })
      chatReasoningHandler?.({ threadId: 'thread-1', runId, stepId: 'reasoning-1', token: 'Inspect ' })
      chatReasoningHandler?.({ threadId: 'thread-1', runId, stepId: 'reasoning-1', token: 'sources' })
      chatTraceHandler?.({ threadId: 'thread-1', runId, step: messageStep })
      chatTokenHandler?.({ threadId: 'thread-1', runId, stepId: 'message-1', token: 'Answer' })
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
    const runId = (mockChatSend.mock.calls[0][0] as ChatSendRequest).runId!
    act(() => {
      chatErrorHandler?.({ threadId: 'thread-1', runId, message: 'Provider unavailable' })
    })

    expect(result.current.error).toBe('Provider unavailable')
    expect(result.current.canRetry).toBe(true)

    act(() => {
      result.current.handleRetry()
    })
    await waitFor(() => expect(mockChatSend).toHaveBeenCalledTimes(2))
    expect(mockChatSend.mock.calls[1][0] as ChatSendRequest).toMatchObject({
      text: 'Compare these papers',
      replaceLastExchange: true,
      replaceRunId: runId,
      attachments: [{ type: 'document', docId: 'doc-1' }]
    })
  })

  it('preserves attachments when regenerating a completed response', async () => {
    const { result } = renderChatStream()
    await waitFor(() => expect(result.current.loadingHistory).toBe(false))

    await act(async () => {
      await result.current.sendText('Summarize this paper', ['doc-2'], 'thread-1')
    })
    const runId = (mockChatSend.mock.calls[0][0] as ChatSendRequest).runId!
    act(() => {
      chatDoneHandler?.({ threadId: 'thread-1', runId, finalText: 'Summary' })
    })

    expect(result.current.canRetry).toBe(false)
    act(() => {
      result.current.handleRegenerate()
    })
    await waitFor(() => expect(mockChatSend).toHaveBeenCalledTimes(2))
    expect(mockChatSend.mock.calls[1][0] as ChatSendRequest).toMatchObject({
      text: 'Summarize this paper',
      replaceLastExchange: true,
      attachments: [{ type: 'document', docId: 'doc-2' }]
    })
  })

  it('ignores late events from an older run in the same thread', async () => {
    const { result } = renderChatStream()
    await waitFor(() => expect(result.current.loadingHistory).toBe(false))

    await act(async () => {
      await result.current.sendText('Current request', [], 'thread-1')
    })
    const runId = (mockChatSend.mock.calls[0][0] as ChatSendRequest).runId!

    act(() => {
      chatTokenHandler?.({ threadId: 'thread-1', runId: 'older-run', token: 'stale' })
      chatErrorHandler?.({ threadId: 'thread-1', runId: 'older-run', message: 'stale error' })
      chatTokenHandler?.({ threadId: 'thread-1', runId, token: 'current' })
    })

    await waitFor(() => expect(result.current.streamingText).toBe('current'))
    expect(result.current.error).toBeNull()
    expect(result.current.streaming).toBe(true)
  })

  it('does not hydrate history over a newly started live run', async () => {
    setupApi([])
    const setActiveThreadId = vi.fn()
    const { result, rerender } = renderHook(
      ({ threadId }: { threadId: string | null }) => useChatStream({
        activeWorkspaceId: 'ws-1',
        activeProviderId: 'p1',
        activeThreadId: threadId,
        requestModel: '',
        deepThinking: false,
        setActiveThreadId,
        setChatStreaming: vi.fn(),
        fetchThreads: vi.fn().mockResolvedValue(undefined)
      }),
      { initialProps: { threadId: null as string | null } }
    )

    await act(async () => {
      await result.current.sendText('New live question', [], null)
    })
    rerender({ threadId: 'thread-1' })

    expect(mockChatHistory).not.toHaveBeenCalled()
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].content).toBe('New live question')
    expect(result.current.streaming).toBe(true)
  })

  it('cancels an active run and releases the global lock when unmounted', async () => {
    setupApi([])
    const setChatStreaming = vi.fn()
    const { result, unmount } = renderHook(() => useChatStream({
      activeWorkspaceId: 'ws-1',
      activeProviderId: 'p1',
      activeThreadId: 'thread-1',
      requestModel: '',
      deepThinking: false,
      setActiveThreadId: vi.fn(),
      setChatStreaming,
      fetchThreads: vi.fn().mockResolvedValue(undefined)
    }))
    await waitFor(() => expect(result.current.loadingHistory).toBe(false))
    await act(async () => {
      await result.current.sendText('Keep running', [], 'thread-1')
    })

    unmount()

    expect(mockChatCancel).toHaveBeenCalledWith('thread-1')
    expect(setChatStreaming).toHaveBeenLastCalledWith(false)
  })

  it('cancels a new thread after its id arrives when stop is clicked immediately', async () => {
    let resolveSend: ((value: { threadId: string; runId: string }) => void) | undefined
    let requestedRunId = ''
    const { result } = renderChatStream(null)
    mockChatSend.mockImplementation(
      (req: ChatSendRequest) => new Promise<{ threadId: string; runId: string }>((resolve) => {
        requestedRunId = req.runId!
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
      resolveSend?.({ threadId: 'new-thread', runId: requestedRunId })
      await sendPromise
    })
    expect(mockChatCancel).toHaveBeenCalledWith('new-thread')
    expect(result.current.streaming).toBe(true)
    act(() => {
      chatDoneHandler?.({
        threadId: 'new-thread',
        runId: requestedRunId,
        finalText: '[Response cancelled by user]'
      })
    })
    expect(result.current.streaming).toBe(false)
    expect(result.current.messages.at(-1)?.content).toBe('[Response cancelled by user]')
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
