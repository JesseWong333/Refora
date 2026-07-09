import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Select } from '@lobehub/ui'
import { Plus, Settings2, Send } from 'lucide-react'
import { api } from '../../ipc'
import { errorMessage } from '../../../shared/ipc-types'
import type {
  AiProvider,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatMessage,
  ChatTokenEvent
} from '../../../shared/ipc-types'
import { useWorkspaceStore } from '../../store/workspaceStore'

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

export default function ChatPanel() {
  const { t } = useTranslation()
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const activeThreadId = useWorkspaceStore((s) => s.activeThreadId)
  const setActiveThreadId = useWorkspaceStore((s) => s.setActiveThreadId)
  const startNewChat = useWorkspaceStore((s) => s.startNewChat)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [activeProviderId, setActiveProviderId] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)

  const threadIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const loadProviders = useCallback(async () => {
    try {
      const [list, active] = await Promise.all([
        api.aiProviders.list(),
        api.settings.get<string>('activeProviderId', '')
      ])
      setProviders(list)
      setActiveProviderId((prev) => {
        if (prev && list.some((p) => p.id === prev)) return prev
        if (active && list.some((p) => p.id === active)) return active
        return list.length > 0 ? list[0].id : ''
      })
    } catch (e) {
      setError(errorMessage(e, 'Failed to load providers'))
    }
  }, [])

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  useEffect(() => {
    if (!settingsOpen) return
    void loadProviders()
  }, [settingsOpen, loadProviders])

  useEffect(() => {
    threadIdRef.current = activeThreadId
    setStreamingText('')
    setStreaming(false)
    setError(null)
    if (!activeThreadId) {
      setMessages([])
      return
    }
    let cancelled = false
    void api.ai
      .chatHistory(activeThreadId)
      .then((history) => {
        if (cancelled || threadIdRef.current !== activeThreadId) return
        setMessages(history)
      })
      .catch(() => {
        if (cancelled) return
        setMessages([])
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
    api.events.onAiChatToken(onToken)
    api.events.onAiChatDone(onDone)
    api.events.onAiChatError(onError)
    return () => {
      api.events.off('ai:chat:token', onToken)
      api.events.off('ai:chat:done', onDone)
      api.events.off('ai:chat:error', onError)
    }
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streamingText])

  const activeProvider = providers.find((p) => p.id === activeProviderId) ?? null

  const handleProviderChange = (id: string) => {
    setActiveProviderId(id)
    void api.settings.set('activeProviderId', id)
  }

  const handleModelChange = async (model: string) => {
    if (!activeProviderId || !model.trim()) return
    try {
      const updated = await api.aiProviders.update(activeProviderId, { model: model.trim() })
      setProviders((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
    } catch (e) {
      setError(errorMessage(e, 'Failed to update model'))
    }
  }

  const handleSend = useCallback(async () => {
    if (!activeWorkspaceId || !activeProviderId || !input.trim() || streaming) return
    const text = input.trim()
    const existingThread = activeThreadId
    setMessages((prev) => [...prev, localMessage(existingThread ?? '', 'user', text)])
    setInput('')
    setStreaming(true)
    setStreamingText('')
    setError(null)
    try {
      const { threadId } = await api.ai.chatSend({
        workspaceId: activeWorkspaceId,
        threadId: existingThread ?? undefined,
        text,
        providerId: activeProviderId
      })
      if (!existingThread) {
        setActiveThreadId(threadId)
        threadIdRef.current = threadId
      }
    } catch (e) {
      setError(errorMessage(e, 'Failed to send message'))
      setStreaming(false)
      setStreamingText('')
    }
  }, [activeWorkspaceId, activeProviderId, input, streaming, activeThreadId, setActiveThreadId])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const showEmpty = messages.length === 0 && !streamingText
  const canSend = !!activeWorkspaceId && !!activeProviderId && !!input.trim() && !streaming

  const providerOptions = providers.map((p) => ({
    label: `${p.name} · ${p.model}`,
    value: p.id
  }))

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
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
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-xs ${
                    m.role === 'user' ? 'bg-accent text-white' : 'bg-panel-2 text-foreground'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {streamingText && (
              <div className="flex justify-start">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-panel-2 px-3 py-2 text-xs text-foreground">
                  {streamingText}
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

      <div className="shrink-0 border-t border-border p-3">
        <textarea
          className="w-full resize-none rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t(
            'workspace.chat.inputPlaceholder',
            'Send a message… (Enter to send, Shift+Enter for newline)'
          )}
          disabled={providers.length === 0}
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <Select
              value={activeProviderId || undefined}
              onChange={handleProviderChange}
              size="small"
              options={providerOptions}
              placeholder={t('workspace.chat.selectProvider', 'Select model / provider')}
              style={{ width: '100%' }}
              disabled={providers.length === 0 || streaming}
              aria-label={t('workspace.chat.selectProvider', 'Select model / provider')}
            />
          </div>
          <button
            type="button"
            className="sidebar-header-btn shrink-0"
            onClick={() => setSettingsOpen((v) => !v)}
            title={t('workspace.chat.modelConfig', 'Model settings')}
            aria-label={t('workspace.chat.modelConfig', 'Model settings')}
            aria-expanded={settingsOpen}
            disabled={providers.length === 0}
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
            {t('workspace.chat.send', 'Send')}
          </button>
        </div>

        {settingsOpen && activeProvider && (
          <div className="mt-2 rounded-lg border border-border bg-panel-2 p-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-muted">
                {activeProvider.name} · {activeProvider.baseUrl}
              </span>
              {!activeProvider.hasKey && (
                <span className="shrink-0 text-[10px] text-error">
                  {t('workspace.chat.noKey', 'No API key — set in Settings')}
                </span>
              )}
            </div>
            <label className="mb-1 block text-[11px] text-muted">
              {t('workspace.chat.model', 'Model')}
            </label>
            <input
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              value={activeProvider.model}
              onChange={(e) => {
                const model = e.target.value
                setProviders((prev) =>
                  prev.map((p) => (p.id === activeProviderId ? { ...p, model } : p))
                )
              }}
              onBlur={(e) => void handleModelChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleModelChange((e.target as HTMLInputElement).value)
                }
              }}
              placeholder="gpt-4o-mini"
              disabled={streaming}
              aria-label={t('workspace.chat.model', 'Model')}
            />
            <p className="mt-1 text-[10px] text-muted">
              {t(
                'workspace.chat.modelHint',
                'OpenAI-compatible model id for the selected provider. Change providers or API keys in Settings.'
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
