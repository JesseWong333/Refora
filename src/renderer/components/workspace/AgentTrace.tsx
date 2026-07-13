import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CaretDown,
  CaretRight,
  Wrench,
  Robot,
  Pulse,
  CheckCircle,
  XCircle,
  CircleNotch,
  MagnifyingGlass,
  FileText,
  FileMagnifyingGlass,
  FilePlus,
  ClipboardText,
  FolderOpen,
  ArrowDown,
  ArrowUp
} from '@phosphor-icons/react'
import type { AgentTraceStep } from '../../../shared/ipc-types'

type TFunc = ReturnType<typeof useTranslation>['t']

interface ToolLabelResult {
  icon: string
  text: string
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

const TOOL_ICONS: Record<string, typeof MagnifyingGlass> = {
  search: MagnifyingGlass,
  read: FileText,
  summary: FileMagnifyingGlass,
  metadata: FileMagnifyingGlass,
  open: FolderOpen,
  report: ClipboardText,
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

  const StatusIcon = step.status === 'running' ? CircleNotch : step.status === 'error' ? XCircle : CheckCircle
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
      ? Robot
      : Pulse

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
              <CaretDown className="h-3 w-3 shrink-0 text-muted" />
            ) : (
              <CaretRight className="h-3 w-3 shrink-0 text-muted" />
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

  const SummaryIcon = isRunning ? CircleNotch : hasError ? XCircle : CheckCircle
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
        <CaretDown
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
