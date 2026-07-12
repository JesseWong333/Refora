import { useState, useEffect, useMemo, memo, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  Copy,
  RotateCcw,
  Bot,
  Sparkles,
  ArrowDown
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS, REHYPE_PLUGINS, createMarkdownComponents, urlTransform } from '../../utils/markdown'
import { useDocumentStore } from '../../store/documentStore'
import { api } from '../../ipc'
import { Button as UiButton } from '../ui'
import { AgentTracePanel } from './AgentTrace'
import type { AgentTraceStep, AiProvider, ChatMessage } from '../../../shared/ipc-types'

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

const MARKDOWN_COMPONENTS = createMarkdownComponents({
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
})

const StreamingMarkdown = memo(function StreamingMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS} urlTransform={urlTransform}>{content}</ReactMarkdown>
  )
})

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

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

export interface ChatMessagesProps {
  messages: ChatMessage[]
  traceSteps: AgentTraceStep[]
  streaming: boolean
  streamingText: string
  streamingReasoning: string
  elapsedSeconds: number
  loadingHistory: boolean
  providers: AiProvider[]
  onRegenerate: () => void
  onSuggestionClick: (text: string) => void
  scrollRef: React.RefObject<HTMLDivElement | null>
  inputAreaHeight: number
  stickToBottomRef: React.MutableRefObject<boolean>
}

export default function ChatMessages({
  messages,
  traceSteps,
  streaming,
  streamingText,
  streamingReasoning,
  elapsedSeconds,
  loadingHistory,
  providers,
  onRegenerate,
  onSuggestionClick,
  scrollRef,
  inputAreaHeight,
  stickToBottomRef
}: ChatMessagesProps) {
  const { t } = useTranslation()
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const displayMessages = useMemo(() => messages.filter((m) => m.role !== 'tool'), [messages])
  const showEmpty = displayMessages.length === 0 && !streamingText && !streamingReasoning

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

  return (
    <>
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
                      onClick={() => onSuggestionClick(s.text)}
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
                                <button
                                  type="button"
                                  className="shrink-0 rounded p-1 text-muted opacity-40 transition-opacity hover:text-foreground hover:opacity-100"
                                  onClick={() => onRegenerate()}
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
    </>
  )
}
