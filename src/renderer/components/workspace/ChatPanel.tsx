import { useState, useEffect, useRef, useCallback, useMemo, memo, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  Send,
  Square,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Paperclip,
  Sparkles,
  Wrench,
  Bot,
  Activity,
  MessageSquare,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Search,
  FileText,
  FileSearch,
  FilePlus,
  ClipboardList,
  FolderOpen,
  RotateCcw,
  X,
  ArrowDown
} from 'lucide-react'
import { api } from '../../ipc'
import { errorMessage } from '../../../shared/ipc-types'
import type {
  AgentTraceStep,
  AiProvider,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatMessage,
  ChatReasoningEvent,
  ChatTokenEvent,
  ChatTraceEvent,
  ChatTitleUpdatedEvent,
  ProviderModelInfo
} from '../../../shared/ipc-types'
import {
  COMMON_VARIANTS,
  composeModelId,
  parseModelId,
  supportsModelVariants
} from '../../../shared/modelVariant'
import { resolveDeepThinkingMode } from '../../../shared/deepThinking'
import { useWorkspaceStore } from '../../store/workspaceStore'
import ReactMarkdown, { type Components, defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

const REMARK_PLUGINS = [remarkGfm, remarkMath]
const REHYPE_PLUGINS = [rehypeKatex]

function urlTransform(url: string): string {
  if (url.startsWith('refora://')) return url
  return defaultUrlTransform(url)
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function parseReforaDocLink(href: string): { docId: string; query?: string } | null {
  if (!href) return null
  const match = href.match(/^refora:\/\/doc\/([^?]+)(?:\?(.*))?$/)
  if (!match) return null
  return {
    docId: safeDecode(match[1]),
    query: match[2] ? safeDecode(match[2]) : undefined
  }
}

async function openCitationDoc(docId: string): Promise<boolean> {
  try {
    await api.documents.openPdf(docId)
    return true
  } catch {
    return false
  }
}

const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => {
    if (href) {
      const parsed = parseReforaDocLink(href)
      if (parsed) {
        return (
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-accent underline hover:opacity-80"
            onClick={async () => {
              const ok = await openCitationDoc(parsed.docId)
              if (!ok) window.alert('Failed to open document. It may have been moved or deleted.')
            }}
            title={parsed.query ?? undefined}
          >
            {children}
          </button>
        )
      }
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  }
}

const StreamingMarkdown = memo(function StreamingMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS} urlTransform={urlTransform}>{content}</ReactMarkdown>
  )
})

const RECENT_MODELS_KEY = 'chatRecentModels'
const MAX_RECENT = 8

type RecentModelEntry = { model: string; providerId: string }

const MAX_INPUT_LENGTH = 32000

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

