import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../ipc'
import { errorMessage } from '../../shared/ipc-types'
import type {
  AgentTraceStep,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatMessage,
  ChatReasoningEvent,
  ChatTokenEvent,
  ChatTraceEvent,
  ChatTitleUpdatedEvent
} from '../../shared/ipc-types'
import { useWorkspaceStore } from '../store/workspaceStore'
import {
  MAX_INPUT_LENGTH,
  pushRecentModel,
  localMessage,
  mergeTraceStep,
  type UseChatStreamParams,
  type UseChatStreamReturn
} from '../utils/chatUtils'

export function useChatStream({
  activeWorkspaceId,
  activeProviderId,
  activeThreadId,
  requestModel,
  deepThinking,
  setActiveThreadId,
  setChatStreaming,
  fetchThreads
}: UseChatStreamParams): UseChatStreamReturn {
  const { t } = useTranslation()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [traceSteps, setTraceSteps] = useState<AgentTraceStep[]>([])
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [streamingReasoning, setStreamingReasoning] = useState('')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  const threadIdRef = useRef<string | null>(null)
  const streamingTextRef = useRef('')
  const streamingReasoningRef = useRef('')
  const streamingStartTimeRef = useRef<number | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelledRef = useRef(false)
  const rafIdRef = useRef<number | null>(null)
  const isSendingRef = useRef(false)
  const lastSendRef = useRef<{ text: string; attachments: string[]; threadId: string | null } | null>(null)
  const hadMessagesRef = useRef(false)
  const stickToBottomRef = useRef(true)

  const displayMessages = useMemo(() => messages.filter((m) => m.role !== 'tool'), [messages])

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
          threads: s.threads.map((t2) =>
            t2.id === payload.threadId ? { ...t2, title: payload.title } : t2
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
    setStreamingText(streamingTextRef.current)
    setStreamingReasoning(streamingReasoningRef.current)
    isSendingRef.current = false
    setStreaming(false)
  }, [])

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

  return {
    messages, setMessages, traceSteps, setTraceSteps,
    streaming, streamingText, streamingReasoning, elapsedSeconds,
    error, setError, loadingHistory, displayMessages,
    sendText, handleCancel, handleRetry, handleRegenerate,
    lastSendRef, stickToBottomRef, threadIdRef, hadMessagesRef
  }
}
