import { type BrowserWindow } from 'electron'
import { ChatOpenAI } from '@langchain/openai'
import type { Repositories } from '../db/repositories'
import type { AiSummaryContent } from '../../shared/ipc-types'
import type { AiProvidersService } from './aiProviders'
import type { PdfTextService } from './pdfText'
import { emitAiSummaryUpdated } from '../ipc/events'
import { logger } from './logger'

const MAX_CONCURRENT = 2
const CHUNK_SIZE = 3000
const CHUNK_OVERLAP = 200

type SummaryJob = () => Promise<void>

function splitText(text: string, chunkSize: number, chunkOverlap: number): string[] {
  if (text.length === 0) return []
  if (text.length <= chunkSize) return [text]
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.slice(start, end))
    if (end >= text.length) break
    start += chunkSize - chunkOverlap
  }
  return chunks
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const obj = part as Record<string, unknown>
          if (typeof obj.text === 'string') return obj.text
        }
        return ''
      })
      .join('')
  }
  return ''
}

function stripCodeFences(raw: string): string {
  return raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

function toSummaryContent(parsed: unknown): AiSummaryContent | null {
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  const core = typeof obj.core === 'string' ? obj.core : ''
  const keyPoints = Array.isArray(obj.keyPoints)
    ? obj.keyPoints.filter((x): x is string => typeof x === 'string')
    : []
  const content: AiSummaryContent = { core, keyPoints }
  if (typeof obj.methods === 'string' && obj.methods.length > 0) content.methods = obj.methods
  if (typeof obj.contribution === 'string' && obj.contribution.length > 0)
    content.contribution = obj.contribution
  return content
}

export function createAiSummaryService(
  repos: Repositories,
  win: BrowserWindow | (() => BrowserWindow | null),
  aiProvidersService: AiProvidersService,
  pdfTextService: PdfTextService
) {
  let destroyed = false
  const jobQueue: SummaryJob[] = []
  let activeJobs = 0

  const getWin = (): BrowserWindow | null => {
    const w = typeof win === 'function' ? win() : win
    if (!w || w.isDestroyed()) return null
    return w
  }

  function emit(docId: string): void {
    const w = getWin()
    if (w) emitAiSummaryUpdated(w, docId)
  }

  async function processSummary(docId: string): Promise<void> {
    const doc = repos.documents.get(docId)
    if (!doc) {
      logger.warn(`aiSummary:processJob doc-not-found id=${docId}`)
      emit(docId)
      return
    }

    let text: string
    try {
      text = await pdfTextService.getOrExtract(docId)
    } catch (e) {
      logger.warn(
        `aiSummary:extract-failed id=${docId}: ${e instanceof Error ? e.message : String(e)}`
      )
      emit(docId)
      return
    }

    if (destroyed) return

    const activeProviderId = repos.settings.get<string>('activeProviderId', '')
    if (!activeProviderId) {
      logger.info(`aiSummary:no-active-provider id=${docId}`)
      emit(docId)
      return
    }

    let provider
    let key: string
    try {
      provider = aiProvidersService.getProvider(activeProviderId)
      key = aiProvidersService.getDecryptedKey(activeProviderId)
    } catch (e) {
      logger.warn(
        `aiSummary:provider-unavailable id=${docId}: ${e instanceof Error ? e.message : String(e)}`
      )
      emit(docId)
      return
    }

    const model = new ChatOpenAI({
      model: provider.model,
      configuration: { baseURL: provider.baseUrl },
      apiKey: key,
      streaming: false
    })

    try {
      const chunks = splitText(text, CHUNK_SIZE, CHUNK_OVERLAP)
      const chunkSummaries: string[] = []
      for (const chunk of chunks) {
        if (destroyed) return
        const res = await model.invoke(
          `You are a research assistant. Summarize the key points of the following excerpt from an academic paper. Be concise and factual.\n\nExcerpt:\n${chunk}`
        )
        chunkSummaries.push(contentToText((res as { content: unknown }).content))
      }

      const combined = chunkSummaries.join('\n\n')

      let content: AiSummaryContent
      if (combined.trim().length === 0) {
        content = { core: '', keyPoints: [] }
      } else {
        const finalRes = await model.invoke(
          `You are a research assistant. Below are summaries of sections from an academic paper. Synthesize them into a single JSON object with exactly these fields: "core" (a 2-3 sentence summary), "keyPoints" (an array of concise strings), "methods" (optional string describing methods), "contribution" (optional string describing contributions). Respond with ONLY the JSON object, no markdown fences, no commentary.\n\nSection summaries:\n${combined}`
        )
        const finalText = contentToText((finalRes as { content: unknown }).content)
        let parsed: AiSummaryContent | null = null
        try {
          parsed = toSummaryContent(JSON.parse(stripCodeFences(finalText)))
        } catch {
          parsed = null
        }
        content = parsed ?? { core: finalText.trim() || combined, keyPoints: [] }
      }

      if (destroyed) return

      repos.aiSummaries.setSummary(docId, provider.model, content)
      logger.info(`aiSummary:done id=${docId} model=${provider.model}`)
      emit(docId)
    } catch (e) {
      logger.warn(
        `aiSummary:failed id=${docId}: ${e instanceof Error ? e.message : String(e)}`
      )
      emit(docId)
    }
  }

  function processQueue(): void {
    if (destroyed) return
    while (activeJobs < MAX_CONCURRENT && jobQueue.length > 0) {
      const job = jobQueue.shift()
      if (!job) break
      activeJobs++
      job()
        .catch((e) => {
          logger.error(`aiSummary:job-error: ${e instanceof Error ? e.message : String(e)}`)
        })
        .finally(() => {
          activeJobs--
          processQueue()
        })
    }
  }

  function summarize(docId: string): void {
    jobQueue.push(async () => {
      await processSummary(docId)
    })
    processQueue()
  }

  function destroy(): void {
    destroyed = true
    jobQueue.length = 0
    activeJobs = 0
  }

  return { summarize, destroy }
}

export type AiSummaryService = ReturnType<typeof createAiSummaryService>
