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
  Download,
  Paperclip,
  Pencil,
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
  ArrowDown,
  ArrowUp,
  ThumbsUp,
  ThumbsDown
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
import { useDocumentStore } from '../../store/documentStore'
import { useConfirmStore } from '../../store/confirmStore'
import { useClickOutside } from '../../hooks/useClickOutside'
import { Button as UiButton, Input as UiInput } from '../ui'
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
            className="inline-flex items-center gap-0.5 text-accent underline transition-opacity duration-150 hover:opacity-80"
            onClick={async () => {
              const ok = await openCitationDoc(parsed.docId)
              if (!ok) useDocumentStore.getState().showToast('Failed to open document. It may have been moved or deleted.')
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

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
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

const TOOL_COLORS: Record<string, string> = {
  search: 'text-accent',
  read: 'text-success',
  summary: 'text-warning',
  metadata: 'text-warning',
  open: 'text-accent',
  report: 'text-warning',
  add: 'text-success'
}

function TraceStepRow({ step, isLast, forceOpen }: { step: AgentTraceStep; isLast: boolean; forceOpen?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (forceOpen !== undefined) setOpen(forceOpen)
  }, [forceOpen])
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
          <KindIcon className={`h-3 w-3 shrink-0 ${step.kind === 'tool' && toolLabel ? (TOOL_COLORS[toolLabel.icon] ?? 'text-muted') : 'text-muted'}`} />
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">
            <span className="font-medium">{displayText}</span>
          </span>
          {step.kind === 'llm' && step.totalTokens != null && (
            <span
              className="shrink-0 text-label text-muted"
              title={t('workspace.chat.tokenUsage', 'Tokens')}
            >
              <ArrowUp className="mr-0.5 inline h-2.5 w-2.5" />{step.inputTokens ?? 0} <ArrowDown className="mx-0.5 inline h-2.5 w-2.5" />{step.outputTokens ?? 0}
            </span>
          )}
          {duration && <span className="shrink-0 text-label text-muted">{duration}</span>}
        </button>
        {open && hasBody && (
          <div className="mt-1 space-y-1.5 pl-1">
            {step.input && (
              <div>
                <p className="mb-0.5 text-label font-medium uppercase tracking-wide text-muted">
                  {t('workspace.chat.traceInput', 'Input')}
                </p>
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-panel-2 px-1.5 py-1 text-label text-foreground">
                  {step.input}
                </pre>
              </div>
            )}
            {step.output && (
              <div>
                <p className="mb-0.5 text-label font-medium uppercase tracking-wide text-muted">
                  {t('workspace.chat.traceOutput', 'Output')}
                </p>
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-panel-2 px-1.5 py-1 text-label text-foreground">
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
  const [expandAll, setExpandAll] = useState<boolean | null>(null)
  const visible = steps.filter((s) => s.kind !== 'run')
  const totalTokensSum = visible.reduce((sum, s) => sum + (s.totalTokens ?? 0), 0)
  const hasTokenData = visible.some((s) => s.totalTokens != null)
  const isRunning = visible.some((s) => s.status === 'running')
  const hasError = visible.some((s) => s.status === 'error')

  const contentRef = useRef<HTMLDivElement | null>(null)
  const lastStepRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (streaming && visible.length > 0) {
      setOpen(true)
    }
  }, [streaming, visible.length])

  useEffect(() => {
    if (open && lastStepRef.current) {
      lastStepRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [open, visible.length, isRunning])

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
        <span className="text-xs font-medium text-foreground">
          {t('workspace.chat.trace', 'Agent steps')}
        </span>
        <span className="text-label text-muted">
          {visible.length > 0 ? visible.length : streaming ? '…' : 0}
        </span>
        {summaryLabel && (
          <span className="text-label text-muted">· {summaryLabel}</span>
        )}
        {hasTokenData && !isRunning && (
          <span className="text-label text-muted">
            · {t('workspace.chat.tokenTotal', { count: totalTokensSum, defaultValue: 'Total: {{count}} tokens' })}
          </span>
        )}
        {visible.length > 0 && open && (
          <button
            type="button"
            className="ml-auto mr-1 text-label text-muted transition-colors duration-150 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              setExpandAll(expandAll === null ? true : !expandAll)
            }}
          >
            {expandAll ? t('workspace.chat.collapseAll', 'Collapse all') : t('workspace.chat.expandAll', 'Expand all')}
          </button>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? '' : '-rotate-90'} ${visible.length > 0 && open ? '' : 'ml-auto'}`}
        />
      </button>
      {open && (
        <div ref={contentRef} className="flex flex-col gap-0 px-2.5 pb-2 pt-0.5">
          {visible.length === 0 ? (
            <p className="px-1 py-1 text-xs text-muted">
              {t('workspace.chat.traceEmpty', 'No tool or model steps yet.')}
            </p>
          ) : (
            visible.map((step, i) => (
              <div key={step.id} ref={i === visible.length - 1 ? lastStepRef : undefined}>
                <TraceStepRow
                  step={step}
                  isLast={i === visible.length - 1}
                  forceOpen={expandAll ?? undefined}
                />
              </div>
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
      className="shrink-0 rounded p-1 text-muted opacity-40 transition-opacity hover:text-foreground hover:opacity-100"
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
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
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
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)

  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([])
  const [workspaceDocs, setWorkspaceDocs] = useState<Array<{ docId: string; title: string }>>([])
  const [workspaceScopeOpen, setWorkspaceScopeOpen] = useState(false)

  const threads = useWorkspaceStore((s) => s.threads)
  const fetchThreads = useWorkspaceStore((s) => s.fetchThreads)
  const deleteThread = useWorkspaceStore((s) => s.deleteThread)
  const renameThread = useWorkspaceStore((s) => s.renameThread)
  const [threadMenuOpen, setThreadMenuOpen] = useState(false)
  const threadMenuRef = useRef<HTMLDivElement | null>(null)
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const showConfirm = useConfirmStore((s) => s.show)

  const threadIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const attachMenuRef = useRef<HTMLDivElement | null>(null)
  const workspaceScopeRef = useRef<HTMLDivElement | null>(null)
  const inputAreaRef = useRef<HTMLDivElement | null>(null)
  const hadMessagesRef = useRef(false)
  const isSendingRef = useRef(false)
  const lastSendRef = useRef<{ text: string; attachments: string[]; threadId: string | null } | null>(null)
  const stickToBottomRef = useRef(true)
  const streamingTextRef = useRef('')
  const streamingReasoningRef = useRef('')
  const streamingStartTimeRef = useRef<number | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
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
    if (streaming) {
      streamingStartTimeRef.current = Date.now()
      setElapsedSeconds(0)
      elapsedTimerRef.current = setInterval(() => {
        if (streamingStartTimeRef.current != null) {
          setElapsedSeconds(Math.floor((Date.now() - streamingStartTimeRef.current) / 1000))
        }
      }, 1000)
    } else {
      if (elapsedTimerRef.current != null) {
        clearInterval(elapsedTimerRef.current)
        elapsedTimerRef.current = null
      }
      streamingStartTimeRef.current = null
    }
    return () => {
      if (elapsedTimerRef.current != null) {
        clearInterval(elapsedTimerRef.current)
        elapsedTimerRef.current = null
      }
    }
  }, [streaming])

  useClickOutside(menuRef, () => setModelMenuOpen(false), modelMenuOpen)

  useEffect(() => {
    void fetchThreads()
  }, [activeWorkspaceId, fetchThreads])

  useClickOutside(threadMenuRef, () => setThreadMenuOpen(false), threadMenuOpen)

  useClickOutside(attachMenuRef, () => setAttachMenuOpen(false), attachMenuOpen)

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

  useClickOutside(workspaceScopeRef, () => setWorkspaceScopeOpen(false), workspaceScopeOpen)

  useEffect(() => {
    if (!workspaceScopeOpen || !activeWorkspaceId || workspaceDocs.length > 0) return
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
  }, [workspaceScopeOpen, activeWorkspaceId, workspaceDocs.length])

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

  const exportThread = useCallback(async (threadId: string) => {
    if (!threadId) return
    try {
      const history = await api.ai.chatHistory(threadId)
      const thread = threads.find((t) => t.id === threadId)
      const title = thread?.title?.trim() || `thread-${threadId.slice(0, 8)}`
      const date = new Date().toISOString().slice(0, 10)
      const lines: string[] = [`# ${title}`, '']
      for (const msg of history) {
        if (msg.role === 'user') {
          lines.push('## User', '')
        } else if (msg.role === 'assistant') {
          lines.push('## Assistant', '')
        } else {
          continue
        }
        lines.push(msg.content, '')
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title.replace(/[^\w\u4e00-\u9fff\s-]/g, '').trim() || 'conversation'}-${date}.md`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Failed to export conversation')
    }
  }, [threads])

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

  const activeThread = threads.find((th) => th.id === activeThreadId)
  const activeThreadTitle = activeThread?.title?.trim()
    ? activeThread.title.trim()
    : t('workspace.chat.newConversation', 'New conversation')

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
          <UiButton
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => setThreadMenuOpen((v) => !v)}
            title={t('workspace.chat.threadHistory', 'Thread history')}
            aria-label={t('workspace.chat.threadHistory', 'Thread history')}
            disabled={streaming}
          >
            <MessageSquare className="h-4 w-4" />
          </UiButton>
          {threadMenuOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-border bg-panel shadow-lg">
              {threads.length === 0 ? (
                <p className="px-3 py-2 text-label text-muted">
                  {t('workspace.chat.noThreads', 'No conversations yet')}
                </p>
              ) : (
                threads.map((th) => (
                  <div
                    key={th.id}
                    className={`flex items-center gap-1 px-2 py-1.5 text-label transition-colors duration-150 hover:bg-hover ${
                      th.id === activeThreadId ? 'bg-active text-foreground' : 'text-muted'
                    }`}
                  >
                    {renamingThreadId === th.id ? (
                      <UiInput
                        variant="outlined"
                        inputSize="sm"
                        className="min-w-0 flex-1 border-accent"
                        value={renameDraft}
                        autoFocus
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            if (renameDraft.trim()) {
                              void renameThread(th.id, renameDraft.trim())
                            }
                            setRenamingThreadId(null)
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            setRenamingThreadId(null)
                          }
                        }}
                        onBlur={() => {
                          if (renameDraft.trim() && renameDraft.trim() !== th.title) {
                            void renameThread(th.id, renameDraft.trim())
                          }
                          setRenamingThreadId(null)
                        }}
                      />
                    ) : (
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
                    )}
                    {renamingThreadId !== th.id && (
                      <button
                        type="button"
                        className="shrink-0 text-muted transition-colors duration-150 hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation()
                          setRenamingThreadId(th.id)
                          setRenameDraft(th.title?.trim() || '')
                        }}
                        title={t('common.rename', 'Rename')}
                        aria-label={t('common.rename', 'Rename')}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                    {renamingThreadId !== th.id && (
                      <button
                        type="button"
                        className="shrink-0 text-muted transition-colors duration-150 hover:text-error"
                        onClick={(e) => {
                          e.stopPropagation()
                          const threadTitle = th.title?.trim() || `${t('workspace.chat.thread', 'Thread')} ${th.id.slice(0, 8)}`
                          showConfirm({
                            title: t('common.delete'),
                            message: t('workspace.chat.confirmDeleteThread', { name: threadTitle, defaultValue: 'Delete "{{name}}"?' }),
                            confirmText: t('common.delete'),
                            cancelText: t('common.cancel'),
                            danger: true,
                            onConfirm: () => {
                              void deleteThread(th.id).then(() => void fetchThreads())
                            }
                          })
                        }}
                        title={t('common.delete', 'Delete')}
                        aria-label={t('common.delete', 'Delete')}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))
              )}
              {threads.length > 0 && activeThreadId && (
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 border-t border-border px-2 py-1.5 text-label text-muted transition-colors duration-150 hover:bg-hover hover:text-foreground"
                  onClick={() => {
                    void exportThread(activeThreadId)
                    setThreadMenuOpen(false)
                  }}
                >
                  <Download className="h-3 w-3" />
                  {t('workspace.chat.exportChat', 'Export conversation')}
                </button>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-center text-xs font-medium text-foreground transition-colors duration-150 hover:text-accent disabled:opacity-40"
          onClick={() => !streaming && setThreadMenuOpen((v) => !v)}
          disabled={streaming}
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </button>
        <UiButton
          variant="ghost"
          size="sm"
          iconOnly
          onClick={startNewChat}
          title={t('workspace.chat.newChat', 'New chat')}
          aria-label={t('workspace.chat.newChat', 'New chat')}
          disabled={streaming}
        >
          <Plus className="h-4 w-4" />
        </UiButton>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loadingHistory ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                <div
                  className={`skeleton-shimmer h-12 rounded-2xl ${
                    i % 2 === 0 ? 'max-w-[70%] w-48' : 'max-w-[70%] w-36'
                  }`}
                />
              </div>
            ))}
          </div>
        ) : showEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            {providers.length === 0 ? (
              <>
                <Bot className="h-10 w-10 text-muted/50" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {t('workspace.chat.noProviderTitle', 'No AI Provider')}
                  </p>
                  <p className="text-xs text-muted">
                    {t('workspace.chat.noProvider', 'No AI provider configured. Add one in Settings.')}
                  </p>
                </div>
                <UiButton
                  variant="primary"
                  size="md"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('refora:open-settings'))
                  }}
                >
                  {t('topbar.settings', 'Settings')}
                </UiButton>
              </>
            ) : (
              <>
                <Sparkles className="h-8 w-8 text-accent/60" />
                <p className="text-xs text-muted">
                  {t('workspace.chatPlaceholder', 'Ask anything about the papers in this workspace.')}
                </p>
                <div className="flex flex-col gap-1.5">
                  {[
                    { key: 'summarize', text: t('workspace.chat.suggestionSummarize', 'Summarize the key contributions of these papers') },
                    { key: 'compare', text: t('workspace.chat.suggestionCompare', 'Compare the methodologies used in these papers') },
                    { key: 'report', text: t('workspace.chat.suggestionReport', 'Generate a research report') }
                  ].map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      className="rounded-lg border border-border bg-panel-2 px-3 py-1.5 text-left text-label text-muted transition-colors duration-150 hover:border-accent hover:text-foreground"
                      onClick={() => setInput(s.text)}
                    >
                      {s.text}
                    </button>
                  ))}
                </div>
              </>
            )}
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
                          : 'group bg-panel-2 text-foreground chat-markdown'
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
                                <>
                                  <button
                                    type="button"
                                    className={`shrink-0 rounded p-1 transition-opacity hover:opacity-100 ${
                                      feedback === 'up' ? 'text-success opacity-100' : 'text-muted opacity-40'
                                    }`}
                                    onClick={() => setFeedback((f) => f === 'up' ? null : 'up')}
                                    title={t('workspace.chat.feedbackUp', 'Good response')}
                                    aria-label={t('workspace.chat.feedbackUp', 'Good response')}
                                  >
                                    <ThumbsUp className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    className={`shrink-0 rounded p-1 transition-opacity hover:opacity-100 ${
                                      feedback === 'down' ? 'text-error opacity-100' : 'text-muted opacity-40'
                                    }`}
                                    onClick={() => setFeedback((f) => f === 'down' ? null : 'down')}
                                    title={t('workspace.chat.feedbackDown', 'Poor response')}
                                    aria-label={t('workspace.chat.feedbackDown', 'Poor response')}
                                  >
                                    <ThumbsDown className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    className="shrink-0 rounded p-1 text-muted opacity-40 transition-opacity hover:text-foreground hover:opacity-100"
                                    onClick={() => void handleRegenerate()}
                                    title={t('workspace.chat.regenerate', 'Regenerate')}
                                    aria-label={t('workspace.chat.regenerate', 'Regenerate')}
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                  </button>
                                </>
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
                  <div className="mt-1 text-muted chat-markdown-muted">
                    <StreamingMarkdown content={streamingReasoning} />
                  </div>
                </details>
              </div>
            )}
            {streamingText && (
              <div className="flex justify-start" aria-live="polite" aria-label={t('workspace.chat.streamingResponse', 'AI response')}>
                <div className="max-w-[85%] break-words rounded-2xl bg-panel-2 px-3 py-2 text-xs text-foreground chat-markdown">
                  <StreamingMarkdown content={streamingText} />
                </div>
              </div>
            )}
            {streaming && !streamingText && !streamingReasoning && (
              <div className="flex justify-start" aria-live="polite">
                <div className="flex items-center gap-1 rounded-2xl bg-panel-2 px-3 py-2">
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                  <span className="ml-1 text-xs text-muted">
                    {t('workspace.chat.thinking', 'Thinking…')} ({formatElapsed(elapsedSeconds)})
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showScrollBtn && (
        <button
          type="button"
          className="absolute left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-panel p-1.5 shadow-lg transition-colors duration-150 hover:bg-hover"
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
          <div className="flex items-center gap-2 rounded-lg bg-error/10 px-3 py-1.5 text-xs text-error">
            <span className="min-w-0 flex-1 break-words">{error}</span>
            {lastSendRef.current && !streaming && (
              <button
                type="button"
                className="shrink-0 rounded px-1.5 py-0.5 text-label font-medium transition-colors duration-150 hover:bg-error/20"
                onClick={() => void handleRetry()}
                title={t('workspace.chat.retry', 'Retry')}
                aria-label={t('workspace.chat.retry', 'Retry')}
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              className="shrink-0 rounded px-1 py-0.5 transition-colors duration-150 hover:bg-error/20"
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
          <div className="rounded-lg bg-panel-2 px-3 py-1.5 text-label text-muted">
            {t(
              'workspace.chat.modelSwitchHint',
              'Model switched — applies to new messages only.'
            )}
          </div>
        </div>
      )}

      <div ref={inputAreaRef} className="shrink-0 p-3">
        <div className="flex flex-col rounded-xl border border-border bg-panel-2 shadow-sm focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
          {selectedAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1 px-2 pt-1">
              {selectedAttachments.map((docId) => {
                const doc = workspaceDocs.find((d) => d.docId === docId)
                return (
                  <span
                    key={docId}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-panel-2 px-2 py-0.5 text-caption text-foreground"
                  >
                    <span className="max-w-[120px] truncate">{doc?.title ?? docId.slice(0, 8)}</span>
                    <button
                      type="button"
                      className="text-muted transition-colors duration-150 hover:text-error"
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

          <div className="flex flex-col gap-1 px-2 pb-2 pt-1">
            <div className="flex items-center gap-1">
            <div className="relative shrink-0" ref={attachMenuRef}>
              <UiButton
                variant="ghost"
                size="sm"
                iconOnly
                className={`shrink-0 ${selectedAttachments.length > 0 ? 'text-accent' : ''}`}
                onClick={() => setAttachMenuOpen((v) => !v)}
                disabled={!activeWorkspaceId || streaming}
                title={t('workspace.chat.attachPapers', 'Attach papers')}
                aria-label={t('workspace.chat.attachPapers', 'Attach papers')}
              >
                <Paperclip className="h-4 w-4" />
                {selectedAttachments.length > 0 && (
                  <span className="ml-0.5 text-caption font-medium">{selectedAttachments.length}</span>
                )}
              </UiButton>
              {attachMenuOpen && (
                <div className="absolute bottom-full left-0 z-50 mb-1 max-h-64 w-64 overflow-y-auto rounded-lg border border-border bg-panel shadow-lg">
                  {workspaceDocs.length === 0 ? (
                    <p className="px-3 py-2 text-label text-muted">
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
                            className={`flex items-center gap-2 rounded px-2 py-1 text-label transition-colors duration-150 hover:bg-hover ${maxReached ? 'opacity-40' : ''}`}
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
                        <p className="px-2 py-1 text-caption text-muted">
                          {t('workspace.chat.attachMax', 'Maximum 8 attachments.')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="relative shrink-0" ref={workspaceScopeRef}>
              <button
                type="button"
                className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-caption text-muted transition-colors duration-150 hover:border-accent hover:text-foreground disabled:opacity-40"
                onClick={() => setWorkspaceScopeOpen((v) => !v)}
                disabled={!activeWorkspaceId}
              >
                {t('workspace.chat.workspaceScope', 'Workspace')}
                <ChevronDown className="ml-0.5 inline h-2.5 w-2.5" />
              </button>
              {workspaceScopeOpen && (
                <div className="absolute bottom-full left-0 z-50 mb-1 max-h-48 w-56 overflow-y-auto rounded-lg border border-border bg-panel p-1 shadow-lg">
                  {workspaceDocs.length === 0 ? (
                    <p className="px-2 py-1.5 text-label text-muted">
                      {t('workspace.chat.noWorkspaceDocs', 'No papers in workspace.')}
                    </p>
                  ) : (
                    workspaceDocs.map((doc) => (
                      <div key={doc.docId} className="truncate px-2 py-1 text-label text-foreground">
                        {doc.title}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            {input.length > MAX_INPUT_LENGTH * 0.8 && (
              <span
                className={`ml-auto text-caption ${
                  input.length > MAX_INPUT_LENGTH ? 'text-error' : 'text-muted'
                }`}
              >
                {Math.max(0, MAX_INPUT_LENGTH - input.length)}{' '}
                {t('workspace.chat.charsRemaining', 'chars left')}
              </span>
            )}
            </div>

            <div className="flex items-center gap-1">
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  className="inline-flex max-w-[160px] items-center gap-1 rounded-lg px-2 py-1 text-label text-foreground transition-colors duration-150 hover:bg-hover disabled:opacity-40"
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
                    className="absolute top-full right-0 z-50 mt-1 w-72 max-h-72 overflow-y-auto rounded-xl border border-border bg-panel p-2 shadow-lg"
                    role="listbox"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="option"]'))
                      const currentIndex = buttons.findIndex((b) => b === document.activeElement)
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        const next = buttons[Math.min(currentIndex + 1, buttons.length - 1)] ?? buttons[0]
                        next?.focus()
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        const prev = buttons[Math.max(currentIndex - 1, 0)] ?? buttons[0]
                        prev?.focus()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        setModelMenuOpen(false)
                      }
                    }}
                  >
                    <p className="px-1 pb-1 text-caption font-semibold uppercase tracking-wide text-muted">
                      {t('workspace.chat.providerModels', 'Provider models')}
                    </p>
                    {providers.map((p) => (
                      <button
                        key={`p-${p.id}`}
                        type="button"
                        role="option"
                        aria-selected={p.id === activeProviderId}
                        className={`mb-0.5 flex w-full flex-col rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-hover ${
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
                        <span className="truncate text-caption text-muted">{p.model}</span>
                      </button>
                    ))}

                    {providerModels.length > 0 && (
                      <>
                        <p className="mt-2 px-1 pb-1 text-caption font-semibold uppercase tracking-wide text-muted">
                          {t('workspace.chat.availableModels', 'Available models')}
                          {loadingModels ? '…' : ''}
                        </p>
                        {providerModels.slice(0, 40).map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            role="option"
                            aria-selected={m.id === selectedModel}
                            className="mb-0.5 flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-hover"
                            onClick={() => void applyModel(m.id, '')}
                          >
                            <span className="min-w-0 flex-1 truncate text-xs text-foreground">{m.id}</span>
                            <span className="flex shrink-0 items-center gap-1">
                              {m.supportsVariants && (
                                <span className="text-caption text-accent">
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
                        <p className="mt-2 px-1 pb-1 text-caption font-semibold uppercase tracking-wide text-muted">
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
                              className="mb-0.5 flex w-full flex-col rounded-lg px-2 py-1.5 text-left text-xs text-foreground transition-colors duration-150 hover:bg-hover"
                              onClick={() =>
                                void applyModel(parsed.baseModel || entry.model, parsed.variant, entry.providerId)
                              }
                            >
                              <span className="truncate">{entry.model}</span>
                              {providerName && (
                                <span className="truncate text-caption text-muted">{providerName}</span>
                              )}
                            </button>
                          )
                        })}
                      </>
                    )}

                    <p className="mt-2 px-1 pb-1 text-caption font-semibold uppercase tracking-wide text-muted">
                      {t('workspace.chat.customModel', 'Custom model')}
                    </p>
                    <div className="flex gap-1 px-1">
                      <UiInput
                        variant="outlined"
                        inputSize="sm"
                        className="min-w-0 flex-1"
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
                      <UiButton
                        variant="primary"
                        size="sm"
                        disabled={customModelInvalid}
                        onClick={() => {
                          const parsed = parseModelId(customModelTrimmed)
                          void applyModel(parsed.baseModel, parsed.variant)
                          setCustomModel('')
                        }}
                      >
                        {t('common.add', 'Add')}
                      </UiButton>
                    </div>
                    {customModel && customModelInvalid && (
                      <p className="px-1 pt-1 text-caption text-muted">
                        {t('workspace.chat.customModelHint', 'Model ID cannot contain spaces.')}
                      </p>
                    )}

                    {variantCapable && (
                      <>
                        <p className="mt-2 px-1 pb-1 text-caption font-semibold uppercase tracking-wide text-muted">
                          {t('workspace.chat.variant', 'Variant')}
                        </p>
                        <div className="flex flex-wrap gap-1 px-1 pb-1">
                          <button
                            type="button"
                            className={`rounded-md border px-2 py-0.5 text-caption ${
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
                              className={`rounded-md border px-2 py-0.5 text-caption ${
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

              <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-label ${
                  deepThinking
                    ? 'bg-accent text-white'
                    : 'text-muted transition-colors duration-150 hover:bg-hover hover:text-foreground'
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
              </button>

              {streaming ? (
                <UiButton
                  variant="danger"
                  size="sm"
                  iconOnly
                  className="shrink-0"
                  onClick={handleCancel}
                  aria-label={t('workspace.chat.stop', 'Stop')}
                  title={t('workspace.chat.stop', 'Stop')}
                >
                  <Square className="h-3.5 w-3.5" />
                </UiButton>
              ) : (
                <UiButton
                  variant="primary"
                  size="sm"
                  iconOnly
                  className="shrink-0"
                  onClick={() => void handleSend()}
                  disabled={!canSend}
                  aria-label={t('workspace.chat.send', 'Send')}
                  title={t('workspace.chat.send', 'Send')}
                >
                  <Send className="h-3.5 w-3.5" />
                </UiButton>
              )}
            </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
