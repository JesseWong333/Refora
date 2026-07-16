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
  type ChatSendContext,
  type ChatReplacementOptions,
  type UseChatStreamParams,
  type UseChatStreamReturn
} from '../utils/chatUtils'

export function useChatStream({
  activeWorkspaceId,
  activeProviderId,
  activeThreadId,
  requestModel,
  deepThinking,
  reasoningEffort,
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
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [canRetry, setCanRetry] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)

  const threadIdRef = useRef<string | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const streamingTextRef = useRef('')
  const streamingReasoningRef = useRef('')
  const streamingStepOutputRef = useRef(new Map<string, string>())
  const streamingStartTimeRef = useRef<number | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelledRef = useRef(false)
  const cancelledThreadRef = useRef<string | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const isSendingRef = useRef(false)
  const retrySendRef = useRef<ChatSendContext | null>(null)
  const latestSendRef = useRef<ChatSendContext | null>(null)
  const hadMessagesRef = useRef(false)
  const stickToBottomRef = useRef(true)
  const disposedRef = useRef(false)

  const displayMessages = useMemo(() => messages.filter((m) => m.role !== 'tool'), [messages])

  useEffect(() => {
    threadIdRef.current = activeThreadId
    if (!isSendingRef.current) {
      retrySendRef.current = null
      latestSendRef.current = null
      cancelledRef.current = false
      cancelledThreadRef.current = null
      setCanRetry(false)
      streamingTextRef.current = ''
      streamingReasoningRef.current = ''
      streamingStepOutputRef.current.clear()
      setStreamingText('')
      setStreamingReasoning('')
      setStreaming(false)
      activeRunIdRef.current = null
      setActiveRunId(null)
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
    if (isSendingRef.current) {
      setLoadingHistory(false)
      return
    }
    let cancelled = false
    setLoadingHistory(true)
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
      if (streamingStepOutputRef.current.size > 0) {
        setTraceSteps((prev) =>
          prev.map((step) => {
            const output = streamingStepOutputRef.current.get(step.id)
            return output === undefined ? step : { ...step, output }
          })
        )
      }
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
        if (payload.runId !== activeRunIdRef.current) return
        if (threadIdRef.current && payload.threadId !== threadIdRef.current) return
        streamingTextRef.current += payload.token
        if (payload.stepId) {
          const current = streamingStepOutputRef.current.get(payload.stepId) ?? ''
          const output = current + payload.token
          streamingStepOutputRef.current.set(payload.stepId, output)
          setTraceSteps((prev) =>
            prev.map((step) => step.id === payload.stepId ? { ...step, output } : step)
          )
        }
        scheduleStreamingFlush()
      },
      onReasoning: (payload: ChatReasoningEvent) => {
        if (payload.runId !== activeRunIdRef.current) return
        if (threadIdRef.current && payload.threadId !== threadIdRef.current) return
        streamingReasoningRef.current += payload.token
        if (payload.stepId) {
          const current = streamingStepOutputRef.current.get(payload.stepId) ?? ''
          const output = current + payload.token
          streamingStepOutputRef.current.set(payload.stepId, output)
          setTraceSteps((prev) =>
            prev.map((step) => step.id === payload.stepId ? { ...step, output } : step)
          )
        }
        scheduleStreamingFlush()
      },
      onDone: (payload: ChatDoneEvent) => {
        if (payload.runId !== activeRunIdRef.current) return
        if (threadIdRef.current && payload.threadId !== threadIdRef.current) return
        cancelledRef.current = false
        if (rafIdRef.current != null) {
          cancelAnimationFrame(rafIdRef.current)
          rafIdRef.current = null
        }
        isSendingRef.current = false
        activeRunIdRef.current = null
        setActiveRunId(null)
        retrySendRef.current = null
        cancelledThreadRef.current = null
        setCanRetry(false)
        setMessages((prev) => [
          ...prev,
          localMessage(payload.threadId, 'assistant', payload.finalText)
        ])
        streamingTextRef.current = ''
        streamingReasoningRef.current = ''
        streamingStepOutputRef.current.clear()
        setStreamingText('')
        setStreamingReasoning('')
        setStreaming(false)
      },
      onError: (payload: ChatErrorEvent) => {
        if (payload.runId !== activeRunIdRef.current) return
        if (threadIdRef.current && payload.threadId !== threadIdRef.current) return
        if (rafIdRef.current != null) {
          cancelAnimationFrame(rafIdRef.current)
          rafIdRef.current = null
        }
        isSendingRef.current = false
        activeRunIdRef.current = null
        setActiveRunId(null)
        cancelledRef.current = false
        cancelledThreadRef.current = null
        if (retrySendRef.current) {
          retrySendRef.current = {
            ...retrySendRef.current,
            threadId: payload.threadId,
            runId: payload.runId ?? retrySendRef.current.runId,
            persisted: true
          }
        }
        setCanRetry(retrySendRef.current !== null)
        setError(payload.message)
        streamingTextRef.current = ''
        streamingReasoningRef.current = ''
        streamingStepOutputRef.current.clear()
        setStreamingText('')
        setStreamingReasoning('')
        setStreaming(false)
      },
      onTrace: (payload: ChatTraceEvent) => {
        if (payload.runId !== activeRunIdRef.current) return
        if (threadIdRef.current && payload.threadId !== threadIdRef.current) return
        if (payload.step.kind === 'reasoning' || payload.step.kind === 'message') {
          const current = streamingStepOutputRef.current.get(payload.step.id)
          if (payload.step.output != null || current === undefined) {
            streamingStepOutputRef.current.set(payload.step.id, payload.step.output ?? '')
          }
        }
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
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
      if (isSendingRef.current && threadIdRef.current) {
        void api.ai.chatCancel(threadIdRef.current).catch(() => undefined)
      }
      isSendingRef.current = false
      setChatStreaming(false)
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

  const cancelThread = useCallback((threadId: string) => {
    if (cancelledThreadRef.current === threadId) return
    cancelledThreadRef.current = threadId
    void api.ai.chatCancel(threadId).catch((e) => {
      cancelledRef.current = false
      cancelledThreadRef.current = null
      setCanRetry(false)
      setError(errorMessage(e, 'Failed to stop response'))
    })
  }, [])

  const sendText = useCallback(async (
    text: string,
    attachments: string[],
    existingThread: string | null,
    replacement: ChatReplacementOptions = {}
  ) => {
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
    const requestedRunId = globalThis.crypto?.randomUUID?.() ??
      `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    activeRunIdRef.current = requestedRunId
    setActiveRunId(requestedRunId)
    streamingTextRef.current = ''
    streamingReasoningRef.current = ''
    streamingStepOutputRef.current.clear()
    setStreamingText('')
    setStreamingReasoning('')
    setError(null)
    setCanRetry(false)
    hadMessagesRef.current = true
    stickToBottomRef.current = true
    const sendContext: ChatSendContext = {
      text,
      attachments: [...attachments],
      threadId: existingThread,
      runId: requestedRunId,
      persisted: false
    }
    retrySendRef.current = sendContext
    latestSendRef.current = sendContext
    cancelledThreadRef.current = null
    try {
      const model = requestModel || undefined
      if (model) void pushRecentModel(model, activeProviderId)
      const { threadId, runId } = await api.ai.chatSend({
        workspaceId: activeWorkspaceId,
        threadId: existingThread ?? undefined,
        runId: requestedRunId,
        text,
        providerId: activeProviderId,
        model,
        replaceLastExchange: replacement.replaceLastExchange,
        replaceRunId: replacement.replaceRunId ?? undefined,
        features: {
          deepThinking,
          ...(reasoningEffort ? { reasoningEffort } : {})
        },
        attachments: attachments.length > 0
          ? attachments.map((docId) => ({ type: 'document' as const, docId }))
          : undefined
      })
      if (disposedRef.current) {
        void api.ai.chatCancel(threadId).catch(() => undefined)
        return
      }
      if (activeRunIdRef.current === requestedRunId) {
        activeRunIdRef.current = runId
        setActiveRunId(runId)
      }
      const resolvedContext = { ...sendContext, threadId, runId, persisted: true }
      if (retrySendRef.current === sendContext) retrySendRef.current = resolvedContext
      if (latestSendRef.current === sendContext) latestSendRef.current = resolvedContext
      if (!existingThread) {
        setActiveThreadId(threadId)
        threadIdRef.current = threadId
      }
      if (cancelledRef.current) cancelThread(threadId)
      void fetchThreads()
    } catch (e) {
      if (disposedRef.current) return
      cancelledRef.current = false
      cancelledThreadRef.current = null
      activeRunIdRef.current = null
      setActiveRunId(null)
      setCanRetry(true)
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
    reasoningEffort,
    fetchThreads,
    cancelThread,
    t
  ])

  const handleRetry = useCallback(() => {
    const last = retrySendRef.current
    if (!last) return
    setMessages((prev) => {
      const idx = prev.findLastIndex((m) => m.role === 'user' && m.content === last.text)
      if (idx === -1) return prev
      return prev.filter((_, i) => i !== idx)
    })
    if (last.runId) {
      setTraceSteps((prev) => prev.filter((step) => step.runId !== last.runId))
    }
    void sendText(last.text, last.attachments, last.threadId, {
      replaceLastExchange: last.persisted,
      replaceRunId: last.persisted ? last.runId : null
    })
  }, [sendText])

  const clearError = useCallback(() => {
    retrySendRef.current = null
    setCanRetry(false)
    setError(null)
  }, [])

  const handleCancel = useCallback(() => {
    cancelledRef.current = true
    if (threadIdRef.current) cancelThread(threadIdRef.current)
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    setStreamingText(streamingTextRef.current)
    setStreamingReasoning(streamingReasoningRef.current)
  }, [cancelThread])

  const handleRegenerate = useCallback(() => {
    let text = ''
    let attachments: string[] = []
    let threadId = activeThreadId
    const latestSend = latestSendRef.current
    if (latestSend && latestSend.threadId === activeThreadId) {
      text = latestSend.text
      attachments = latestSend.attachments
      threadId = latestSend.threadId
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
      .sort((a, b) => a.startedAt - b.startedAt || a.seq - b.seq)
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
    void sendText(text, attachments, threadId, {
      replaceLastExchange: true,
      replaceRunId: lastRunId
    })
  }, [displayMessages, activeThreadId, traceSteps, sendText])

  return {
    messages, setMessages, traceSteps, setTraceSteps,
    streaming, streamingText, streamingReasoning, activeRunId, elapsedSeconds,
    error, setError, clearError, canRetry, loadingHistory, displayMessages,
    sendText, handleCancel, handleRetry, handleRegenerate,
    stickToBottomRef, threadIdRef, hadMessagesRef
  }
}
