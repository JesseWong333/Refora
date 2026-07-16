import { randomUUID } from 'node:crypto'
import { type BrowserWindow } from 'electron'
import { DynamicTool, DynamicStructuredTool } from '@langchain/core/tools'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { GraphRecursionError } from '@langchain/langgraph'
import { z } from 'zod'
import type { Repositories } from '../db/repositories'
import type {
  AgentTraceStep,
  AgentTraceStepKind,
  AgentTraceStepStatus,
  AiProvider,
  AiReasoningEffort,
  AiSummaryContent,
  ChatAttachment,
  ChatMessage,
  ChatSendRequest,
  Document
} from '../../shared/ipc-types'
import type { AiProvidersService } from './aiProviders'
import type { PdfTextService } from './pdfText'
import type { AiSummaryService } from './aiSummary'
import {
  emitAiChatToken,
  emitAiChatReasoning,
  emitAiChatDone,
  emitAiChatError,
  emitAiChatTrace,
  emitAiChatTitleUpdated,
  emitAiReportCreated,
  emitWorkspaceItemsChanged
} from '../ipc/events'
import { logger } from './logger'
import { createProviderChatModel } from './providerModel'
import { truncateHistoryByTokens } from './tokenEstimate'
import { deriveThreadTitle } from './deriveThreadTitle'
import { generateThreadTitle } from './generateThreadTitle'
import { historyToMessages, truncateOutput } from './chatHistoryMessages'
import { resolveDeepThinkingMode, type DeepThinkingMode } from '../../shared/deepThinking'
import { inferModelCapabilities } from '../../shared/providerCatalog'
import { openPdf } from './pdfOpen'

const MAX_FULLTEXT_CHARS = 8000
const HISTORY_TOKEN_BUDGET = 8000
const HISTORY_MIN_MESSAGES = 2
const HISTORY_MAX_MESSAGES = 50
const TRACE_TEXT_LIMIT = 4000
const WORKSPACE_CONTEXT_DOC_LIMIT = 80
const WORKSPACE_CONTEXT_CHAR_LIMIT = 6000
const MAX_RECURSION_LIMIT = 50
const RECURSION_LIMIT_MESSAGE =
  'The agent reached the maximum number of reasoning steps without completing. ' +
  'Please try refining or simplifying your request.'

const AI_REASONING_EFFORTS = new Set<AiReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
])

function normalizeReasoningEffort(
  value: unknown,
  fallback: AiReasoningEffort
): AiReasoningEffort {
  return typeof value === 'string' && AI_REASONING_EFFORTS.has(value as AiReasoningEffort)
    ? value as AiReasoningEffort
    : fallback
}

const SYSTEM_PROMPT =
  'You are a research assistant working in a workspace of academic papers. ' +
  'Papers live in the user library and are indexed in the local database (not as a filesystem folder for this chat). ' +
  'Use the workspace paper catalog in this system message for docId, title, and whether a cached AI summary exists. ' +
  'Use tools to search, read full text, and retrieve summaries when you need more detail. ' +
  'Prefer get_paper_summary when hasSummary is true; use read_paper_fulltext only when summary is missing or insufficient. ' +
  'When the user asks for a report, survey, or comparison, call generate_report to pin a structured report to the board. ' +
  'Use search_library for full-text search across the entire library, not just the workspace. ' +
  'When the user wants papers added to this workspace, first use search_library to find them, then call add_docs_to_workspace with the docIds. ' +
  'When the user asks for a summary or overview, use read_paper_fulltext to read the paper and summarize it yourself. Only call request_summary to pre-generate a cached summary for future use - it returns immediately without the actual summary. ' +
  'When the user message includes [Attached papers], prioritize those docIds in your analysis. ' +
  'If the workspace catalog is empty, suggest using search_library and add_docs_to_workspace rather than asking the user to add papers manually. ' +
  'Reference papers by their docId. ' +
  'Full text: use read_paper_fulltext with offset/limit; it returns a window with nextOffset - follow nextOffset until done or you have enough evidence. Do not assume the first window is the whole paper. When quoting, include the offset range you used. ' +
  'Citations: cite papers as markdown links [Title](refora://doc/<docId>). Prefer titles users can recognize. ' +
  'Never invent docIds; only use ids from the workspace catalog, tools, or attachments.'

const workspaceContextCache = new Map<string, { context: string; docIdKey: string; ts: number }>()
const WORKSPACE_CONTEXT_TTL_MS = 60_000

