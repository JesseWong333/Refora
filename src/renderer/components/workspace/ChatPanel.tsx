import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X, ArrowCounterClockwise } from '@phosphor-icons/react'
import { api } from '../../ipc'
import { errorMessage } from '../../../shared/ipc-types'
import type { AiProvider, ProviderModelInfo } from '../../../shared/ipc-types'
import { composeModelId, parseModelId } from '../../../shared/modelVariant'
import { resolveDeepThinkingMode } from '../../../shared/deepThinking'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { Button as UiButton } from '../ui'
import { useChatStream } from '../../hooks/useChatStream'
import { loadRecentModels, pushRecentModel, type RecentModelEntry } from '../../utils/chatUtils'
import ChatMessages from './ChatMessages'
import ChatInput from './ChatInput'
import ModelSelector from './ModelSelector'
import ThreadHistory from './ThreadHistory'

export { parseReforaDocLink } from './ChatMessages'

export default function ChatPanel() {
  const { t } = useTranslation()
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const activeThreadId = useWorkspaceStore((s) => s.activeThreadId)
  const setActiveThreadId = useWorkspaceStore((s) => s.setActiveThreadId)
  const setChatStreaming = useWorkspaceStore((s) => s.setChatStreaming)
  const startNewChat = useWorkspaceStore((s) => s.startNewChat)
  const threads = useWorkspaceStore((s) => s.threads)
  const fetchThreads = useWorkspaceStore((s) => s.fetchThreads)

  const [providers, setProviders] = useState<AiProvider[]>([])
  const [activeProviderId, setActiveProviderId] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedVariant, setSelectedVariant] = useState('')
  const [deepThinking, setDeepThinking] = useState(false)
  const [providerModels, setProviderModels] = useState<ProviderModelInfo[]>([])
  const [recentModels, setRecentModels] = useState<RecentModelEntry[]>([])
  const [modelSwitchHint, setModelSwitchHint] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)

  const [input, setInput] = useState('')
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([])
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)

  const [inputAreaHeight, setInputAreaHeight] = useState(0)

  const [threadMenuOpen, setThreadMenuOpen] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const inputAreaRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const leftRef = useRef<HTMLDivElement | null>(null)
  const rightRef = useRef<HTMLDivElement | null>(null)

  const [titleMaxWidth, setTitleMaxWidth] = useState<number | undefined>(undefined)

  useEffect(() => {
    const el = headerRef.current
    const left = leftRef.current
    const right = rightRef.current
    if (!el) return
    const update = () => {
      const lw = left?.offsetWidth ?? 0
      const rw = right?.offsetWidth ?? 0
      const side = Math.max(lw, rw)
      const gap = 24
      const available = el.clientWidth - side * 2 - gap * 2
      setTitleMaxWidth(available > 0 ? available : 0)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    if (left) ro.observe(left)
    if (right) ro.observe(right)
    return () => ro.disconnect()
  }, [providers.length, providerModels.length])

  const activeProvider = providers.find((p) => p.id === activeProviderId) ?? null

  const activeThread = threads.find((th) => th.id === activeThreadId)
  const activeThreadTitle = activeThread?.title?.trim()
    ? activeThread.title.trim()
    : t('workspace.chat.newConversation', 'New conversation')

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

  const chat = useChatStream({
    activeWorkspaceId,
    activeProviderId,
    activeThreadId,
    requestModel,
    deepThinking,
    setActiveThreadId,
    setChatStreaming,
    fetchThreads
  })

  const canSend = !!activeWorkspaceId && !!activeProviderId && !!input.trim() && !chat.streaming

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
      const providerIds = new Set(list.map((provider) => provider.id))
      setRecentModels(recent.filter((entry) => providerIds.has(entry.providerId)))
      const activeIsValid = !!active && providerIds.has(active)
      const nextId =
        (activeIsValid && active) ||
        (list.length > 0 ? list[0].id : '')
      setActiveProviderId(nextId)
      const p = list.find((x) => x.id === nextId)
      if (p) {
        const parsed = parseModelId(p.model)
        setSelectedModel(p.baseModel || parsed.baseModel || p.model)
        setSelectedVariant(p.variant || parsed.variant)
      }
      if (activeIsValid && savedModel) setSelectedModel(savedModel)
      if (activeIsValid && savedVariant) setSelectedVariant(savedVariant)
      if (!activeIsValid && nextId) void api.settings.set('activeProviderId', nextId)
      setDeepThinking(savedDeep)
    } catch (e) {
      chat.setError(errorMessage(e, 'Failed to load providers'))
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
    setSelectedAttachments([])
    setAttachMenuOpen(false)
  }, [activeWorkspaceId, activeThreadId])

  useEffect(() => {
    const onShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        const el = textareaRef.current
        if (!chat.streaming && el) {
          e.preventDefault()
          el.focus()
        }
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [chat.streaming])

  useEffect(() => {
    const el = inputAreaRef.current
    if (!el) return
    const update = () => setInputAreaHeight(el.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const applyModel = useCallback(
    async (baseModel: string, variant = '', providerId?: string) => {
      const nextProviderId = providerId ?? activeProviderId
      if (!providers.some((provider) => provider.id === nextProviderId)) return
      if (providerId && providerId !== activeProviderId) {
        setActiveProviderId(providerId)
        void api.settings.set('activeProviderId', providerId)
      }
      setSelectedModel(baseModel)
      setSelectedVariant(variant)
      void api.settings.set('chatSelectedModel', baseModel)
      void api.settings.set('chatSelectedVariant', variant)
      if (chat.hadMessagesRef.current || chat.messages.length > 0) {
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
          chat.setError(errorMessage(e, 'Failed to update model'))
        }
      }
    },
    [activeProviderId, chat.messages.length, providers, chat.hadMessagesRef, chat.setError]
  )

  const toggleDeepThinking = useCallback(() => {
    setDeepThinking((v) => {
      const next = !v
      void api.settings.set('chatDeepThinking', next)
      return next
    })
  }, [])

  const handleSend = useCallback(() => {
    if (!input.trim() || chat.streaming) return
    const text = input.trim()
    const atts = [...selectedAttachments]
    setInput('')
    setSelectedAttachments([])
    setAttachMenuOpen(false)
    void chat.sendText(text, atts, activeThreadId)
  }, [input, chat.streaming, selectedAttachments, activeThreadId, chat.sendText])

  const exportThread = useCallback(async (threadId: string) => {
    if (!threadId) return
    try {
      const history = await api.ai.chatHistory(threadId)
      const thread = threads.find((th) => th.id === threadId)
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
      chat.setError('Failed to export conversation')
    }
  }, [threads, chat.setError])

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background" style={{ containerType: 'inline-size' }}>
      <div ref={headerRef} className="relative flex shrink-0 items-center justify-between gap-2 px-3 py-1.5">
        <div ref={leftRef} className="shrink-0">
          <ThreadHistory
            streaming={chat.streaming}
            onExportThread={exportThread}
            menuOpen={threadMenuOpen}
            onMenuOpenChange={setThreadMenuOpen}
          />
        </div>
        <button
          type="button"
          className="absolute left-1/2 top-1/2 max-w-[40%] -translate-x-1/2 -translate-y-1/2 truncate text-center text-xs font-medium text-foreground transition-colors duration-150 hover:text-accent disabled:opacity-40"
          style={{ maxWidth: titleMaxWidth != null ? `${titleMaxWidth}px` : undefined }}
          onClick={() => !chat.streaming && setThreadMenuOpen((v) => !v)}
          disabled={chat.streaming}
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </button>
        <div ref={rightRef} className="flex shrink-0 items-center gap-1">
          <UiButton
            variant="ghost"
            size="sm"
            iconOnly
            onClick={startNewChat}
            title={t('workspace.chat.newChat', 'New chat')}
            aria-label={t('workspace.chat.newChat', 'New chat')}
            disabled={chat.streaming}
          >
            <Plus className="h-4 w-4" />
          </UiButton>
        </div>
      </div>

      <ChatMessages
        messages={chat.messages}
        traceSteps={chat.traceSteps}
        streaming={chat.streaming}
        streamingText={chat.streamingText}
        streamingReasoning={chat.streamingReasoning}
        activeRunId={chat.activeRunId}
        elapsedSeconds={chat.elapsedSeconds}
        loadingHistory={chat.loadingHistory}
        providers={providers}
        onRegenerate={chat.handleRegenerate}
        onSuggestionClick={setInput}
        scrollRef={scrollRef}
        inputAreaHeight={inputAreaHeight}
        stickToBottomRef={chat.stickToBottomRef}
      />

      {chat.error && (
        <div className="shrink-0 px-3 pb-1">
          <div className="flex items-center gap-2 rounded-lg bg-error/10 px-3 py-1.5 text-xs text-error">
            <span className="min-w-0 flex-1 break-words">{chat.error}</span>
            {chat.canRetry && !chat.streaming && (
              <button
                type="button"
                className="shrink-0 rounded px-1.5 py-0.5 text-label font-medium transition-colors duration-150 hover:bg-error/20"
                onClick={() => void chat.handleRetry()}
                title={t('workspace.chat.retry', 'Retry')}
                aria-label={t('workspace.chat.retry', 'Retry')}
              >
                <ArrowCounterClockwise className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              className="shrink-0 rounded px-1 py-0.5 transition-colors duration-150 hover:bg-error/20"
              onClick={chat.clearError}
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

      <ChatInput
        input={input}
        onInputChange={setInput}
        streaming={chat.streaming}
        selectedAttachments={selectedAttachments}
        onSelectedAttachmentsChange={setSelectedAttachments}
        attachMenuOpen={attachMenuOpen}
        onAttachMenuOpenChange={setAttachMenuOpen}
        activeWorkspaceId={activeWorkspaceId}
        providers={providers}
        canSend={canSend}
        onSend={handleSend}
        onCancel={chat.handleCancel}
        textareaRef={textareaRef}
        inputAreaRef={inputAreaRef}
        toolbar={
          <ModelSelector
            providers={providers}
            activeProviderId={activeProviderId}
            selectedModel={selectedModel}
            selectedVariant={selectedVariant}
            providerModels={providerModels}
            recentModels={recentModels}
            loadingModels={loadingModels}
            deepThinking={deepThinking}
            thinkingMode={thinkingMode}
            requestModel={requestModel}
            streaming={chat.streaming}
            onApplyModel={applyModel}
            onToggleDeepThinking={toggleDeepThinking}
          />
        }
      />
    </div>
  )
}
