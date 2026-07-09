import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Select } from '@lobehub/ui'
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

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [activeProviderId, setActiveProviderId] = useState('')

  const threadIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [list, active] = await Promise.all([
          api.aiProviders.list(),
          api.settings.get<string>('activeProviderId', '')
        ])
        setProviders(list)
        setActiveProviderId(active || (list.length > 0 ? list[0].id : ''))
      } catch (e) {
        setError(errorMessage(e, 'Failed to load providers'))
      }
    })()
  }, [])

  useEffect(() => {
    setMessages([])
    setCurrentThreadId(null)
    threadIdRef.current = null
    setStreamingText('')
    setStreaming(false)
    setError(null)
  }, [activeWorkspaceId])

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

  const handleProviderChange = (id: string) => {
    setActiveProviderId(id)
    void api.settings.set('activeProviderId', id)
  }

  const handleSend = useCallback(async () => {
    if (!activeWorkspaceId || !activeProviderId || !input.trim() || streaming) return
    const text = input.trim()
    setMessages((prev) => [
      ...prev,
      localMessage(currentThreadId ?? '', 'user', text)
    ])
    setInput('')
    setStreaming(true)
    setStreamingText('')
    setError(null)
    try {
      const { threadId } = await api.ai.chatSend({
        workspaceId: activeWorkspaceId,
        threadId: currentThreadId ?? undefined,
        text,
        providerId: activeProviderId
      })
      if (!currentThreadId) {
        setCurrentThreadId(threadId)
        threadIdRef.current = threadId
      }
    } catch (e) {
      setError(errorMessage(e, 'Failed to send message'))
      setStreaming(false)
      setStreamingText('')
    }
  }, [activeWorkspaceId, activeProviderId, input, streaming, currentThreadId])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const showEmpty = messages.length === 0 && !streamingText
  const canSend = !!activeWorkspaceId && !!activeProviderId && !!input.trim() && !streaming

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Select
          value={activeProviderId}
          onChange={handleProviderChange}
          size="small"
          options={providers.map((p) => ({ label: p.name, value: p.id }))}
          placeholder={t('workspace.chat.selectProvider', 'Select provider')}
          style={{ width: '100%' }}
          disabled={providers.length === 0}
        />
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
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t(
            'workspace.chat.inputPlaceholder',
            'Send a message… (Enter to send, Shift+Enter for newline)'
          )}
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-40"
          >
            {t('workspace.chat.send', 'Send')}
          </button>
        </div>
      </div>
    </div>
  )
}