function buildWorkspaceContext(repos: Repositories, workspaceId: string): string {
  const items = repos.workspaceItems.list(workspaceId).filter((i) => i.kind === 'document')
  const docs: Array<{
    docId: string
    title: string
    authors: string | null
    year: string | null
    hasSummary: boolean
  }> = []
  for (const item of items) {
    if (!item.docId) continue
    const doc = repos.documents.get(item.docId)
    if (!doc) continue
    const summary = repos.aiSummaries.getSummary(doc.id)
    docs.push({
      docId: doc.id,
      title: doc.title ?? doc.fileName,
      authors: doc.authors,
      year: doc.year,
      hasSummary: !!(summary && summary.content)
    })
  }
  const summaryKey = docs.map((d) => d.docId + ':' + (d.hasSummary ? '1' : '0')).join(',')
  const cached = workspaceContextCache.get(workspaceId)
  const now = Date.now()
  if (cached && cached.docIdKey === summaryKey && now - cached.ts < WORKSPACE_CONTEXT_TTL_MS) {
    return cached.context
  }

  if (docs.length === 0) {
    return (
      'Workspace paper catalog: (empty). No documents are pinned to this workspace yet. ' +
      'Tell the user to add papers to the workspace board before answering paper-specific questions.'
    )
  }

  const total = docs.length
  const listed = docs.slice(0, WORKSPACE_CONTEXT_DOC_LIMIT)
  const lines = listed.map((d, i) => {
    const meta = [d.authors, d.year].filter((x) => x && String(x).trim()).join(', ')
    const summaryFlag = d.hasSummary ? 'hasSummary=true' : 'hasSummary=false'
    const title = d.title.replace(/\s+/g, ' ').trim()
    return meta
      ? `${i + 1}. docId=${d.docId} | ${title} | ${meta} | ${summaryFlag}`
      : `${i + 1}. docId=${d.docId} | ${title} | ${summaryFlag}`
  })

  let body = lines.join('\n')
  let omitted = total - listed.length
  if (body.length > WORKSPACE_CONTEXT_CHAR_LIMIT) {
    let cut = body.slice(0, WORKSPACE_CONTEXT_CHAR_LIMIT)
    const lastNl = cut.lastIndexOf('\n')
    if (lastNl > 0) cut = cut.slice(0, lastNl)
    const kept = cut.split('\n').filter((l) => l.length > 0).length
    omitted = total - kept
    body = cut
  }

  const header =
    `Workspace paper catalog (${total} document${total === 1 ? '' : 's'}` +
    (omitted > 0 ? `, showing first ${total - omitted}; use search_workspace_docs for the rest` : '') +
    '):'
  const result = `${header}\n${body}`
  workspaceContextCache.set(workspaceId, { context: result, docIdKey: summaryKey, ts: now })
  return result
}

function parseSourceDocIds(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  let parsed: unknown = null
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    parsed = null
  }
  if (Array.isArray(parsed)) {
    return parsed.filter((v): v is string => typeof v === 'string')
  }
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function truncateTraceText(value: string | null | undefined): string | null {
  if (value == null) return null
  return truncateOutput(value, TRACE_TEXT_LIMIT)
}

function buildAttachmentContext(
  repos: Repositories,
  attachments: ChatAttachment[],
  workspaceId: string
): string {
  const items = repos.workspaceItems.list(workspaceId).filter((i) => i.kind === 'document')
  const wsDocIds = new Set(items.map((i) => i.docId).filter((d): d is string => d !== null))
  const valid = attachments.filter((a) => a.type === 'document' && wsDocIds.has(a.docId)).slice(0, 8)
  const lines = valid.map((a) => {
    const doc = repos.documents.get(a.docId)
    if (!doc) return `- docId: ${a.docId} (not found)`
    const hasSummary = !!(repos.aiSummaries.getSummary(a.docId)?.content)
    return `- docId: ${doc.id}\n  title: ${doc.title ?? doc.fileName}\n  authors: ${doc.authors ?? ''}\n  year: ${doc.year ?? ''}\n  hasSummary: ${hasSummary}`
  })
  if (valid.length < attachments.length) {
    lines.push(`(Note: ${attachments.length - valid.length} attachment(s) were not in this workspace and were omitted.)`)
  }
  return lines.join('\n')
}

function stringifyTraceValue(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return truncateTraceText(value)
  try {
    return truncateTraceText(JSON.stringify(value))
  } catch {
    return truncateTraceText(String(value))
  }
}

function extractToolName(event: {
  name?: string
  data?: Record<string, unknown>
}): string | null {
  if (typeof event.name === 'string' && event.name.length > 0) return event.name
  const data = event.data
  if (!data) return null
  if (typeof data.name === 'string' && data.name.length > 0) return data.name
  return null
}

function extractToolInput(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null
  if ('input' in data) return stringifyTraceValue(data.input)
  if ('inputs' in data) return stringifyTraceValue(data.inputs)
  return null
}

function extractToolOutput(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null
  if ('output' in data) return stringifyTraceValue(data.output)
  if ('outputs' in data) return stringifyTraceValue(data.outputs)
  return null
}

function extractToolCallId(
  event: { run_id?: string },
  data: Record<string, unknown> | undefined
): string {
  if (data) {
    if (typeof data.tool_call_id === 'string' && data.tool_call_id) return data.tool_call_id
    const input = data.input
    if (input && typeof input === 'object' && 'tool_call_id' in input) {
      const v = (input as Record<string, unknown>).tool_call_id
      if (typeof v === 'string' && v) return v
    }
    if (typeof data.id === 'string' && data.id) return data.id
  }
  if (typeof event.run_id === 'string' && event.run_id) return event.run_id
  return randomUUID()
}

interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

function extractTokenUsage(data: Record<string, unknown> | undefined): TokenUsage | null {
  if (!data) return null
  const output = data.output as Record<string, unknown> | undefined
  if (!output || typeof output !== 'object') return null

  const usageMetadata = output.usage_metadata as Record<string, unknown> | undefined
  if (usageMetadata && typeof usageMetadata === 'object') {
    const inputTokens = usageMetadata.input_tokens
    const outputTokens = usageMetadata.output_tokens
    const totalTokens = usageMetadata.total_tokens
    if (typeof inputTokens === 'number' && typeof outputTokens === 'number') {
      return {
        inputTokens,
        outputTokens,
        totalTokens:
          typeof totalTokens === 'number' ? totalTokens : inputTokens + outputTokens
      }
    }
  }

  const responseMetadata = output.response_metadata as Record<string, unknown> | undefined
  const tokenUsage = (responseMetadata?.token_usage ??
    (output.additional_kwargs as Record<string, unknown> | undefined)?.token_usage) as
    | Record<string, unknown>
    | undefined
  if (tokenUsage && typeof tokenUsage === 'object') {
    const promptTokens = tokenUsage.prompt_tokens
    const completionTokens = tokenUsage.completion_tokens
    const totalTokens = tokenUsage.total_tokens
    if (typeof promptTokens === 'number' && typeof completionTokens === 'number') {
      return {
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        totalTokens:
          typeof totalTokens === 'number' ? totalTokens : promptTokens + completionTokens
      }
    }
  }

  return null
}

