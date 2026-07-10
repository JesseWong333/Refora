import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  Send,
  Square,
  ChevronDown,
  ChevronRight,
  Paperclip,
  Sparkles,
  Wrench,
  Bot,
  Activity,
  MessageSquare,
  Trash2
} from 'lucide-react'
import { api } from '../../ipc'
import { errorMessage } from '../../../shared/ipc-types'
import type {
  AgentTraceStep,
  AiProvider,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatMessage,
  ChatTokenEvent,
  ChatTraceEvent,
  ProviderModelInfo
} from '../../../shared/ipc-types'
import {
  COMMON_VARIANTS,
  composeModelId,
  parseModelId,
  supportsModelVariants
} from '../../../shared/modelVariant'
import { useWorkspaceStore } from '../../store/workspaceStore'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const REMARK_PLUGINS = [remarkGfm]

const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

const RECENT_MODELS_KEY = 'chatRecentModels'
const MAX_RECENT = 8

function localMessage(
  threadId: string,
  role: ChatMessage['role'],
  content: string
): ChatMessage {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    threadId,
    role,
    content,
    createdAt: Date.now()
  }
}

async function loadRecentModels(): Promise<string[]> {
  try {
    const raw = await api.settings.get<string>(RECENT_MODELS_KEY, '[]')
    const parsed = JSON.parse(typeof raw === 'string' ? raw : '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

async function pushRecentModel(model: string): Promise<void> {
  const id = model.trim()
  if (!id) return
  const prev = await loadRecentModels()
  const next = [id, ...prev.filter((m) => m !== id)].slice(0, MAX_RECENT)
  await api.settings.set(RECENT_MODELS_KEY, JSON.stringify(next))
}

function mergeTraceStep(prev: AgentTraceStep[], step: AgentTraceStep): AgentTraceStep[] {
  const idx = prev.findIndex((s) => s.id === step.id)
  if (idx === -1) {
    return [...prev, step].sort((a, b) => a.startedAt - b.startedAt || a.seq - b.seq)
  }
  const next = prev.slice()
  next[idx] = step
  return next
}

function formatDuration(step: AgentTraceStep): string | null {
  if (step.endedAt == null) return null
  const ms = Math.max(0, step.endedAt - step.startedAt)
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function TraceStepRow({ step }: { step: AgentTraceStep }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const hasBody = !!(step.input || step.output)
  const kindLabel =
    step.kind === 'tool'
      ? t('workspace.chat.traceTool', 'Tool')
      : step.kind === 'llm'
        ? t('workspace.chat.traceLlm', 'Model')
        : t('workspace.chat.traceRun', 'Run')
  const statusLabel =
    step.status === 'running'
      ? t('workspace.chat.traceRunning', 'Running')
      : step.status === 'error'
        ? t('workspace.chat.traceError', 'Error')
        : t('workspace.chat.traceDone', 'Done')
  const duration = formatDuration(step)
  const Icon = step.kind === 'tool' ? Wrench : step.kind === 'llm' ? Bot : Activity
  const statusClass =
    step.status === 'running'
      ? 'text-accent'
      : step.status === 'error'
        ? 'text-error'
        : 'text-muted'

  return (
    <div className="rounded-lg border border-border/60 bg-background/60">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
        onClick={() => hasBody && setOpen((v) => !v)}
        disabled={!hasBody}
        aria-expanded={open}
      >
        {hasBody ? (
          open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <Icon className="h-3 w-3 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
          <span className="text-muted">{kindLabel}</span>
          {step.name ? (
            <>
              <span className="text-muted"> · </span>
              <span className="font-medium">{step.name}</span>
            </>
          ) : null}
        </span>
        {duration && <span className="shrink-0 text-[10px] text-muted">{duration}</span>}
        <span className={`shrink-0 text-[10px] ${statusClass}`}>{statusLabel}</span>
      </button>
      {open && hasBody && (
        <div className="space-y-1.5 border-t border-border/50 px-2 py-1.5">
          {step.input && (
            <div>
              <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                {t('workspace.chat.traceInput', 'Input')}
              </p>
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-panel-2 px-1.5 py-1 text-[10px] text-foreground">
                {step.input}
              </pre>
            </div>
          )}
          {step.output && (
            <div>
              <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                {t('workspace.chat.traceOutput', 'Output')}
              </p>
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-panel-2 px-1.5 py-1 text-[10px] text-foreground">
                {step.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AgentTracePanel({
  steps,
  streaming
}: {
  steps: AgentTraceStep[]
  streaming: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const visible = steps.filter((s) => s.kind !== 'run')
  if (visible.length === 0 && !streaming) return null

  return (
    <div className="rounded-xl border border-border bg-panel-2/80">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" />
        )}
        <Activity className="h-3.5 w-3.5 shrink-0 text-muted" />
        <span className="text-[11px] font-medium text-foreground">
          {t('workspace.chat.trace', 'Agent steps')}
        </span>
        <span className="text-[10px] text-muted">
          {visible.length > 0 ? visible.length : streaming ? '…' : 0}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 px-2 pb-2">
          {visible.length === 0 ? (
            <p className="px-1 py-1 text-[11px] text-muted">
              {t('workspace.chat.traceEmpty', 'No tool or model steps yet.')}
            </p>
          ) : (
            visible.map((step) => <TraceStepRow key={step.id} step={step} />)
          )}
        </div>
      )}
    </div>
  )
}

export default function ChatPanel() {
  const { t } = useTranslation()
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const activeThreadId = useWorkspaceStore((s) => s.activeThreadId)
  const setActiveThreadId = useWorkspaceStore((s) => s.setActiveThreadId)
  const startNewChat = useWorkspaceStore((s) => s.startNewChat)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [traceSteps, setTraceSteps] = useState<AgentTraceStep[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [activeProviderId, setActiveProviderId] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedVariant, setSelectedVariant] = useState('')
  const [deepThinking, setDeepThinking] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [providerModels, setProviderModels] = useState<ProviderModelInfo[]>([])
  const [recentModels, setRecentModels] = useState<string[]>([])
  const [customModel, setCustomModel] = useState('')
  const [modelSwitchHint, setModelSwitchHint] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)

  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([])
  const [workspaceDocs, setWorkspaceDocs] = useState<Array<{ docId: string; title: string }>>([])

  const threads = useWorkspaceStore((s) => s.threads)
  const fetchThreads = useWorkspaceStore((s) => s.fetchThreads)
  const deleteThread = useWorkspaceStore((s) => s.deleteThread)
  const [threadMenuOpen, setThreadMenuOpen] = useState(false)
  const threadMenuRef = useRef<HTMLDivElement | null>(null)

  const threadIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const attachMenuRef = useRef<HTMLDivElement | null>(null)
  const hadMessagesRef = useRef(false)

  const activeProvider = providers.find((p) => p.id === activeProviderId) ?? null

  const requestModel = useMemo(() => {
    if (!selectedModel) return ''
    const format = activeProvider?.variantFormat ?? 'dash'
    return composeModelId(selectedModel, selectedVariant, format)
  }, [selectedModel, selectedVariant, activeProvider?.variantFormat])

  const loadProviders = useCallback(async () => {
    try {
      const [list, active, recent] = await Promise.all([
        api.aiProviders.list(),
        api.settings.get<string>('activeProviderId', ''),
        loadRecentModels()
      ])
      setProviders(list)
      setRecentModels(recent)
      const nextId =
        (active && list.some((p) => p.id === active) && active) ||
        (list.length > 0 ? list[0].id : '')
      setActiveProviderId(nextId)
      const p = list.find((x) => x.id === nextId)
      if (p) {
        const parsed = parseModelId(p.model)
        setSelectedModel(p.baseModel || parsed.baseModel || p.model)
        setSelectedVariant(p.variant || parsed.variant)
      }
    } catch (e) {
      setError(errorMessage(e, 'Failed to load providers'))
    }
  }, [])

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  useEffect(() => {
    if (!activeProviderId) {
      setProviderModels([])
      return
    }
    let cancelled = false
    setLoadingModels(true)
    void api.aiProviders
      .listModels({ providerId: activeProviderId })
      .then((res) => {
        if (cancelled) return
        setProviderModels(res.ok ? res.models : [])
      })
      .catch(() => {
        if (!cancelled) setProviderModels([])
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeProviderId])

  useEffect(() => {
    threadIdRef.current = activeThreadId
    setStreamingText('')
    setStreaming(false)
    setError(null)
    if (!activeThreadId) {
      setMessages([])
      setTraceSteps([])
      hadMessagesRef.current = false
      return
    }
    let cancelled = false
    void Promise.all([
      api.ai.chatHistory(activeThreadId),
      api.ai.chatTraces(activeThreadId)
    ])
      .then(([history, traces]) => {
        if (cancelled || threadIdRef.current !== activeThreadId) return
        setMessages(history)
        setTraceSteps(traces)
        hadMessagesRef.current = history.length > 0
      })
      .catch(() => {
        if (cancelled) return
        setMessages([])
        setTraceSteps([])
      })
    return () => {
      cancelled = true
    }
  }, [activeThreadId])

  useEffect(() => {
    const onToken = (payload: ChatTokenEvent) => {
      if (payload.threadId !== threadIdRef.current) return
      setStreamingText((prev) => prev + payload.token)
    }
    const onDone = (payload: ChatDoneEvent) => {
      if (payload.threadId !== threadIdRef.current) return
      setMessages((prev) => [
        ...prev,
        localMessage(payload.threadId, 'assistant', payload.finalText)
      ])
      setStreamingText('')
      setStreaming(false)
    }
    const onError = (payload: ChatErrorEvent) => {
      if (payload.threadId !== threadIdRef.current) return
      setError(payload.message)
      setStreamingText('')
      setStreaming(false)
    }
    const onTrace = (payload: ChatTraceEvent) => {
      if (payload.threadId !== threadIdRef.current) return
      setTraceSteps((prev) => mergeTraceStep(prev, payload.step))
    }
    api.events.onAiChatToken(onToken)
    api.events.onAiChatDone(onDone)
    api.events.onAiChatError(onError)
    api.events.onAiChatTrace(onTrace)
    return () => {
      api.events.off('ai:chat:token', onToken)
      api.events.off('ai:chat:done', onDone)
      api.events.off('ai:chat:error', onError)
      api.events.off('ai:chat:trace', onTrace)
    }
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streamingText, traceSteps])

  useEffect(() => {
    if (!modelMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setModelMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [modelMenuOpen])

  useEffect(() => {
    void fetchThreads()
  }, [activeWorkspaceId, fetchThreads])

  useEffect(() => {
    if (!threadMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!threadMenuRef.current?.contains(e.target as Node)) {
        setThreadMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [threadMenuOpen])

  useEffect(() => {
    if (!attachMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!attachMenuRef.current?.contains(e.target as Node)) {
        setAttachMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [attachMenuOpen])

  useEffect(() => {
    if (!attachMenuOpen || !activeWorkspaceId) return
    void (async () => {
      try {
        const items = await api.workspaceItems.list(activeWorkspaceId)
        const docItems = items.filter((i) => i.kind === 'document' && i.docId)
        const docs = await Promise.all(
          docItems.map(async (i) => {
            const doc = await api.documents.get(i.docId!)
            return { docId: i.docId!, title: doc?.title ?? doc?.fileName ?? i.docId! }
          })
        )
        setWorkspaceDocs(docs)
      } catch {
        setWorkspaceDocs([])
      }
    })()
  }, [attachMenuOpen, activeWorkspaceId])

  const applyModel = useCallback(
    async (baseModel: string, variant = '', providerId?: string) => {
      const nextProviderId = providerId ?? activeProviderId
      if (providerId && providerId !== activeProviderId) {
        setActiveProviderId(providerId)
        void api.settings.set('activeProviderId', providerId)
      }
      setSelectedModel(baseModel)
      setSelectedVariant(variant)
      if (hadMessagesRef.current || messages.length > 0) {
        setModelSwitchHint(true)
        window.setTimeout(() => setModelSwitchHint(false), 3500)
      }
      const p = providers.find((x) => x.id === nextProviderId)
      const format = p?.variantFormat ?? 'dash'
      const full = composeModelId(baseModel, variant, format)
      if (nextProviderId && full) {
        try {
          const updated = await api.aiProviders.update(nextProviderId, {
            model: full,
            baseModel,
            variant,
            variantFormat: format
          })
          setProviders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
          await pushRecentModel(full)
          setRecentModels(await loadRecentModels())
        } catch (e) {
          setError(errorMessage(e, 'Failed to update model'))
        }
      }
      setModelMenuOpen(false)
    },
    [activeProviderId, messages.length, providers]
  )

  const handleSend = useCallback(async () => {
    if (!activeWorkspaceId || !activeProviderId || !input.trim() || streaming) return
    const text = input.trim()
    const existingThread = activeThreadId
    setMessages((prev) => [...prev, localMessage(existingThread ?? '', 'user', text)])
    setInput('')
    setStreaming(true)
    setStreamingText('')
    setError(null)
    hadMessagesRef.current = true
    try {
      const model = requestModel || undefined
      if (model) void pushRecentModel(model)
      const { threadId } = await api.ai.chatSend({
        workspaceId: activeWorkspaceId,
        threadId: existingThread ?? undefined,
        text,
        providerId: activeProviderId,
        model,
        features: { deepThinking },
        attachments: selectedAttachments.length > 0
          ? selectedAttachments.map((docId) => ({ type: 'document' as const, docId }))
          : undefined
      })
      if (!existingThread) {
        setActiveThreadId(threadId)
        threadIdRef.current = threadId
      }
      void fetchThreads()
    } catch (e) {
      setError(errorMessage(e, 'Failed to send message'))
      setStreaming(false)
      setStreamingText('')
    }
    setSelectedAttachments([])
    setAttachMenuOpen(false)
  }, [
    activeWorkspaceId,
    activeProviderId,
    input,
    streaming,
    activeThreadId,
    setActiveThreadId,
    requestModel,
    deepThinking,
    fetchThreads,
    selectedAttachments
  ])

  const handleCancel = useCallback(() => {
    if (!threadIdRef.current) return
    void api.ai.chatCancel(threadIdRef.current)
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const showEmpty = messages.length === 0 && !streamingText
  const canSend = !!activeWorkspaceId && !!activeProviderId && !!input.trim() && !streaming
  const variantCapable =
    supportsModelVariants(selectedModel) ||
    providerModels.some((m) => m.id === selectedModel && m.supportsVariants)

  const displayModelLabel = providers.length === 0
    ? t('workspace.chat.notConfigured', 'Not configured')
    : requestModel || t('workspace.chat.selectProvider', 'Select model / provider')

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-1.5">
        <div className="relative" ref={threadMenuRef}>
          <button
            type="button"
            className="sidebar-header-btn"
            onClick={() => setThreadMenuOpen((v) => !v)}
            title={t('workspace.chat.threadHistory', 'Thread history')}
            aria-label={t('workspace.chat.threadHistory', 'Thread history')}
            disabled={streaming}
          >
            <MessageSquare className="h-4 w-4" />
          </button>
          {threadMenuOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-border bg-panel shadow-lg">
              {threads.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-muted">
                  {t('workspace.chat.noThreads', 'No conversations yet')}
                </p>
              ) : (
                threads.map((th) => (
                  <div
                    key={th.id}
                    className={`flex items-center gap-1 px-2 py-1.5 text-[11px] hover:bg-hover ${
                      th.id === activeThreadId ? 'bg-active text-foreground' : 'text-muted'
                    }`}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left"
                      onClick={() => {
                        setActiveThreadId(th.id)
                        setThreadMenuOpen(false)
                      }}
                    >
                      {th.title?.trim() || `${t('workspace.chat.thread', 'Thread')} ${th.id.slice(0, 8)}`}
                    </button>
                    <button
                      type="button"
                      className="shrink-0 text-muted hover:text-error"
                      onClick={(e) => {
                        e.stopPropagation()
                        void deleteThread(th.id).then(() => void fetchThreads())
                      }}
                      title={t('common.delete', 'Delete')}
                      aria-label={t('common.delete', 'Delete')}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <span className="truncate text-xs font-medium text-muted">
          {t('workspace.chat.title', 'Chat')}
        </span>
        <button
          type="button"
          className="sidebar-header-btn"
          onClick={startNewChat}
          title={t('workspace.chat.newChat', 'New chat')}
          aria-label={t('workspace.chat.newChat', 'New chat')}
          disabled={streaming}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {showEmpty ? (
          <div className="flex h-full items-center justify-center text-center">
            <p className="text-xs text-muted">
              {providers.length === 0
                ? t(
                    'workspace.chat.noProvider',
                    'No AI provider configured. Add one in Settings.'
                  )
                : t(
                    'workspace.chatPlaceholder',
                    'Ask anything about the papers in this workspace.'
                  )}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] break-words rounded-2xl px-3 py-2 text-xs ${
                    m.role === 'user'
                      ? 'whitespace-pre-wrap bg-accent text-white'
                      : 'bg-panel-2 text-foreground [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-background [&_pre]:p-2 [&_code]:rounded [&_code]:bg-background [&_code]:px-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_a]:text-accent [&_a]:underline [&_h1]:mb-1 [&_h1]:font-bold [&_h1]:text-sm [&_h2]:mb-1 [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted'
                  }`}
                >
                  {m.role === 'user'
                    ? m.content
                    : <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>{m.content}</ReactMarkdown>}
                </div>
              </div>
            ))}
            {(streaming || traceSteps.some((s) => s.kind !== 'run')) && (
              <AgentTracePanel steps={traceSteps} streaming={streaming} />
            )}
            {streamingText && (
              <div className="flex justify-start">
                <div className="max-w-[85%] break-words rounded-2xl bg-panel-2 px-3 py-2 text-xs text-foreground [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-background [&_pre]:p-2 [&_code]:rounded [&_code]:bg-background [&_code]:px-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_a]:text-accent [&_a]:underline [&_h1]:mb-1 [&_h1]:font-bold [&_h1]:text-sm [&_h2]:mb-1 [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted">
                  <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>{streamingText}</ReactMarkdown>
                </div>
              </div>
            )}
            {streaming && !streamingText && (
              <div className="flex justify-start">
                <span className="text-xs text-muted">
                  {t('workspace.chat.thinking', 'Thinking…')}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="shrink-0 px-3 pb-1">
          <div className="rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-error">{error}</div>
        </div>
      )}

      {modelSwitchHint && (
        <div className="shrink-0 px-3 pb-1">
          <div className="rounded-lg bg-panel-2 px-3 py-1.5 text-[11px] text-muted">
            {t(
              'workspace.chat.modelSwitchHint',
              'Model switched — applies to new messages only.'
            )}
          </div>
        </div>
      )}

      <div className="shrink-0 p-3">
        <div className="flex flex-col rounded-2xl border border-border bg-panel-2 shadow-sm focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
          {selectedAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1 px-2 pt-1">
              {selectedAttachments.map((docId) => {
                const doc = workspaceDocs.find((d) => d.docId === docId)
                return (
                  <span
                    key={docId}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-panel-2 px-2 py-0.5 text-[10px] text-foreground"
                  >
                    <span className="max-w-[120px] truncate">{doc?.title ?? docId.slice(0, 8)}</span>
                    <button
                      type="button"
                      className="text-muted hover:text-error"
                      onClick={() =>
                        setSelectedAttachments((prev) => prev.filter((id) => id !== docId))
                      }
                    >
                      ×
                    </button>
                  </span>
                )
              })}
            </div>
          )}
          <textarea
            className="max-h-40 min-h-[52px] w-full resize-none bg-transparent px-3 pt-3 text-sm text-foreground placeholder:text-muted focus:outline-none"
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t(
              'workspace.chat.inputPlaceholder',
              'Send a message… (Enter to send, Shift+Enter for newline)'
            )}
            disabled={providers.length === 0}
            aria-label={t('workspace.chat.inputPlaceholder', 'Send a message…')}
          />

          <div className="flex items-center gap-1 overflow-x-auto px-2 pb-2 pt-1">
            <div className="relative shrink-0" ref={attachMenuRef}>
              <button
                type="button"
                className={`sidebar-header-btn shrink-0 ${selectedAttachments.length > 0 ? 'text-accent' : ''}`}
                onClick={() => setAttachMenuOpen((v) => !v)}
                disabled={!activeWorkspaceId || streaming}
                title={t('workspace.chat.attachPapers', 'Attach papers')}
                aria-label={t('workspace.chat.attachPapers', 'Attach papers')}
              >
                <Paperclip className="h-4 w-4" />
                {selectedAttachments.length > 0 && (
                  <span className="ml-0.5 text-[10px] font-medium">{selectedAttachments.length}</span>
                )}
              </button>
              {attachMenuOpen && (
                <div className="absolute bottom-full left-0 z-50 mb-1 max-h-64 w-64 overflow-y-auto rounded-lg border border-border bg-panel shadow-lg">
                  {workspaceDocs.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-muted">
                      {t('workspace.chat.noWorkspaceDocs', 'No papers in workspace. Add papers to the board first.')}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-0.5 p-1">
                      {workspaceDocs.map((doc) => {
                        const checked = selectedAttachments.includes(doc.docId)
                        const maxReached = selectedAttachments.length >= 8 && !checked
                        return (
                          <label
                            key={doc.docId}
                            className={`flex items-center gap-2 rounded px-2 py-1 text-[11px] hover:bg-hover ${maxReached ? 'opacity-40' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={maxReached}
                              onChange={() => {
                                setSelectedAttachments((prev) =>
                                  checked
                                    ? prev.filter((id) => id !== doc.docId)
                                    : [...prev, doc.docId]
                                )
                              }}
                              className="h-3 w-3 shrink-0"
                            />
                            <span className="min-w-0 flex-1 truncate text-foreground">{doc.title}</span>
                          </label>
                        )
                      })}
                      {selectedAttachments.length >= 8 && (
                        <p className="px-2 py-1 text-[10px] text-muted">
                          {t('workspace.chat.attachMax', 'Maximum 8 attachments.')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted">
              {t('workspace.chat.workspaceScope', 'Workspace')}
            </span>

            <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1">
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  className="inline-flex max-w-[160px] items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-foreground hover:bg-hover disabled:opacity-40"
                  onClick={() => setModelMenuOpen((v) => !v)}
                  disabled={providers.length === 0 || streaming}
                  aria-label={t('workspace.chat.selectProvider', 'Select model / provider')}
                  aria-expanded={modelMenuOpen}
                  aria-haspopup="listbox"
                >
                  <span className="truncate font-medium">{displayModelLabel}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted" />
                </button>

                {modelMenuOpen && (
                  <div
                    className="absolute bottom-full right-0 z-50 mb-1 w-72 max-h-72 overflow-y-auto rounded-xl border border-border bg-panel p-2 shadow-lg"
                    role="listbox"
                  >
                    <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {t('workspace.chat.providerModels', 'Provider models')}
                    </p>
                    {providers.map((p) => (
                      <button
                        key={`p-${p.id}`}
                        type="button"
                        role="option"
                        aria-selected={p.id === activeProviderId}
                        className={`mb-0.5 flex w-full flex-col rounded-lg px-2 py-1.5 text-left hover:bg-hover ${
                          p.id === activeProviderId ? 'bg-active' : ''
                        }`}
                        onClick={() => {
                          const parsed = parseModelId(p.model)
                          void applyModel(
                            p.baseModel || parsed.baseModel || p.model,
                            p.variant || parsed.variant,
                            p.id
                          )
                        }}
                      >
                        <span className="truncate text-xs font-medium text-foreground">
                          {p.name}
                        </span>
                        <span className="truncate text-[10px] text-muted">{p.model}</span>
                      </button>
                    ))}

                    {providerModels.length > 0 && (
                      <>
                        <p className="mt-2 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          {t('workspace.chat.availableModels', 'Available models')}
                          {loadingModels ? '…' : ''}
                        </p>
                        {providerModels.slice(0, 40).map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            role="option"
                            className="mb-0.5 flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover"
                            onClick={() => void applyModel(m.id, '')}
                          >
                            <span className="truncate text-xs text-foreground">{m.id}</span>
                            {m.supportsVariants && (
                              <span className="shrink-0 text-[10px] text-accent">
                                {t('settings.aiProviders.hasVariants', 'variants')}
                              </span>
                            )}
                          </button>
                        ))}
                      </>
                    )}

                    {recentModels.length > 0 && (
                      <>
                        <p className="mt-2 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          {t('workspace.chat.recentModels', 'Recent')}
                        </p>
                        {recentModels.map((m) => {
                          const parsed = parseModelId(m)
                          return (
                            <button
                              key={`r-${m}`}
                              type="button"
                              role="option"
                              className="mb-0.5 flex w-full rounded-lg px-2 py-1.5 text-left text-xs text-foreground hover:bg-hover"
                              onClick={() =>
                                void applyModel(parsed.baseModel || m, parsed.variant)
                              }
                            >
                              <span className="truncate">{m}</span>
                            </button>
                          )
                        })}
                      </>
                    )}

                    <p className="mt-2 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {t('workspace.chat.customModel', 'Custom model')}
                    </p>
                    <div className="flex gap-1 px-1">
                      <input
                        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-accent focus:outline-none"
                        value={customModel}
                        onChange={(e) => setCustomModel(e.target.value)}
                        placeholder="model-id"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && customModel.trim()) {
                            e.preventDefault()
                            const parsed = parseModelId(customModel.trim())
                            void applyModel(parsed.baseModel, parsed.variant)
                            setCustomModel('')
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="rounded-md bg-accent px-2 py-1 text-[11px] text-white disabled:opacity-40"
                        disabled={!customModel.trim()}
                        onClick={() => {
                          const parsed = parseModelId(customModel.trim())
                          void applyModel(parsed.baseModel, parsed.variant)
                          setCustomModel('')
                        }}
                      >
                        {t('common.add', 'Add')}
                      </button>
                    </div>

                    {variantCapable && (
                      <>
                        <p className="mt-2 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          {t('workspace.chat.variant', 'Variant')}
                        </p>
                        <div className="flex flex-wrap gap-1 px-1 pb-1">
                          <button
                            type="button"
                            className={`rounded-md border px-2 py-0.5 text-[10px] ${
                              !selectedVariant
                                ? 'border-accent bg-accent/10 text-accent'
                                : 'border-border text-muted'
                            }`}
                            onClick={() => void applyModel(selectedModel, '')}
                          >
                            {t('settings.aiProviders.variantNone', 'None (base only)')}
                          </button>
                          {COMMON_VARIANTS.map((v) => (
                            <button
                              key={v}
                              type="button"
                              className={`rounded-md border px-2 py-0.5 text-[10px] ${
                                selectedVariant === v
                                  ? 'border-accent bg-accent/10 text-accent'
                                  : 'border-border text-muted'
                              }`}
                              onClick={() => void applyModel(selectedModel, v)}
                            >
                              {v}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] ${
                  deepThinking
                    ? 'bg-accent/15 text-accent'
                    : 'text-muted hover:bg-hover hover:text-foreground'
                } disabled:opacity-40`}
                onClick={() => setDeepThinking((v) => !v)}
                disabled={providers.length === 0 || streaming}
                aria-pressed={deepThinking}
                title={t('workspace.chat.deepThinking', 'Deep thinking')}
                aria-label={t('workspace.chat.deepThinking', 'Deep thinking')}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {deepThinking
                  ? t('workspace.chat.featureOn', 'On')
                  : t('workspace.chat.featureOff', 'Off')}
              </button>

              {streaming ? (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="inline-flex shrink-0 items-center justify-center rounded-lg bg-error p-1.5 text-white hover:bg-error/90"
                  aria-label={t('workspace.chat.stop', 'Stop')}
                  title={t('workspace.chat.stop', 'Stop')}
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!canSend}
                  className="inline-flex shrink-0 items-center justify-center rounded-lg bg-accent p-1.5 text-white disabled:opacity-40"
                  aria-label={t('workspace.chat.send', 'Send')}
                  title={t('workspace.chat.send', 'Send')}
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
