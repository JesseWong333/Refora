import { type BrowserWindow } from 'electron'
import type { Repositories } from '../db/repositories'
import type { AiSummaryContent } from '../../shared/ipc-types'
import type { AiProvidersService } from './aiProviders'
import type { PdfTextService } from './pdfText'
import { emitAiSummaryUpdated, emitAiSummaryError } from '../ipc/events'
import { logger } from './logger'
import { createAgentPythonProviderConfig } from './agentProviderConfig'
import type { AgentPythonRuntime } from './agentPythonRuntime'

const MAX_CONCURRENT = 2
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const SUMMARY_MAX_TOKENS = 450

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

export function createAiSummaryService(
  repos: Repositories,
  win: BrowserWindow | (() => BrowserWindow | null),
  aiProvidersService: AiProvidersService,
  pdfTextService: PdfTextService,
  agentPythonRuntime: AgentPythonRuntime
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

    const providerConfig = createAgentPythonProviderConfig({
      provider,
      apiKey: key,
      deepThinking: false,
      maxTokens: SUMMARY_MAX_TOKENS
    })

    let content: AiSummaryContent | null = null
    let lastError: Error | null = null
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (destroyed) return
      try {
        content = await agentPythonRuntime.generateSummary(
          { provider: providerConfig, text },
          new AbortController().signal
        )
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