async function loadRecentModels(): Promise<RecentModelEntry[]> {
  try {
    const raw = await api.settings.get<string>(RECENT_MODELS_KEY, '[]')
    const parsed = JSON.parse(typeof raw === 'string' ? raw : '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x): x is RecentModelEntry =>
        typeof x === 'object' && x !== null &&
        typeof (x as Record<string, unknown>).model === 'string' &&
        typeof (x as Record<string, unknown>).providerId === 'string'
      )
      .slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

async function pushRecentModel(model: string, providerId: string): Promise<void> {
  const id = model.trim()
  if (!id || !providerId) return
  const prev = await loadRecentModels()
  const next = [{ model: id, providerId }, ...prev.filter((m) => m.model !== id)].slice(0, MAX_RECENT)
  await api.settings.set(RECENT_MODELS_KEY, JSON.stringify(next))
}

function mergeTraceStep(prev: AgentTraceStep[], step: AgentTraceStep): AgentTraceStep[] {
  const idx = prev.findIndex((s) => s.id === step.id)
  if (idx === -1) {
    return [...prev, step].sort((a, b) => a.seq - b.seq)
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

type TFunc = ReturnType<typeof useTranslation>['t']

interface ToolLabelResult {
  icon: string
  text: string
}

function formatToolLabel(
  step: AgentTraceStep,
  t: TFunc
): ToolLabelResult | null {
  if (step.kind !== 'tool' || !step.name) return null
  const name = step.name

  let parsed: Record<string, unknown> | string | null = null
  if (step.input) {
    try {
      parsed = JSON.parse(step.input)
    } catch {
      parsed = step.input
    }
  }

  const objParam = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}

  switch (name) {
    case 'search_workspace_docs':
      return { icon: 'search', text: t('workspace.chat.toolSearchWorkspace', 'Searching workspace…') }
    case 'search_library':
      return { icon: 'search', text: t('workspace.chat.toolSearchLibrary', 'Searching library…') }
    case 'read_paper_fulltext': {
      const docId = typeof objParam.docId === 'string' ? objParam.docId : ''
      const offset = typeof objParam.offset === 'number' ? objParam.offset : 0
      const limit = typeof objParam.limit === 'number' ? objParam.limit : 8000
      const chunkIdx = Math.floor(offset / limit) + 1
      if (docId) {
        return {
          icon: 'read',
          text: t('workspace.chat.toolReadingChunk', {
            chunk: chunkIdx,
            defaultValue: 'Reading document… (chunk {{chunk}})'
          })
        }
      }
      return { icon: 'read', text: t('workspace.chat.toolReading', 'Reading document…') }
    }
    case 'get_paper_summary':
      return { icon: 'summary', text: t('workspace.chat.toolGetSummary', 'Getting summary…') }
    case 'get_paper_metadata':
      return { icon: 'metadata', text: t('workspace.chat.toolGetMetadata', 'Fetching metadata…') }
    case 'open_paper':
      return { icon: 'open', text: t('workspace.chat.toolOpenPaper', 'Opening paper…') }
    case 'generate_report':
      return { icon: 'report', text: t('workspace.chat.toolGenerateReport', 'Generating report…') }
    case 'add_docs_to_workspace':
      return { icon: 'add', text: t('workspace.chat.toolAddDocs', 'Adding to workspace…') }
    case 'request_summary':
      return { icon: 'summary', text: t('workspace.chat.toolRequestSummary', 'Requesting summary…') }
    default:
      return null
  }
}

const TOOL_ICONS: Record<string, typeof Search> = {
  search: Search,
  read: FileText,
  summary: FileSearch,
  metadata: FileSearch,
  open: FolderOpen,
  report: ClipboardList,
  add: FilePlus
}

function TraceStepRow({ step, isLast }: { step: AgentTraceStep; isLast: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const hasBody = !!(step.input || step.output)
  const duration = formatDuration(step)
  const toolLabel = formatToolLabel(step, t)

  const StatusIcon = step.status === 'running' ? Loader2 : step.status === 'error' ? XCircle : CheckCircle2
  const statusColor =
    step.status === 'running'
      ? 'text-accent'
      : step.status === 'error'
        ? 'text-error'
        : 'text-muted'
  const statusTitle =
    step.status === 'running'
      ? t('workspace.chat.traceRunning', 'Running')
      : step.status === 'error'
        ? t('workspace.chat.traceError', 'Error')
        : t('workspace.chat.traceDone', 'Done')

  const KindIcon = step.kind === 'tool'
    ? (toolLabel ? (TOOL_ICONS[toolLabel.icon] ?? Wrench) : Wrench)
    : step.kind === 'llm'
      ? Bot
      : Activity

  const displayText = toolLabel
    ? toolLabel.text
    : step.kind === 'llm'
      ? t('workspace.chat.traceLlmCall', 'Model thinking…')
      : step.name ?? t('workspace.chat.traceTool', 'Tool')

  return (
    <div className="trace-fade-in relative flex gap-2 pl-0.5">
      <div className="flex flex-col items-center">
        <StatusIcon
          className={`h-3.5 w-3.5 shrink-0 ${statusColor} ${step.status === 'running' ? 'animate-spin' : ''}`}
        />
        {!isLast && <div className="mt-0.5 w-px flex-1 bg-border/50" />}
      </div>
      <div className={`min-w-0 flex-1 ${isLast ? 'pb-0' : 'pb-2'}`}>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 py-0.5 text-left"
          onClick={() => hasBody && setOpen((v) => !v)}
          disabled={!hasBody}
          aria-expanded={open}
          title={statusTitle}
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
          <KindIcon className="h-3 w-3 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
            <span className="font-medium">{displayText}</span>
          </span>
          {step.kind === 'llm' && step.totalTokens != null && (
            <span
              className="shrink-0 text-[10px] text-muted"
              title={t('workspace.chat.tokenUsage', 'Tokens')}
            >
              ↑{step.inputTokens ?? 0} ↓{step.outputTokens ?? 0}
            </span>
          )}
          {duration && <span className="shrink-0 text-[10px] text-muted">{duration}</span>}
        </button>
        {open && hasBody && (
          <div className="mt-1 space-y-1.5 pl-1">
            {step.input && (
              <div>
                <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                  {t('workspace.chat.traceInput', 'Input')}
                </p>
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-panel-2 px-1.5 py-1 text-[10px] text-foreground">
                  {step.input}
                </pre>
              </div>
            )}
            {step.output && (
              <div>
                <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                  {t('workspace.chat.traceOutput', 'Output')}
                </p>
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-panel-2 px-1.5 py-1 text-[10px] text-foreground">
                  {step.output}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
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
  const [open, setOpen] = useState(false)
  const visible = steps.filter((s) => s.kind !== 'run')
  const totalTokensSum = visible.reduce((sum, s) => sum + (s.totalTokens ?? 0), 0)
  const hasTokenData = visible.some((s) => s.totalTokens != null)
  const isRunning = visible.some((s) => s.status === 'running')
  const hasError = visible.some((s) => s.status === 'error')

  const totalDuration = useMemo(() => {
    const runStep = steps.find((s) => s.kind === 'run')
    if (runStep?.endedAt != null) return runStep.endedAt - runStep.startedAt
    const ended = visible.filter((s) => s.endedAt != null)
    if (ended.length === 0) return null
    const minStart = Math.min(...visible.map((s) => s.startedAt))
    const maxEnd = Math.max(...ended.map((s) => s.endedAt!))
    return maxEnd - minStart
  }, [steps, visible])

  if (visible.length === 0 && !streaming) return null

  const SummaryIcon = isRunning ? Loader2 : hasError ? XCircle : CheckCircle2
  const summaryColor = isRunning ? 'text-accent' : hasError ? 'text-error' : 'text-muted'
  const summaryLabel = isRunning
    ? t('workspace.chat.traceRunningLabel', 'running…')
    : totalDuration != null
      ? `${(totalDuration / 1000).toFixed(1)}s`
      : null

  return (
    <div className="rounded-xl border border-border bg-panel-2/80">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <SummaryIcon
          className={`h-3.5 w-3.5 shrink-0 ${summaryColor} ${isRunning ? 'animate-spin' : ''}`}
        />
        <span className="text-[11px] font-medium text-foreground">
          {t('workspace.chat.trace', 'Agent steps')}
        </span>
        <span className="text-[10px] text-muted">
          {visible.length > 0 ? visible.length : streaming ? '…' : 0}
        </span>
        {summaryLabel && (
          <span className="text-[10px] text-muted">· {summaryLabel}</span>
        )}
        {hasTokenData && !isRunning && (
          <span className="text-[10px] text-muted">
            · {t('workspace.chat.tokenTotal', { count: totalTokensSum, defaultValue: 'Total: {{count}} tokens' })}
          </span>
        )}
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-0 px-2.5 pb-2 pt-0.5">
          {visible.length === 0 ? (
            <p className="px-1 py-1 text-[11px] text-muted">
              {t('workspace.chat.traceEmpty', 'No tool or model steps yet.')}
            </p>
          ) : (
            visible.map((step, i) => (
              <TraceStepRow
                key={step.id}
                step={step}
                isLast={i === visible.length - 1}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="shrink-0 rounded p-1 text-muted opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
      title="Copy"
      aria-label="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

export default function ChatPanel() {
  const { t } = useTranslation()
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const activeThreadId = useWorkspaceStore((s) => s.activeThreadId)
  const setActiveThreadId = useWorkspaceStore((s) => s.setActiveThreadId)
  const setChatStreaming = useWorkspaceStore((s) => s.setChatStreaming)
  const startNewChat = useWorkspaceStore((s) => s.startNewChat)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [traceSteps, setTraceSteps] = useState<AgentTraceStep[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [streamingReasoning, setStreamingReasoning] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [activeProviderId, setActiveProviderId] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedVariant, setSelectedVariant] = useState('')
  const [deepThinking, setDeepThinking] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [providerModels, setProviderModels] = useState<ProviderModelInfo[]>([])
  const [recentModels, setRecentModels] = useState<RecentModelEntry[]>([])
  const [customModel, setCustomModel] = useState('')
  const [modelSwitchHint, setModelSwitchHint] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [inputAreaHeight, setInputAreaHeight] = useState(0)
  const [loadingHistory, setLoadingHistory] = useState(false)

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const attachMenuRef = useRef<HTMLDivElement | null>(null)
  const inputAreaRef = useRef<HTMLDivElement | null>(null)
  const hadMessagesRef = useRef(false)
  const isSendingRef = useRef(false)
  const lastSendRef = useRef<{ text: string; attachments: string[]; threadId: string | null } | null>(null)
  const stickToBottomRef = useRef(true)
  const streamingTextRef = useRef('')
  const streamingReasoningRef = useRef('')
  const cancelledRef = useRef(false)
  const rafIdRef = useRef<number | null>(null)

  const activeProvider = providers.find((p) => p.id === activeProviderId) ?? null

  const requestModel = useMemo(() => {
    if (!selectedModel) return ''
    const format = activeProvider?.variantFormat ?? 'dash'
    return composeModelId(selectedModel, selectedVariant, format)
  }, [selectedModel, selectedVariant, activeProvider?.variantFormat])

  const thinkingMode = useMemo(
    () =>
      deepThinking
        ? resolveDeepThinkingMode(requestModel || selectedModel)
        : 'none',
    [deepThinking, requestModel, selectedModel]
  )

  const loadProviders = useCallback(async () => {
    try {
      const [list, active, recent, savedModel, savedVariant, savedDeep] = await Promise.all([
        api.aiProviders.list(),
        api.settings.get<string>('activeProviderId', ''),
        loadRecentModels(),
        api.settings.get<string>('chatSelectedModel', ''),
        api.settings.get<string>('chatSelectedVariant', ''),
        api.settings.get<boolean>('chatDeepThinking', false)
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
      if (savedModel) setSelectedModel(savedModel)
      if (savedVariant) setSelectedVariant(savedVariant)
      setDeepThinking(savedDeep)
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
    if (!isSendingRef.current) {
      streamingTextRef.current = ''
      streamingReasoningRef.current = ''
      setStreamingText('')
      setStreamingReasoning('')
      setStreaming(false)
      setError(null)
    }
    setSelectedAttachments([])
    stickToBottomRef.current = true
    if (!activeThreadId) {
      setMessages([])
      setTraceSteps([])
      hadMessagesRef.current = false
      setLoadingHistory(false)
      return
    }
    let cancelled = false
    if (!isSendingRef.current) setLoadingHistory(true)
    void Promise.all([
      api.ai.chatHistory(activeThreadId),
      api.ai.chatTraces(activeThreadId)
    ])
      .then(([history, traces]) => {
        if (cancelled || threadIdRef.current !== activeThreadId) return
        setMessages(history)
        setTraceSteps(traces)
        hadMessagesRef.current = history.length > 0
        setLoadingHistory(false)
      })
      .catch(() => {
        if (cancelled) return
        setMessages([])
        setTraceSteps([])
        setLoadingHistory(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeThreadId])

  const scheduleStreamingFlush = useCallback(() => {
    if (rafIdRef.current != null) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      setStreamingText(streamingTextRef.current)
      setStreamingReasoning(streamingReasoningRef.current)
    })
  }, [])

  const chatHandlersRef = useRef<{
    onToken: (payload: ChatTokenEvent) => void
    onReasoning: (payload: ChatReasoningEvent) => void
    onDone: (payload: ChatDoneEvent) => void
    onError: (payload: ChatErrorEvent) => void
    onTrace: (payload: ChatTraceEvent) => void
    onTitleUpdated: (payload: ChatTitleUpdatedEvent) => void
  } | null>(null)

  if (!chatHandlersRef.current) {
    chatHandlersRef.current = {
      onToken: (payload: ChatTokenEvent) => {
        if (payload.threadId !== threadIdRef.current) return
        streamingTextRef.current += payload.token
        scheduleStreamingFlush()
      },
      onReasoning: (payload: ChatReasoningEvent) => {
        if (payload.threadId !== threadIdRef.current) return
        streamingReasoningRef.current += payload.token
        scheduleStreamingFlush()
      },
      onDone: (payload: ChatDoneEvent) => {
        if (payload.threadId !== threadIdRef.current) return
        const isCancellationMsg =
          payload.finalText.includes('[Response cancelled by user]') ||
          payload.finalText.includes('[Response interrupted')
        if (isCancellationMsg && cancelledRef.current) {
          cancelledRef.current = false
          if (isSendingRef.current) {
            return
          }
          if (rafIdRef.current != null) {
            cancelAnimationFrame(rafIdRef.current)
            rafIdRef.current = null
          }
          isSendingRef.current = false
          lastSendRef.current = null
          streamingTextRef.current = ''
          streamingReasoningRef.current = ''
          setStreamingText('')
          setStreamingReasoning('')
          setStreaming(false)
          return
        }
        cancelledRef.current = false
        if (rafIdRef.current != null) {
          cancelAnimationFrame(rafIdRef.current)
          rafIdRef.current = null
        }
        isSendingRef.current = false
        lastSendRef.current = null
        setMessages((prev) => [
          ...prev,
          localMessage(payload.threadId, 'assistant', payload.finalText)
        ])
        streamingTextRef.current = ''
        streamingReasoningRef.current = ''
        setStreamingText('')
        setStreamingReasoning('')
        setStreaming(false)
      },
      onError: (payload: ChatErrorEvent) => {
        if (payload.threadId !== threadIdRef.current) return
        if (rafIdRef.current != null) {
          cancelAnimationFrame(rafIdRef.current)
          rafIdRef.current = null
        }
        isSendingRef.current = false
        lastSendRef.current = null
        setError(payload.message)
        streamingTextRef.current = ''
        streamingReasoningRef.current = ''
        setStreamingText('')
        setStreamingReasoning('')
        setStreaming(false)
      },
      onTrace: (payload: ChatTraceEvent) => {
        if (payload.threadId !== threadIdRef.current) return
        setTraceSteps((prev) => mergeTraceStep(prev, payload.step))
      },
      onTitleUpdated: (payload: ChatTitleUpdatedEvent) => {
        useWorkspaceStore.setState((s) => ({
          threads: s.threads.map((t) =>
            t.id === payload.threadId ? { ...t, title: payload.title } : t
          )
        }))
      }
    }
  }

  useEffect(() => {
    const h = chatHandlersRef.current!
    api.events.onAiChatToken(h.onToken)
    api.events.onAiChatReasoning(h.onReasoning)
    api.events.onAiChatDone(h.onDone)
    api.events.onAiChatError(h.onError)
    api.events.onAiChatTrace(h.onTrace)
    api.events.onAiChatTitleUpdated(h.onTitleUpdated)
    return () => {
      api.events.off('ai:chat:token', h.onToken)
      api.events.off('ai:chat:reasoning', h.onReasoning)
      api.events.off('ai:chat:done', h.onDone)
      api.events.off('ai:chat:error', h.onError)
      api.events.off('ai:chat:trace', h.onTrace)
      api.events.off('ai:chat:titleUpdated', h.onTitleUpdated)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
    }
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages, streamingText, streamingReasoning, traceSteps])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
      stickToBottomRef.current = atBottom
      setShowScrollBtn(!atBottom && messages.length > 0)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [messages.length])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  useEffect(() => {
    const onShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        const el = textareaRef.current
        if (!streaming && el) {
          e.preventDefault()
          el.focus()
        }
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [streaming])

  useEffect(() => {
    const el = inputAreaRef.current
    if (!el) return
    const update = () => setInputAreaHeight(el.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    setChatStreaming(streaming)
  }, [streaming, setChatStreaming])

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
      void api.settings.set('chatSelectedModel', baseModel)
      void api.settings.set('chatSelectedVariant', variant)
      if (hadMessagesRef.current || messages.length > 0) {
        setModelSwitchHint(true)
        window.setTimeout(() => setModelSwitchHint(false), 3500)
      }
      const p = providers.find((x) => x.id === nextProviderId)
      const format = p?.variantFormat ?? 'dash'
      const full = composeModelId(baseModel, variant, format)
      if (full) {
        try {
          await pushRecentModel(full, nextProviderId)
          setRecentModels(await loadRecentModels())
        } catch (e) {
          setError(errorMessage(e, 'Failed to update model'))
        }
      }
      setModelMenuOpen(false)
    },
    [activeProviderId, messages.length, providers]
  )

  const sendText = useCallback(async (text: string, attachments: string[], existingThread: string | null) => {
    if (isSendingRef.current) return
    if (!activeWorkspaceId || !activeProviderId || !text.trim() || streaming) return
    cancelledRef.current = false
    if (text.length > MAX_INPUT_LENGTH) {
      setError(t('workspace.chat.inputTooLong', 'Message is too long. Please shorten it.'))
      return
    }
    setMessages((prev) => [...prev, localMessage(existingThread ?? '', 'user', text)])
    setStreaming(true)
    isSendingRef.current = true
    streamingTextRef.current = ''
    streamingReasoningRef.current = ''
    setStreamingText('')
    setStreamingReasoning('')
    setError(null)
    hadMessagesRef.current = true
    stickToBottomRef.current = true
    lastSendRef.current = { text, attachments: [...attachments], threadId: existingThread }
    try {
      const model = requestModel || undefined
      if (model) void pushRecentModel(model, activeProviderId)
      const { threadId } = await api.ai.chatSend({
        workspaceId: activeWorkspaceId,
        threadId: existingThread ?? undefined,
        text,
        providerId: activeProviderId,
        model,
        features: { deepThinking },
        attachments: attachments.length > 0
          ? attachments.map((docId) => ({ type: 'document' as const, docId }))
          : undefined
      })
      if (lastSendRef.current) {
        lastSendRef.current = { ...lastSendRef.current, threadId }
      }
      if (!existingThread) {
        setActiveThreadId(threadId)
        threadIdRef.current = threadId
      }
      void fetchThreads()
    } catch (e) {
      setError(errorMessage(e, 'Failed to send message'))
      isSendingRef.current = false
      setStreaming(false)
      setStreamingText('')
      setStreamingReasoning('')
    }
  }, [
    activeWorkspaceId,
    activeProviderId,
    streaming,
    setActiveThreadId,
    requestModel,
    deepThinking,
    fetchThreads,
    t
  ])

  const handleSend = useCallback(() => {
    if (!input.trim() || streaming) return
    const text = input.trim()
    const atts = [...selectedAttachments]
    setInput('')
    setSelectedAttachments([])
    setAttachMenuOpen(false)
    void sendText(text, atts, activeThreadId)
  }, [input, streaming, selectedAttachments, activeThreadId, sendText])

  const handleRetry = useCallback(() => {
    const last = lastSendRef.current
    if (!last) return
    setMessages((prev) => {
      const idx = prev.findLastIndex((m) => m.role === 'user' && m.content === last.text)
      if (idx === -1) return prev
      return prev.filter((_, i) => i !== idx)
    })
    void sendText(last.text, last.attachments, last.threadId)
  }, [sendText])

  const handleCancel = useCallback(() => {
    if (!threadIdRef.current) return
    void api.ai.chatCancel(threadIdRef.current)
    cancelledRef.current = true
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    isSendingRef.current = false
    setStreaming(false)
    streamingTextRef.current = ''
    streamingReasoningRef.current = ''
    setStreamingText('')
    setStreamingReasoning('')
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const displayMessages = useMemo(() => messages.filter((m) => m.role !== 'tool'), [messages])
  const showEmpty = displayMessages.length === 0 && !streamingText && !streamingReasoning
  const canSend = !!activeWorkspaceId && !!activeProviderId && !!input.trim() && !streaming
  const customModelTrimmed = customModel.trim()
  const customModelInvalid = !customModelTrimmed || /\s/.test(customModelTrimmed)
  const variantCapable =
    supportsModelVariants(selectedModel) ||
    providerModels.some((m) => m.id === selectedModel && m.supportsVariants)

  const displayModelLabel = providers.length === 0
    ? t('workspace.chat.notConfigured', 'Not configured')
    : requestModel || t('workspace.chat.selectProvider', 'Select model / provider')

  const runTraceGroups = useMemo(() => {
    const sorted = [...traceSteps].sort((a, b) => a.seq - b.seq)
    const order: string[] = []
    const map = new Map<string, AgentTraceStep[]>()
    for (const s of sorted) {
      if (!map.has(s.runId)) {
        map.set(s.runId, [])
        order.push(s.runId)
      }
      map.get(s.runId)!.push(s)
    }
    return { order, map }
  }, [traceSteps])

  const assistantRunForIdx = useMemo(() => {
    const result: (string | null)[] = new Array(displayMessages.length).fill(null)
    let assistantCount = 0
    for (let i = 0; i < displayMessages.length; i++) {
      if (displayMessages[i].role === 'assistant') {
        result[i] = runTraceGroups.order[assistantCount] ?? null
        assistantCount++
      }
    }
    return result
  }, [displayMessages, runTraceGroups])

  const streamingSteps = useMemo(() => {
    const assigned = new Set<string>()
    for (const rid of assistantRunForIdx) {
      if (rid) assigned.add(rid)
    }
    return traceSteps.filter((s) => !assigned.has(s.runId))
  }, [traceSteps, assistantRunForIdx])

  const lastAssistantIdx = (() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      if (displayMessages[i].role === 'assistant') return i
    }
    return -1
  })()

  const handleRegenerate = useCallback(() => {
    let text = ''
    let attachments: string[] = []
    let threadId = activeThreadId
    if (lastSendRef.current) {
      text = lastSendRef.current.text
      attachments = lastSendRef.current.attachments
      threadId = lastSendRef.current.threadId ?? activeThreadId
    } else {
      for (let i = displayMessages.length - 1; i >= 0; i--) {
        if (displayMessages[i].role === 'user') {
          text = displayMessages[i].content
          break
        }
      }
    }
    if (!text.trim()) return
    const runSteps = traceSteps
      .filter((s) => s.kind === 'run')
      .slice()
      .sort((a, b) => a.seq - b.seq)
    const lastRunId = runSteps.length > 0 ? runSteps[runSteps.length - 1].runId : null
    setMessages((prev) => {
      let lastUserIdx = -1
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === 'user') {
          lastUserIdx = i
          break
        }
      }
      if (lastUserIdx === -1) return prev
      return prev.slice(0, lastUserIdx)
    })
    if (lastRunId) {
      setTraceSteps((prev) => prev.filter((s) => s.runId !== lastRunId))
    }
    void sendText(text, attachments, threadId)
  }, [displayMessages, activeThreadId, traceSteps, sendText])

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background">
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
                        if (!window.confirm(t('workspace.chat.confirmDelete', 'Delete this conversation?'))) return
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
        {loadingHistory ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted" />
          </div>
        ) : showEmpty ? (
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
            {displayMessages.map((m, idx) => {
              const runId = assistantRunForIdx[idx]
              const runSteps = runId ? (runTraceGroups.map.get(runId) ?? []) : []
              const showTraceHere = runSteps.length > 0
              const isCancelled =
                m.role === 'assistant' &&
                (m.content.includes('[Response cancelled by user]') ||
                  m.content.includes('[Response interrupted'))
              const showRegenerate =
                m.role === 'assistant' && idx === lastAssistantIdx && !streaming
              return (
                <Fragment key={m.id}>
                  <div
                    className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] break-words rounded-2xl px-3 py-2 text-xs ${
                        m.role === 'user'
                          ? 'whitespace-pre-wrap bg-accent text-white'
                          : 'group bg-panel-2 text-foreground [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-background [&_pre]:p-2 [&_code]:rounded [&_code]:bg-background [&_code]:px-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_a]:text-accent [&_a]:underline [&_h1]:mb-1 [&_h1]:font-bold [&_h1]:text-sm [&_h2]:mb-1 [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted'
                      }`}
                    >
                      {m.role === 'user'
                        ? m.content
                        : (
                          <>
                            {isCancelled ? (
                              <span className="italic text-muted">{m.content}</span>
                            ) : (
                              <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS} urlTransform={urlTransform}>{m.content}</ReactMarkdown>
                            )}
                            <div className="mt-1 flex justify-end gap-0.5">
                              <CopyButton text={m.content} />
                              {showRegenerate && (
                                <button
                                  type="button"
                                  className="shrink-0 rounded p-1 text-muted opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                                  onClick={() => void handleRegenerate()}
                                  title={t('workspace.chat.regenerate', 'Regenerate')}
                                  aria-label={t('workspace.chat.regenerate', 'Regenerate')}
                                >
                                  <RotateCcw className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </>
                        )}
                    </div>
                  </div>
                  {showTraceHere && (
                    <AgentTracePanel steps={runSteps} streaming={false} />
                  )}
                </Fragment>
              )
            })}
            {streaming && (
              <AgentTracePanel steps={streamingSteps} streaming={streaming} />
            )}
            {streamingReasoning && (
              <div className="flex justify-start">
                <details className="max-w-[85%] rounded-2xl bg-panel-2 px-3 py-2 text-xs" open>
                  <summary className="cursor-pointer select-none font-medium text-muted">
                    {t('workspace.chat.reasoning', 'Reasoning')}
                  </summary>
                  <div className="mt-1 text-muted [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-background [&_pre]:p-2 [&_code]:rounded [&_code]:bg-background [&_code]:px-1">
                    <StreamingMarkdown content={streamingReasoning} />
                  </div>
                </details>
              </div>
            )}
            {streamingText && (
              <div className="flex justify-start">
                <div className="max-w-[85%] break-words rounded-2xl bg-panel-2 px-3 py-2 text-xs text-foreground [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-background [&_pre]:p-2 [&_code]:rounded [&_code]:bg-background [&_code]:px-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_a]:text-accent [&_a]:underline [&_h1]:mb-1 [&_h1]:font-bold [&_h1]:text-sm [&_h2]:mb-1 [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted">
                  <StreamingMarkdown content={streamingText} />
                </div>
              </div>
            )}
            {streaming && !streamingText && !streamingReasoning && (
              <div className="flex justify-start">
                <span className="text-xs text-muted">
                  {t('workspace.chat.thinking', 'Thinking…')}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {showScrollBtn && (
        <button
          type="button"
          className="absolute left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-panel p-1.5 shadow-lg hover:bg-hover"
          style={{ bottom: inputAreaHeight > 0 ? inputAreaHeight + 8 : 80 }}
          onClick={() => {
            const el = scrollRef.current
            if (el) {
              el.scrollTop = el.scrollHeight
              stickToBottomRef.current = true
              setShowScrollBtn(false)
            }
          }}
          aria-label={t('workspace.chat.scrollToBottom', 'Scroll to bottom')}
          title={t('workspace.chat.scrollToBottom', 'Scroll to bottom')}
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      )}

      {error && (
        <div className="shrink-0 px-3 pb-1">
          <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-error">
            <span className="min-w-0 flex-1 break-words">{error}</span>
            {lastSendRef.current && !streaming && (
              <button
                type="button"
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium hover:bg-red-500/20"
                onClick={() => void handleRetry()}
                title={t('workspace.chat.retry', 'Retry')}
                aria-label={t('workspace.chat.retry', 'Retry')}
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              className="shrink-0 rounded px-1 py-0.5 hover:bg-red-500/20"
              onClick={() => setError(null)}
              title={t('common.dismiss', 'Dismiss')}
              aria-label={t('common.dismiss', 'Dismiss')}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
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

      <div ref={inputAreaRef} className="shrink-0 p-3">
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
            ref={textareaRef}
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
          {input.length > MAX_INPUT_LENGTH * 0.8 && (
            <div className="flex justify-end px-3 pt-0.5">
              <span
                className={`text-[10px] ${
                  input.length > MAX_INPUT_LENGTH ? 'text-error' : 'text-muted'
                }`}
              >
                {Math.max(0, MAX_INPUT_LENGTH - input.length)}{' '}
                {t('workspace.chat.charsRemaining', 'chars left')}
              </span>
            </div>
          )}

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
                            aria-selected={m.id === selectedModel}
                            className="mb-0.5 flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover"
                            onClick={() => void applyModel(m.id, '')}
                          >
                            <span className="min-w-0 flex-1 truncate text-xs text-foreground">{m.id}</span>
                            <span className="flex shrink-0 items-center gap-1">
                              {m.supportsVariants && (
                                <span className="text-[10px] text-accent">
                                  {t('settings.aiProviders.hasVariants', 'variants')}
                                </span>
                              )}
                              {m.id === selectedModel && <Check className="h-3 w-3 text-accent" />}
                            </span>
                          </button>
                        ))}
                      </>
                    )}

                    {recentModels.length > 0 && (
                      <>
                        <p className="mt-2 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          {t('workspace.chat.recentModels', 'Recent')}
                        </p>
                        {recentModels.map((entry) => {
                          const parsed = parseModelId(entry.model)
                          const providerName = providers.find((p) => p.id === entry.providerId)?.name
                          return (
                            <button
                              key={`r-${entry.model}`}
                              type="button"
                              role="option"
                              className="mb-0.5 flex w-full flex-col rounded-lg px-2 py-1.5 text-left text-xs text-foreground hover:bg-hover"
                              onClick={() =>
                                void applyModel(parsed.baseModel || entry.model, parsed.variant, entry.providerId)
                              }
                            >
                              <span className="truncate">{entry.model}</span>
                              {providerName && (
                                <span className="truncate text-[10px] text-muted">{providerName}</span>
                              )}
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
                          if (e.key === 'Enter' && !customModelInvalid) {
                            e.preventDefault()
                            const parsed = parseModelId(customModelTrimmed)
                            void applyModel(parsed.baseModel, parsed.variant)
                            setCustomModel('')
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="rounded-md bg-accent px-2 py-1 text-[11px] text-white disabled:opacity-40"
                        disabled={customModelInvalid}
                        onClick={() => {
                          const parsed = parseModelId(customModelTrimmed)
                          void applyModel(parsed.baseModel, parsed.variant)
                          setCustomModel('')
                        }}
                      >
                        {t('common.add', 'Add')}
                      </button>
                    </div>
                    {customModel && customModelInvalid && (
                      <p className="px-1 pt-1 text-[10px] text-muted">
                        {t('workspace.chat.customModelHint', 'Model ID cannot contain spaces.')}
                      </p>
                    )}

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
                onClick={() => {
                  setDeepThinking((v) => {
                    const next = !v
                    void api.settings.set('chatDeepThinking', next)
                    return next
                  })
                }}
                disabled={providers.length === 0 || streaming}
                aria-pressed={deepThinking}
                title={
                  deepThinking && thinkingMode === 'native'
                    ? t('workspace.chat.deepThinkingNative', 'Native reasoning (model-powered)')
                    : deepThinking && thinkingMode === 'prompt'
                      ? t('workspace.chat.deepThinkingPrompt', 'Prompt-enhanced (compatibility mode)')
                      : t('workspace.chat.deepThinking', 'Deep thinking')
                }
                aria-label={
                  deepThinking && thinkingMode === 'native'
                    ? t('workspace.chat.deepThinkingNative', 'Native reasoning (model-powered)')
                    : deepThinking && thinkingMode === 'prompt'
                      ? t('workspace.chat.deepThinkingPrompt', 'Prompt-enhanced (compatibility mode)')
                      : t('workspace.chat.deepThinking', 'Deep thinking')
                }
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
