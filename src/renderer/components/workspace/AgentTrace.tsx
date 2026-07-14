import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CaretDown,
  Wrench,
  Robot,
  CheckCircle,
  XCircle,
  CircleNotch,
  MagnifyingGlass,
  FileText,
  FileMagnifyingGlass,
  FilePlus,
  ClipboardText,
  FolderOpen
} from '@phosphor-icons/react'
import type { AgentTraceStep } from '../../../shared/ipc-types'

type TFunc = ReturnType<typeof useTranslation>['t']

interface ToolLabelResult {
  icon: string
  text: string
}

function formatTokenCount(value: number): string {
  if (value < 1000) return String(value)
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}k`
}

function formatTraceValue(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed === 'string') return parsed
    return JSON.stringify(parsed, null, 2)
  } catch {
    return value
  }
}

function humanizeIdentifier(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDuration(step: AgentTraceStep): string | null {
  if (step.endedAt == null) return null
  const ms = Math.max(0, step.endedAt - step.startedAt)
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
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
  const running = step.status === 'running'

  switch (name) {
    case 'search_workspace_docs':
      return {
        icon: 'search',
        text: running
          ? t('workspace.chat.toolSearchWorkspace', 'Searching workspace…')
          : t('workspace.chat.toolSearchWorkspaceDone', 'Searched workspace')
      }
    case 'search_library':
      return {
        icon: 'search',
        text: running
          ? t('workspace.chat.toolSearchLibrary', 'Searching library…')
          : t('workspace.chat.toolSearchLibraryDone', 'Searched library')
      }
    case 'read_paper_fulltext': {
      const docId = typeof objParam.docId === 'string' ? objParam.docId : ''
      const offset = typeof objParam.offset === 'number' ? objParam.offset : 0
      const limit = typeof objParam.limit === 'number' ? objParam.limit : 8000
      const chunkIdx = Math.floor(offset / limit) + 1
      if (docId) {
        return {
          icon: 'read',
          text: running
            ? t('workspace.chat.toolReadingChunk', {
                chunk: chunkIdx,
                defaultValue: 'Reading document… (chunk {{chunk}})'
              })
            : t('workspace.chat.toolReadingChunkDone', {
                chunk: chunkIdx,
                defaultValue: 'Read document (chunk {{chunk}})'
              })
        }
      }
      return {
        icon: 'read',
        text: running
          ? t('workspace.chat.toolReading', 'Reading document…')
          : t('workspace.chat.toolReadingDone', 'Read document')
      }
    }
    case 'get_paper_summary':
      return {
        icon: 'summary',
        text: running
          ? t('workspace.chat.toolGetSummary', 'Getting summary…')
          : t('workspace.chat.toolGetSummaryDone', 'Retrieved summary')
      }
    case 'get_paper_metadata':
      return {
        icon: 'metadata',
        text: running
          ? t('workspace.chat.toolGetMetadata', 'Fetching metadata…')
          : t('workspace.chat.toolGetMetadataDone', 'Retrieved metadata')
      }
    case 'open_paper':
      return {
        icon: 'open',
        text: running
          ? t('workspace.chat.toolOpenPaper', 'Opening paper…')
          : t('workspace.chat.toolOpenPaperDone', 'Opened paper')
      }
    case 'generate_report':
      return {
        icon: 'report',
        text: running
          ? t('workspace.chat.toolGenerateReport', 'Generating report…')
          : t('workspace.chat.toolGenerateReportDone', 'Generated report')
      }
    case 'add_docs_to_workspace':
      return {
        icon: 'add',
        text: running
          ? t('workspace.chat.toolAddDocs', 'Adding to workspace…')
          : t('workspace.chat.toolAddDocsDone', 'Added to workspace')
      }
    case 'request_summary':
      return {
        icon: 'summary',
        text: running
          ? t('workspace.chat.toolRequestSummary', 'Requesting summary…')
          : t('workspace.chat.toolRequestSummaryDone', 'Requested summary')
      }
    default:
      return null
  }
}

const TOOL_ICONS: Record<string, typeof MagnifyingGlass> = {
  search: MagnifyingGlass,
  read: FileText,
  summary: FileMagnifyingGlass,
  metadata: FileMagnifyingGlass,
  open: FolderOpen,
  report: ClipboardText,
  add: FilePlus
}

function TraceStepRow({
  step,
  isLast,
  forceOpen,
  compact = false
}: {
  step: AgentTraceStep
  isLast: boolean
  forceOpen?: boolean
  compact?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (forceOpen !== undefined) setOpen(forceOpen)
  }, [forceOpen])
  const hasBody = !!(step.input || step.output)
  const duration = formatDuration(step)
  const toolLabel = formatToolLabel(step, t)

  const StatusIcon = step.status === 'running' ? CircleNotch : step.status === 'error' ? XCircle : CheckCircle
  const statusColor = step.status === 'error' ? 'text-error' : 'text-muted'
  const statusTitle =
    step.status === 'running'
      ? t('workspace.chat.traceRunning', 'Running')
      : step.status === 'error'
        ? t('workspace.chat.traceError', 'Error')
        : t('workspace.chat.traceDone', 'Done')

  const KindIcon = step.kind === 'tool'
    ? (toolLabel ? (TOOL_ICONS[toolLabel.icon] ?? Wrench) : Wrench)
    : Robot

  const displayText = toolLabel
    ? toolLabel.text
    : step.kind === 'llm'
      ? step.status === 'running'
        ? t('workspace.chat.traceLlmCall', 'Model thinking…')
        : t('workspace.chat.traceLlmDone', 'Completed')
      : step.name
        ? humanizeIdentifier(step.name)
        : t('workspace.chat.traceTool', 'Tool')

  const kindLabel = step.kind === 'llm'
    ? t('workspace.chat.traceLlm', 'Model')
    : t('workspace.chat.traceTool', 'Tool')

  return (
    <div className={`agent-trace-step trace-fade-in ${compact ? 'agent-trace-step-compact' : ''}`}>
      {!compact && (
        <div className="agent-trace-rail">
          <span className={`agent-trace-status-dot agent-trace-status-${step.status}`}>
            <StatusIcon
              className={`h-3.5 w-3.5 shrink-0 ${statusColor} ${step.status === 'running' ? 'animate-spin' : ''}`}
            />
          </span>
          {!isLast && <div className="agent-trace-connector" />}
        </div>
      )}
      <div className={`min-w-0 flex-1 ${isLast ? '' : 'pb-2'}`}>
        <button
          type="button"
          className={`agent-trace-step-trigger ${hasBody ? 'agent-trace-step-trigger-interactive' : ''}`}
          onClick={() => hasBody && setOpen((v) => !v)}
          disabled={!hasBody}
          aria-expanded={open}
          title={statusTitle}
        >
          {(!compact || step.kind === 'tool') && (
            <span className="agent-trace-kind-icon">
              <KindIcon className="h-3.5 w-3.5 text-muted" />
            </span>
          )}
          <span className="agent-trace-step-copy min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="agent-trace-step-title truncate text-xs font-medium text-foreground">{displayText}</span>
              {(!compact || step.status !== 'done') && (
                <span className={`agent-trace-status-label agent-trace-status-label-${step.status}`}>
                  {statusTitle}
                </span>
              )}
            </span>
            {!compact && (
              <span className="agent-trace-kind-label mt-0.5 block text-caption text-muted">{kindLabel}</span>
            )}
          </span>
          {!compact && step.kind === 'llm' && step.totalTokens != null && (
            <span
              className="agent-trace-metric"
              title={t('workspace.chat.tokenUsage', 'Tokens')}
            >
              {formatTokenCount(step.inputTokens ?? 0)}
              <span aria-hidden="true">/</span>
              {formatTokenCount(step.outputTokens ?? 0)}
            </span>
          )}
          {duration && (!compact || step.kind === 'llm') && (
            <span className="agent-trace-metric">{duration}</span>
          )}
          {hasBody && (
            <CaretDown
              className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${compact ? (open ? 'rotate-180' : '') : (open ? '' : '-rotate-90')}`}
            />
          )}
        </button>
        {open && hasBody && (
          <div className="agent-trace-details">
            {step.input && (
              <div className="agent-trace-detail-card">
                <p className="agent-trace-detail-label">
                  {t('workspace.chat.traceInput', 'Input')}
                </p>
                <pre className="agent-trace-detail-value">
                  {formatTraceValue(step.input)}
                </pre>
              </div>
            )}
            {step.output && (
              <div className="agent-trace-detail-card">
                <p className="agent-trace-detail-label">
                  {t('workspace.chat.traceOutput', 'Output')}
                </p>
                <pre className="agent-trace-detail-value">
                  {formatTraceValue(step.output)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function AgentTraceStepItem({ step }: { step: AgentTraceStep }) {
  if (step.kind !== 'llm' && step.kind !== 'tool') return null
  return (
    <div className="agent-trace-inline-step" data-timeline-kind={step.kind}>
      <TraceStepRow step={step} isLast compact />
    </div>
  )
}

export function AgentTracePanel({
  steps,
  streaming
}: {
  steps: AgentTraceStep[]
  streaming: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [expandAll, setExpandAll] = useState<boolean | null>(null)
  const visible = steps.filter((s) => s.kind === 'llm' || s.kind === 'tool')
  const totalTokensSum = visible.reduce((sum, s) => sum + (s.totalTokens ?? 0), 0)
  const hasTokenData = visible.some((s) => s.totalTokens != null)
  const isRunning = streaming || visible.some((s) => s.status === 'running')
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

  const SummaryIcon = isRunning ? CircleNotch : hasError ? XCircle : CheckCircle
  const summaryColor = isRunning ? 'text-accent' : hasError ? 'text-error' : 'text-muted'
  const summaryLabel = isRunning
    ? t('workspace.chat.traceRunningLabel', 'running…')
    : totalDuration != null
      ? `${(totalDuration / 1000).toFixed(1)}s`
      : null

  return (
    <section className={`agent-trace-panel agent-trace-panel-${isRunning ? 'running' : hasError ? 'error' : 'done'}`}>
      <div className="agent-trace-panel-header">
        <button
          type="button"
          className="agent-trace-panel-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className={`agent-trace-summary-icon ${isRunning ? 'agent-trace-summary-icon-running' : ''}`}>
            <SummaryIcon
              className={`h-3.5 w-3.5 shrink-0 ${summaryColor} ${isRunning ? 'animate-spin' : ''}`}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">
                {t('workspace.chat.trace', 'Agent activity')}
              </span>
              <span className="agent-trace-count">
                {visible.length > 0 ? visible.length : streaming ? '…' : 0}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-caption text-muted">
              {isRunning
                ? t('workspace.chat.traceFollowing', 'Following the current run')
                : hasError
                  ? t('workspace.chat.traceCompletedError', 'Completed with an error')
                  : t('workspace.chat.traceCompleted', 'Run details')}
            </span>
          </span>
          {summaryLabel && (
            <span className={`agent-trace-summary-badge ${isRunning ? 'agent-trace-summary-badge-running' : ''}`}>
              {summaryLabel}
            </span>
          )}
          {hasTokenData && !isRunning && (
            <span className="agent-trace-summary-badge">
              {t('workspace.chat.tokenTotal', { count: totalTokensSum })}
            </span>
          )}
          <CaretDown
            className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? '' : '-rotate-90'}`}
          />
        </button>
        {visible.length > 0 && open && (
          <button
            type="button"
            className="agent-trace-expand-all"
            onClick={() => setExpandAll(expandAll === null ? true : !expandAll)}
          >
            {expandAll ? t('workspace.chat.collapseAll', 'Collapse all') : t('workspace.chat.expandAll', 'Expand all')}
          </button>
        )}
      </div>
      {open && (
        <div ref={contentRef} className="agent-trace-steps">
          {visible.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted">
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
    </section>
  )
}