export function createAiAgentService(
  repos: Repositories,
  win: () => BrowserWindow | null,
  aiProvidersService: AiProvidersService,
  pdfTextService: PdfTextService,
  aiSummaryService: AiSummaryService
) {
  const getWin = (): BrowserWindow | null => {
    const w = win()
    if (!w || w.isDestroyed()) return null
    return w
  }

  let destroyed = false
  const activeRuns = new Map<string, AbortController>()

  function buildTools(req: ChatSendRequest, providerModel: string, signal: AbortSignal) {
    const searchWorkspaceDocs = new DynamicTool({
      name: 'search_workspace_docs',
      description:
        'Search documents in the current workspace by title, authors, abstract, or keywords (full-text). ' +
        'Returns JSON [{docId, title, authors, year, hasSummary}]. Pass an empty string to list all workspace documents.',
      func: async (query: string): Promise<string> => {
        if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
        const items = repos.workspaceItems
          .list(req.workspaceId)
          .filter((i) => i.kind === 'document')
        const workspaceDocIds = new Set(
          items.map((i) => i.docId).filter((d): d is string => d !== null)
        )
        const q = query.trim()
        if (!q) {
          const docs: Document[] = []
          for (const id of workspaceDocIds) {
            const d = repos.documents.get(id)
            if (d) docs.push(d)
          }
          const result = docs.slice(0, 50).map((d) => ({
            docId: d.id,
            title: d.title ?? d.fileName,
            authors: d.authors ?? '',
            year: d.year ?? '',
            hasSummary: !!(repos.aiSummaries.getSummary(d.id)?.content)
          }))
          return JSON.stringify(result)
        }
        const hits = repos.documents.search(q)
        const filtered = hits.filter((d) => workspaceDocIds.has(d.id))
        const result = filtered.slice(0, 30).map((d) => ({
          docId: d.id,
          title: d.title ?? d.fileName,
          authors: d.authors ?? '',
          year: d.year ?? '',
          hasSummary: !!(repos.aiSummaries.getSummary(d.id)?.content)
        }))
        return JSON.stringify(result)
      }
    })

    const readPaperFulltext = new DynamicStructuredTool({
      name: 'read_paper_fulltext',
      description:
        'Read a chunk of the full extracted text of a paper by its docId. ' +
        'Use offset (character position, default 0) and limit (max characters per call, 500-12000, default 8000) to paginate. ' +
        'Returns JSON with {docId, title, offset, limit, totalChars, nextOffset, chunkIndex, chunkCount, text}. ' +
        'If nextOffset is not null, call again with offset=nextOffset to read the next chunk. ' +
        'When nextOffset is null you have reached the end of the paper.',
      schema: z.object({
        docId: z.string().describe('The docId of the paper to read'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe('Character offset to start reading from'),
        limit: z
          .number()
          .int()
          .min(500)
          .max(12000)
          .optional()
          .default(MAX_FULLTEXT_CHARS)
          .describe('Max characters to return in this chunk')
      }),
      func: async ({ docId, offset, limit }) => {
        if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
        const id = docId.trim()
        const doc = repos.documents.get(id)
        if (!doc) {
          return JSON.stringify({ error: 'Document not found', docId: id })
        }
        let text: string
        try {
          if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
          text = await pdfTextService.getOrExtract(id)
          if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
        } catch {
          return JSON.stringify({ error: 'Failed to extract text', docId: id })
        }
        const clampedLimit = Math.min(12000, Math.max(500, limit ?? MAX_FULLTEXT_CHARS))
        const totalChars = text.length
        const startOffset = offset ?? 0
        if (startOffset >= totalChars) {
          return JSON.stringify({
            docId: id,
            title: doc.title ?? doc.fileName,
            offset: startOffset,
            limit: clampedLimit,
            totalChars,
            nextOffset: null,
            chunkIndex: Math.floor(startOffset / clampedLimit),
            chunkCount: Math.ceil(totalChars / clampedLimit),
            text: '',
            message: 'offset past end'
          })
        }
        const slicedText = text.slice(startOffset, startOffset + clampedLimit)
        const nextOffset =
          startOffset + slicedText.length < totalChars ? startOffset + slicedText.length : null
        return JSON.stringify({
          docId: id,
          title: doc.title ?? doc.fileName,
          offset: startOffset,
          limit: clampedLimit,
          totalChars,
          nextOffset,
          chunkIndex: Math.floor(startOffset / clampedLimit),
          chunkCount: Math.ceil(totalChars / clampedLimit),
          text: slicedText
        })
      }
    })

    const getPaperSummary = new DynamicTool({
      name: 'get_paper_summary',
      description:
        'Get the cached AI summary of a paper by its docId. Returns a JSON summary object, or a notice that no summary is available yet.',
      func: async (docId: string) => {
        if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
        const summary = repos.aiSummaries.getSummary(docId.trim())
        if (!summary || !summary.content) return 'No summary available yet.'
        const content: AiSummaryContent = summary.content
        return JSON.stringify(content)
      }
    })

    const generateReport = new DynamicStructuredTool({
      name: 'generate_report',
      description:
        'Create and pin a structured report to the workspace board. ' +
        'Use this when the user asks for a report, survey, or comparison. ' +
        'sourceDocIds accepts a comma-separated list or a JSON array string of docIds.',
      schema: z.object({
        title: z.string().describe('Title of the report'),
        contentMd: z.string().describe('Markdown content of the report'),
        sourceDocIds: z
          .string()
          .describe('Comma-separated list or JSON array string of source docIds')
      }),
      func: async ({ title, contentMd, sourceDocIds }) => {
        if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
        const allowedDocIds = new Set(
          repos.workspaceItems
            .list(req.workspaceId)
            .filter((item) => item.kind === 'document' && item.docId)
            .map((item) => item.docId as string)
        )
        const ids = parseSourceDocIds(sourceDocIds).filter((id) => allowedDocIds.has(id))
        const report = repos.transaction(() => {
          const created = repos.aiReports.create({
            workspaceId: req.workspaceId,
            title,
            contentMd,
            sourceDocIds: ids,
            model: providerModel
          })
          repos.workspaceItems.add(req.workspaceId, 'report', [created.id])
          return created
        })
        const w = getWin()
        if (w) {
          emitAiReportCreated(w, report)
          emitWorkspaceItemsChanged(w, { workspaceId: req.workspaceId, reason: 'other' })
        }
        return 'Report created and pinned to the board.'
      }
    })

    const addDocsToWorkspace = new DynamicStructuredTool({
      name: 'add_docs_to_workspace',
      description:
        'Add documents from the library to the current workspace board. ' +
        'Pass docIds as a comma-separated list or JSON array string. ' +
        'Returns JSON with added, alreadyInWorkspace, and missing arrays.',
      schema: z.object({
        docIds: z
          .string()
          .describe('Comma-separated list or JSON array string of docIds to add')
      }),
      func: async ({ docIds }) => {
        if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
        const ids = parseSourceDocIds(docIds)
        if (ids.length === 0) {
          return JSON.stringify({
            added: [],
            alreadyInWorkspace: [],
            missing: [],
            error: 'No docIds provided.'
          })
        }
        const existingItems = repos.workspaceItems
          .list(req.workspaceId)
          .filter((i) => i.kind === 'document')
          .map((i) => i.docId)
          .filter((d): d is string => d !== null)
        const existingSet = new Set(existingItems)
        const added: string[] = []
        const alreadyInWorkspace: string[] = []
        const missing: string[] = []
        const validIds: string[] = []
        for (const id of ids) {
          const doc = repos.documents.get(id)
          if (!doc) {
            missing.push(id)
            continue
          }
          if (existingSet.has(id)) {
            alreadyInWorkspace.push(id)
            continue
          }
          validIds.push(id)
        }
        if (validIds.length > 0) {
          repos.workspaceItems.add(req.workspaceId, 'document', validIds)
          added.push(...validIds)
          const w = getWin()
          if (w) {
            emitWorkspaceItemsChanged(w, {
              workspaceId: req.workspaceId,
              reason: 'agent_add_docs',
              docIds: added
            })
          }
        }
        return JSON.stringify({ added, alreadyInWorkspace, missing })
      }
    })

    const requestSummary = new DynamicStructuredTool({
      name: 'request_summary',
      description:
        'Queues background AI summary generation for a paper to cache it for future use. ' +
        'Does NOT return a summary when none exists - it returns status queued immediately. ' +
        'For an immediate summary, use read_paper_fulltext to read the paper and summarize it yourself.',
      schema: z.object({
        docId: z.string().describe('The docId of the paper to summarize')
      }),
      func: async ({ docId }) => {
        if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
        const doc = repos.documents.get(docId.trim())
        if (!doc) {
          return JSON.stringify({ status: 'error', message: 'Document not found.' })
        }
        const existing = repos.aiSummaries.getSummary(docId.trim())
        if (existing && existing.content) {
          return JSON.stringify({ status: 'ready', summary: existing.content })
        }
        aiSummaryService.summarize(docId.trim())
        return JSON.stringify({ status: 'queued', docId: docId.trim() })
      }
    })

    const searchLibrary = new DynamicTool({
      name: 'search_library',
      description:
        'Search the entire document library by full-text query. ' +
        'Returns a JSON array of objects [{docId, title, authors, year}]. ' +
        'Use this when the user asks about papers that may not be in the current workspace.',
      func: async (query: string) => {
        if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
        const q = query.trim()
        if (!q) return '[]'
        const results = repos.documents.search(q).slice(0, 20)
        return JSON.stringify(
          results.map((d) => ({
            docId: d.id,
            title: d.title ?? d.fileName,
            authors: d.authors,
            year: d.year
          }))
        )
      }
    })

    const getPaperMetadata = new DynamicTool({
      name: 'get_paper_metadata',
      description:
        'Get full metadata of a paper by its docId. Returns a JSON object with title, authors, year, venue, abstract, keywords, doi, url, and other fields.',
      func: async (docId: string) => {
        if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
        const doc = repos.documents.get(docId.trim())
        if (!doc) return 'Document not found.'
        return JSON.stringify({
          docId: doc.id,
          title: doc.title,
          authors: doc.authors,
          year: doc.year,
          venue: doc.venue,
          volume: doc.volume,
          issue: doc.issue,
          pages: doc.pages,
          abstract: doc.abstract,
          keywords: doc.keywords,
          doi: doc.doi,
          url: doc.url
        })
      }
    })

    const openPaper = new DynamicTool({
      name: 'open_paper',
      description:
        'Open a paper PDF in the system default viewer by its docId. Use when the user wants to view or read a paper.',
      func: async (docId: string) => {
        if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
        const id = docId.trim()
        const wsItems = repos.workspaceItems.list(req.workspaceId).filter((i) => i.kind === 'document')
        const wsDocIds = new Set(wsItems.map((i) => i.docId).filter((d): d is string => d !== null))
        if (!wsDocIds.has(id)) {
          return 'Document is not in the current workspace. Use search_workspace_docs to find papers in this workspace.'
        }
        try {
          const doc = await openPdf(repos, getWin(), id)
          return `Opened: ${doc.title ?? doc.fileName}`
        } catch (e) {
          return `Failed to open: ${e instanceof Error ? e.message : String(e)}`
        }
      }
    })

    return [
      searchWorkspaceDocs,
      searchLibrary,
      readPaperFulltext,
      getPaperSummary,
      getPaperMetadata,
      openPaper,
      generateReport,
      addDocsToWorkspace,
      requestSummary
    ]
  }

  function createTraceRecorder(threadId: string, runId: string) {
    let seq = 0
    const openByKey = new Map<string, string>()

    function emitStep(step: AgentTraceStep): void {
      const w = getWin()
      if (w) emitAiChatTrace(w, { threadId, runId, step })
    }

    function start(
      kind: AgentTraceStepKind,
      name: string | null,
      input: string | null,
      keys: string[] = []
    ): AgentTraceStep {
      const step = repos.agentTraces.addStep({
        threadId,
        runId,
        kind,
        name,
        input,
        output: null,
        status: 'running',
        startedAt: Date.now(),
        endedAt: null,
        seq: seq++
      })
      for (const key of keys) openByKey.set(key, step.id)
      emitStep(step)
      return step
    }

    function finish(
      id: string,
      status: AgentTraceStepStatus,
      output: string | null,
      usage?: TokenUsage | null
    ): AgentTraceStep | null {
      for (const [k, v] of openByKey) {
        if (v === id) openByKey.delete(k)
      }
      const step = repos.agentTraces.updateStep(id, {
        status,
        output,
        endedAt: Date.now(),
        ...(usage
          ? {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens
            }
          : {})
      })
      if (step) emitStep(step)
      return step
    }

    function finishByKeys(
      keys: string[],
      status: AgentTraceStepStatus,
      output: string | null,
      usage?: TokenUsage | null
    ): AgentTraceStep | null {
      for (const key of keys) {
        const id = openByKey.get(key)
        if (id) return finish(id, status, output, usage)
      }
      return null
    }

    function recordSnapshot(
      kind: AgentTraceStepKind,
      name: string | null,
      status: AgentTraceStepStatus,
      output: string | null
    ): AgentTraceStep {
      const now = Date.now()
      const step = repos.agentTraces.addStep({
        threadId,
        runId,
        kind,
        name,
        input: null,
        output,
        status,
        startedAt: now,
        endedAt: now,
        seq: seq++
      })
      emitStep(step)
      return step
    }

    function failOpen(message: string): void {
      const ids = [...new Set(openByKey.values())]
      for (const id of ids) finish(id, 'error', message)
    }

    return { start, finish, finishByKeys, recordSnapshot, failOpen }
  }

  async function run(req: ChatSendRequest, threadId: string, requestedRunId?: string): Promise<void> {
    if (destroyed) return
    const w = getWin()
    if (!w) return

    const runId = requestedRunId?.trim() || randomUUID()

    const existingController = activeRuns.get(threadId)
    if (existingController) {
      existingController.abort()
    }

    const controller = new AbortController()
    activeRuns.set(threadId, controller)
    const trace = createTraceRecorder(threadId, runId)
    const runStep = trace.start('run', 'agent_run', null)

    try {
      repos.chat.addMessage(threadId, 'user', req.text)

      const existingThread = repos.chat.getThread(threadId)
      if (existingThread && !existingThread.title) {
        repos.chat.updateTitle(threadId, deriveThreadTitle(req.text))
      }

      const pid = req.providerId || repos.settings.get<string>('activeProviderId', '')
      if (!pid) {
        const message = 'No AI provider configured'
        trace.finish(runStep.id, 'error', message)
        emitAiChatError(w, { threadId, message, runId })
        return
      }

      let provider: AiProvider
      let key: string
      try {
        provider = aiProvidersService.getProvider(pid)
        key = aiProvidersService.getDecryptedKey(pid)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to resolve AI provider'
        trace.finish(runStep.id, 'error', message)
        emitAiChatError(w, { threadId, message, runId })
        return
      }

      const modelId = (req.model && req.model.trim()) || provider.model
      const requestedReasoningEffort = req.features?.reasoningEffort
      const reasoningEffort = provider.reasoningControl === 'none'
        ? 'none'
        : normalizeReasoningEffort(requestedReasoningEffort, provider.reasoningEffort)
      const deepThinking = requestedReasoningEffort !== undefined
        ? reasoningEffort !== 'none'
        : req.features?.deepThinking === true
      const supportsNativeReasoning = inferModelCapabilities(
        provider.presetId,
        modelId
      ).supportsReasoning
      const thinkingMode: DeepThinkingMode = deepThinking
        ? supportsNativeReasoning
          ? 'native'
          : resolveDeepThinkingMode(modelId)
        : 'none'
      const workspaceContext = buildWorkspaceContext(repos, req.workspaceId)
      const systemPrompt = [
        SYSTEM_PROMPT,
        thinkingMode === 'prompt' ? 'Prefer careful multi-step reasoning before answering.' : '',
        workspaceContext
      ]
        .filter((s) => s.length > 0)
        .join('\n\n')

      const llm = createProviderChatModel({
        provider,
        apiKey: key,
        modelId,
        streaming: true,
        deepThinking,
        reasoningEffort
      })

      const tools = buildTools(req, modelId, controller.signal)
      const agent = createReactAgent({ llm, tools })

      const allHistory = repos.chat.listMessages(threadId)
      const isFirstExchange = allHistory.length <= 1
      const truncatedHistory = truncateHistoryByTokens(
        allHistory as ChatMessage[],
        {
          maxTokens: HISTORY_TOKEN_BUDGET,
          minMessages: HISTORY_MIN_MESSAGES,
          maxMessages: HISTORY_MAX_MESSAGES
        }
      ) as ChatMessage[]
      const historyMsgs = historyToMessages(truncatedHistory)
      const inputMsgs = [new SystemMessage(systemPrompt), ...historyMsgs]

      if (req.attachments?.length) {
        const lastIdx = inputMsgs.length - 1
        const lastMsg = inputMsgs[lastIdx]
        if (lastMsg instanceof HumanMessage && typeof lastMsg.content === 'string') {
          const attachmentBlock = buildAttachmentContext(repos, req.attachments, req.workspaceId)
          inputMsgs[lastIdx] = new HumanMessage(
            `${lastMsg.content}\n\n[Attached papers]\n${attachmentBlock}`
          )
        }
      }

      let finalText = ''
      let tracedMessageText = ''
      const collectedToolCalls: Array<{ name: string; toolCallId: string; input: string | null; output: string | null }> = []
      let activeLlmId: string | null = null
      let activeContent: { id: string; kind: 'reasoning' | 'message'; text: string } | null = null
      let completedNormally = false

      const finishActiveContent = (status: AgentTraceStepStatus = 'done'): void => {
        if (!activeContent) return
        trace.finish(activeContent.id, status, activeContent.text)
        activeContent = null
      }

      const appendContent = (kind: 'reasoning' | 'message', token: string): string => {
        if (!activeContent || activeContent.kind !== kind) {
          finishActiveContent()
          const step = trace.start(
            kind,
            kind === 'reasoning' ? 'model_reasoning' : 'assistant_message',
            null
          )
          activeContent = { id: step.id, kind, text: '' }
        }
        activeContent.text += token
        if (kind === 'message') tracedMessageText += token
        return activeContent.id
      }

      try {
        for await (const event of agent.streamEvents(
          { messages: inputMsgs },
          { version: 'v2', signal: controller.signal, recursionLimit: MAX_RECURSION_LIMIT }
        )) {
          const eventName = event.event
          const data = (event.data ?? {}) as Record<string, unknown>
          const runKey = typeof event.run_id === 'string' ? event.run_id : null

          if (eventName === 'on_chat_model_start') {
            finishActiveContent()
            if (activeLlmId) {
              trace.finish(activeLlmId, 'done', null, null)
              activeLlmId = null
            }
            const keys = runKey ? [runKey, 'llm:active'] : ['llm:active']
            const step = trace.start('llm', modelId, null, keys)
            activeLlmId = step.id
            continue
          }

          if (eventName === 'on_chat_model_end') {
            finishActiveContent()
            const usage = extractTokenUsage(data)
            const keys = [runKey, 'llm:active'].filter((k): k is string => !!k)
            const finished = trace.finishByKeys(keys, 'done', extractToolOutput(data), usage)
            if (finished && finished.id === activeLlmId) activeLlmId = null
            else if (activeLlmId) {
              trace.finish(activeLlmId, 'done', extractToolOutput(data), usage)
              activeLlmId = null
            }
            continue
          }

          if (eventName === 'on_chat_model_stream') {
            const chunkData = data as {
              chunk?: { content?: unknown; additional_kwargs?: Record<string, unknown> }
            }
            const chunk = chunkData?.chunk
            const content = chunk?.content
            const contentParts: Array<{ kind: 'reasoning' | 'message'; token: string }> = []
            if (typeof content === 'string') {
              if (content) contentParts.push({ kind: 'message', token: content })
            } else if (Array.isArray(content)) {
              for (const part of content) {
                if (typeof part === 'string') {
                  if (part) contentParts.push({ kind: 'message', token: part })
                } else if (part && typeof part === 'object') {
                  const p = part as Record<string, unknown>
                  if (p.type === 'text' && typeof p.text === 'string' && p.text) {
                    contentParts.push({ kind: 'message', token: p.text })
                  }
                  else if (p.type === 'reasoning' && typeof p.reasoning === 'string')
                    contentParts.push({ kind: 'reasoning', token: p.reasoning })
                }
              }
            }
            if (contentParts.length === 0) {
              const reasoning = chunk?.additional_kwargs?.reasoning_content
              if (typeof reasoning === 'string' && reasoning.length > 0) {
                contentParts.push({ kind: 'reasoning', token: reasoning })
              }
            }
            if (contentParts.length === 0) continue
            const ww = getWin()
            for (const part of contentParts) {
              const stepId = appendContent(part.kind, part.token)
              if (part.kind === 'reasoning') {
                if (ww) emitAiChatReasoning(ww, { threadId, runId, stepId, token: part.token })
              } else {
                finalText += part.token
                if (ww) emitAiChatToken(ww, { threadId, runId, stepId, token: part.token })
              }
            }
            continue
          }

          if (eventName === 'on_tool_start') {
            finishActiveContent()
            const toolName = extractToolName(event)
            const toolInput = extractToolInput(data)
            const keys = [
              runKey,
              runKey ? null : `tool-name:${toolName ?? 'unknown'}`
            ].filter((k): k is string => !!k)
            if (keys.length === 0) keys.push(`tool:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
            trace.start('tool', toolName, toolInput, keys)
            continue
          }

          if (eventName === 'on_tool_end') {
            const toolName = extractToolName(event)
            const toolOutput = extractToolOutput(data)
            collectedToolCalls.push({
              name: toolName ?? 'unknown',
              toolCallId: extractToolCallId(event, data),
              input: extractToolInput(data),
              output: toolOutput
            })
            const keys = [
              runKey,
              runKey ? null : `tool-name:${toolName ?? 'unknown'}`
            ].filter((k): k is string => !!k)
            const finished = trace.finishByKeys(keys, 'done', toolOutput)
            if (!finished) {
              trace.recordSnapshot('tool', toolName, 'done', toolOutput)
            }
            continue
          }

          if (eventName === 'on_tool_error') {
            const toolName = extractToolName(event)
            const errMsg =
              stringifyTraceValue(data.error) ??
              stringifyTraceValue(data.output) ??
              'Tool error'
            collectedToolCalls.push({
              name: toolName ?? 'unknown',
              toolCallId: extractToolCallId(event, data),
              input: extractToolInput(data),
              output: errMsg
            })
            const keys = [
              runKey,
              runKey ? null : `tool-name:${toolName ?? 'unknown'}`
            ].filter((k): k is string => !!k)
            const finished = trace.finishByKeys(keys, 'error', errMsg)
            if (!finished) {
              trace.recordSnapshot('tool', toolName, 'error', errMsg)
            }
          }
        }
        completedNormally = true
      } catch (streamErr) {
        const isAbort =
          controller.signal.aborted ||
          (streamErr instanceof Error &&
            (streamErr.name === 'AbortError' || /abort/i.test(streamErr.message)))
        if (isAbort) {
          if (destroyed) return
          finishActiveContent()
          if (activeLlmId) {
            trace.finish(activeLlmId, 'done', null, null)
            activeLlmId = null
          }
          trace.failOpen('Cancelled by user')
          finalText =
            finalText.length > 0
              ? finalText
              : '[Response cancelled by user]'
        } else {
          const isRecursionError =
            streamErr instanceof GraphRecursionError ||
            (streamErr instanceof Error &&
              (streamErr.name === 'GraphRecursionError' ||
                (streamErr as unknown as Record<string, unknown>).lc_error_code === 'GRAPH_RECURSION_LIMIT' ||
                /recursion limit/i.test(streamErr.message)))
          const msg = isRecursionError
            ? RECURSION_LIMIT_MESSAGE
            : streamErr instanceof Error
              ? streamErr.message
              : String(streamErr)
          logger.warn(`aiAgent:stream-error: ${msg}`)
          finishActiveContent('error')
          if (activeLlmId) {
            trace.finish(activeLlmId, 'error', msg, null)
            activeLlmId = null
          }
          trace.failOpen(msg)
          if (finalText.length > 0) {
            finalText += `\n\n[Response interrupted: ${msg}]`
          } else {
            trace.finish(runStep.id, 'error', msg)
            const ww = getWin()
            if (ww) emitAiChatError(ww, { threadId, message: msg, runId })
            return
          }
        }
      }

      finishActiveContent()
      if (activeLlmId) {
        trace.finish(activeLlmId, 'done', null, null)
        activeLlmId = null
      }

      const wasSuperseded = activeRuns.get(threadId) !== controller
      if (wasSuperseded) {
        trace.finish(runStep.id, 'done', null)
        return
      }

      if (!finalText) finalText = 'No response generated.'
      if (finalText !== tracedMessageText) {
        const untracedText = finalText.startsWith(tracedMessageText)
          ? finalText.slice(tracedMessageText.length)
          : finalText
        if (untracedText) {
          trace.recordSnapshot('message', 'assistant_message', 'done', untracedText)
        }
      }

      for (const tc of collectedToolCalls) {
        repos.chat.addMessage(
          threadId,
          'tool',
          JSON.stringify({ v: 2, name: tc.name, toolCallId: tc.toolCallId, input: tc.input, output: tc.output })
        )
      }

      repos.chat.addMessage(threadId, 'assistant', finalText)
      trace.finish(runStep.id, 'done', null)
      const ww = getWin()
      if (ww) emitAiChatDone(ww, { threadId, finalText, runId })

      if (completedNormally && isFirstExchange && finalText && finalText !== 'No response generated.') {
        void (async () => {
          try {
            const title = await generateThreadTitle(modelId, provider, key, req.text)
            if (title && !destroyed) {
              repos.chat.updateTitle(threadId, title)
              const ww2 = getWin()
              if (ww2) emitAiChatTitleUpdated(ww2, { threadId, title })
            }
          } catch {
            // silently keep derived title
          }
        })()
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Agent failed'
      logger.warn(`aiAgent:run-error: ${message}`)
      try {
        trace.failOpen(message)
        trace.finish(runStep.id, 'error', message)
      } catch (traceErr) {
        logger.warn(`aiAgent:trace-cleanup-failed: ${traceErr instanceof Error ? traceErr.message : String(traceErr)}`)
      }
      const ww = getWin()
      if (ww) emitAiChatError(ww, { threadId, message, runId })
    } finally {
      if (activeRuns.get(threadId) === controller) {
        activeRuns.delete(threadId)
      }
    }
  }

  function cancel(threadId: string): void {
    const controller = activeRuns.get(threadId)
    if (controller) controller.abort()
  }

  function destroy(): void {
    destroyed = true
    for (const controller of activeRuns.values()) {
      controller.abort()
    }
    activeRuns.clear()
  }

  function clearWorkspaceCache(workspaceId?: string): void {
    if (workspaceId) {
      workspaceContextCache.delete(workspaceId)
    } else {
      workspaceContextCache.clear()
    }
  }

  return { run, cancel, destroy, clearWorkspaceCache }
}

export type AiAgentService = ReturnType<typeof createAiAgentService>
