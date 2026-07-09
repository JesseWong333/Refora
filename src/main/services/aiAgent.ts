import type { BrowserWindow } from 'electron'
import { ChatOpenAI } from '@langchain/openai'
import { DynamicTool, DynamicStructuredTool } from '@langchain/core/tools'
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { z } from 'zod'
import type { Repositories } from '../db/repositories'
import type {
  AiProvider,
  AiSummaryContent,
  ChatSendRequest,
  Document
} from '../../shared/ipc-types'
import type { AiProvidersService } from './aiProviders'
import type { PdfTextService } from './pdfText'
import {
  emitAiChatToken,
  emitAiChatDone,
  emitAiChatError,
  emitAiReportCreated
} from '../ipc/events'
import { logger } from './logger'

const MAX_FULLTEXT_CHARS = 8000
const HISTORY_LIMIT = 12

const SYSTEM_PROMPT =
  'You are a research assistant working in a workspace of academic papers. ' +
  'Use the tools to search, read, and retrieve summaries of papers in the workspace. ' +
  'When the user asks for a report, survey, or comparison, call generate_report to pin a structured report to the board. ' +
  'Reference papers by their docId.'

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

export function createAiAgentService(
  repos: Repositories,
  win: () => BrowserWindow | null,
  aiProvidersService: AiProvidersService,
  pdfTextService: PdfTextService
) {
  const getWin = (): BrowserWindow | null => {
    const w = win()
    if (!w || w.isDestroyed()) return null
    return w
  }

  function buildTools(req: ChatSendRequest, providerModel: string) {
    const searchWorkspaceDocs = new DynamicTool({
      name: 'search_workspace_docs',
      description:
        'Search documents added to the current workspace by title or keywords. ' +
        'Returns a JSON array of objects [{docId, title}]. Pass an empty string to list every workspace document.',
      func: async (query: string) => {
        const items = repos.workspaceItems
          .list(req.workspaceId)
          .filter((i) => i.kind === 'document')
        const docs = items
          .map((i) => i.docId)
          .filter((d): d is string => d !== null)
          .map((id) => repos.documents.get(id))
          .filter((d): d is Document => d !== null)
        const q = query.trim().toLowerCase()
        const matched = q
          ? docs.filter((d) => {
              const title = (d.title ?? '').toLowerCase()
              const keywords = (d.keywords ?? '').toLowerCase()
              return title.includes(q) || keywords.includes(q)
            })
          : docs
        return JSON.stringify(
          matched.map((d) => ({ docId: d.id, title: d.title ?? d.fileName }))
        )
      }
    })

    const readPaperFulltext = new DynamicTool({
      name: 'read_paper_fulltext',
      description:
        'Read the full extracted text of a paper by its docId. Returns up to about 8000 characters of text.',
      func: async (docId: string) => {
        const text = await pdfTextService.getOrExtract(docId.trim())
        if (text.length > MAX_FULLTEXT_CHARS) {
          return `${text.slice(0, MAX_FULLTEXT_CHARS)}\n...[truncated]`
        }
        return text
      }
    })

    const getPaperSummary = new DynamicTool({
      name: 'get_paper_summary',
      description:
        'Get the cached AI summary of a paper by its docId. Returns a JSON summary object, or a notice that no summary is available yet.',
      func: async (docId: string) => {
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
        const ids = parseSourceDocIds(sourceDocIds)
        const report = repos.aiReports.create({
          workspaceId: req.workspaceId,
          title,
          contentMd,
          sourceDocIds: ids,
          model: providerModel
        })
        repos.workspaceItems.add(req.workspaceId, 'report', [report.id])
        const w = getWin()
        if (w) emitAiReportCreated(w, report)
        return 'Report created and pinned to the board.'
      }
    })

    return [searchWorkspaceDocs, readPaperFulltext, getPaperSummary, generateReport]
  }

  async function run(req: ChatSendRequest, threadId: string): Promise<void> {
    const w = getWin()
    if (!w) return

    try {
      repos.chat.addMessage(threadId, 'user', req.text)

      const pid = req.providerId || repos.settings.get<string>('activeProviderId', '')
      if (!pid) {
        emitAiChatError(w, { threadId, message: 'No AI provider configured' })
        return
      }

      let provider: AiProvider
      let key: string
      try {
        provider = aiProvidersService.getProvider(pid)
        key = aiProvidersService.getDecryptedKey(pid)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to resolve AI provider'
        emitAiChatError(w, { threadId, message })
        return
      }

      const modelId = (req.model && req.model.trim()) || provider.model
      const deepThinking = req.features?.deepThinking === true
      const systemPrompt = deepThinking
        ? `${SYSTEM_PROMPT} Prefer careful multi-step reasoning before answering.`
        : SYSTEM_PROMPT

      const llm = new ChatOpenAI({
        model: modelId,
        configuration: { baseURL: provider.baseUrl },
        apiKey: key,
        streaming: true
      })

      const tools = buildTools(req, modelId)
      const agent = createReactAgent({ llm, tools })

      const history = repos.chat.listMessages(threadId).slice(-HISTORY_LIMIT)
      const historyMsgs = history.map((m) =>
        m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
      )
      const inputMsgs = [new SystemMessage(systemPrompt), ...historyMsgs]

      let finalText = ''
      try {
        for await (const event of agent.streamEvents(
          { messages: inputMsgs },
          { version: 'v2' }
        )) {
          if (event.event !== 'on_chat_model_stream') continue
          const data = event.data as { chunk?: { content?: unknown } } | undefined
          const content = data?.chunk?.content
          const token = typeof content === 'string' ? content : ''
          if (!token) continue
          finalText += token
          const ww = getWin()
          if (ww) emitAiChatToken(ww, { threadId, token })
        }
      } catch (streamErr) {
        const msg = streamErr instanceof Error ? streamErr.message : String(streamErr)
        logger.warn(`aiAgent:stream-error: ${msg}`)
        if (finalText.length > 0) {
          finalText += `\n\n[Response interrupted: ${msg}]`
        } else {
          const ww = getWin()
          if (ww) emitAiChatError(ww, { threadId, message: msg })
          return
        }
      }

      if (!finalText) finalText = 'No response generated.'

      repos.chat.addMessage(threadId, 'assistant', finalText)
      const ww = getWin()
      if (ww) emitAiChatDone(ww, { threadId, finalText })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Agent failed'
      logger.warn(`aiAgent:run-error: ${message}`)
      const ww = getWin()
      if (ww) emitAiChatError(ww, { threadId, message })
    }
  }

  function destroy(): void {}

  return { run, destroy }
}

export type AiAgentService = ReturnType<typeof createAiAgentService>
