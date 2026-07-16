import { type BrowserWindow } from 'electron'
import type { ChatOpenAI } from '@langchain/openai'
import type { Repositories } from '../db/repositories'
import type { AiSummaryContent } from '../../shared/ipc-types'
import type { AiProvidersService } from './aiProviders'
import type { PdfTextService } from './pdfText'
import { emitAiSummaryUpdated, emitAiSummaryError } from '../ipc/events'
import { logger } from './logger'
import { createProviderChatModel } from './providerModel'

const MAX_CONCURRENT = 2
const CHUNK_SIZE = 3000
const CHUNK_OVERLAP = 200
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'EPIPE',
  'ECONNABORTED'
])

const RETRYABLE_MESSAGE_PATTERNS = [
  /429/,
  /rate.?limit/i,
  /too many requests/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
  /overloaded/i,
  /temporarily unavailable/i,
  /network error/i,
  /fetch failed/i,
  /socket hang up/i,
  /connection reset/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i
]

type SummaryJob = () => Promise<void>

function isRetryableError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const anyErr = e as unknown as Record<string, unknown>

  const lcErrorCode = anyErr.lc_error_code
  if (lcErrorCode === 'MODEL_RATE_LIMIT') return true
  if (lcErrorCode === 'MODEL_AUTHENTICATION' || lcErrorCode === 'MODEL_NOT_FOUND') return false

  if (anyErr.name === 'AbortError') return true

  const status = extractStatus(anyErr)
  if (status !== null) {
    if (status === 429) return true
    if (status >= 500 && status < 600) return true
    if (status >= 400 && status < 500) return false
  }

  const code = typeof anyErr.code === 'string' ? anyErr.code : null
  if (code && RETRYABLE_NETWORK_CODES.has(code)) return true

  const msg = e.message ?? ''
  if (RETRYABLE_MESSAGE_PATTERNS.some((p) => p.test(msg))) return true

  return false
}

function extractStatus(err: Record<string, unknown>): number | null {
  if (typeof err.status === 'number') return err.status
  const response = err.response
  if (response && typeof response === 'object') {
    const r = response as Record<string, unknown>
    if (typeof r.status === 'number') return r.status
  }
  const cause = err.cause
  if (cause && typeof cause === 'object') {
    const c = cause as Record<string, unknown>
    if (typeof c.status === 'number') return c.status
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

  function emitError(docId: string, message: string): void {
    const w = getWin()
    if (w) emitAiSummaryError(w, { docId, message })
    emit(docId)
  }

  async function invokeSummary(
    model: ChatOpenAI,
    text: string,
    docId: string
  ): Promise<AiSummaryContent> {
    const chunks = splitText(text, CHUNK_SIZE, CHUNK_OVERLAP)
    const chunkSummaries: string[] = []
    for (const chunk of chunks) {
      if (destroyed) throw new Error('Summary service destroyed')
      const res = await model.invoke(
        `You are a research assistant. Summarize the key points of the following excerpt from an academic paper. Be concise and factual.\n\nExcerpt:\n${chunk}`
      )
      chunkSummaries.push(contentToText((res as { content: unknown }).content))
    }

    const combined = chunkSummaries.join('\n\n')

    if (combined.trim().length === 0) {
      return { core: '', keyPoints: [] }
    }

    const finalRes = await model.invoke(
      `You are a research assistant. Below are summaries of sections from an academic paper. Synthesize them into a single JSON object with exactly these fields: "core" (a 2-3 sentence summary), "keyPoints" (an array of concise strings), "methods" (optional string describing methods), "contribution" (optional string describing contributions). Respond with ONLY the JSON object, no markdown fences, no commentary.\n\nSection summaries:\n${combined}`
    )
    const finalText = contentToText((finalRes as { content: unknown }).content)
    let parsed: AiSummaryContent | null
    try {
      parsed = toSummaryContent(JSON.parse(stripCodeFences(finalText)))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.warn(`aiSummary:json-parse-failed id=${docId}: ${msg}`)
      parsed = null
    }
    return parsed ?? { core: finalText.trim() || combined, keyPoints: [] }
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
      if (destroyed) return
      const msg = e instanceof Error ? e.message : String(e)
      logger.warn(`aiSummary:extract-failed id=${docId}: ${msg}`)
      emitError(docId, `Failed to extract PDF text: ${msg}`)
      return
    }

    if (destroyed) return

    const activeProviderId = repos.settings.get<string>('activeProviderId', '')
    if (!activeProviderId) {
      logger.info(`aiSummary:no-active-provider id=${docId}`)
      emitError(docId, 'No AI provider configured. Set one as active in Settings.')
      return
    }

    let provider
    let key: string
    try {
      provider = aiProvidersService.getProvider(activeProviderId)
      key = aiProvidersService.getDecryptedKey(activeProviderId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.warn(`aiSummary:provider-unavailable id=${docId}: ${msg}`)
      emitError(docId, `AI provider unavailable: ${msg}`)
      return
    }

    const model = createProviderChatModel({
      provider,
      apiKey: key,
      streaming: false,
      deepThinking: false
    })

    let content: AiSummaryContent | null = null
    let lastError: Error | null = null
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (destroyed) return
      try {
        content = await invokeSummary(model, text, docId)
        lastError = null
        break
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e))
        if (attempt === MAX_RETRIES || !isRetryableError(e)) {
          break
        }
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1)
        const msg = lastError.message
        logger.warn(
          `aiSummary:retry attempt=${attempt}/${MAX_RETRIES} id=${docId} delay=${delay}ms: ${msg}`
        )
        await sleep(delay)
      }
    }

    if (destroyed) return

    if (lastError) {
      const msg = lastError.message
      logger.warn(`aiSummary:failed id=${docId}: ${msg}`)
      emitError(docId, `Summary generation failed: ${msg}`)
      return
    }

    repos.aiSummaries.setSummary(docId, provider.model, content!)
    logger.info(`aiSummary:done id=${docId} model=${provider.model}`)
    emit(docId)
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
  }

  return { summarize, destroy }
}

export type AiSummaryService = ReturnType<typeof createAiSummaryService>
