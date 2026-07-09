import { type BrowserWindow, utilityProcess } from 'electron'
import { join, resolve as resolvePath } from 'node:path'
import type { Repositories } from '../db/repositories'
import { RepoError } from '../db/repositories/errors'
import { newId } from '../db/repositories/documents'
import { logger } from './logger'

interface WorkerResponse {
  correlationId: string
  error?: { type: string; message: string }
  text?: string
}

interface PendingRequest {
  resolve: (value: WorkerResponse) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const WORKER_TIMEOUT_MS = 120_000
const WORKER_IDLE_TIMEOUT_MS = 60_000

export function createPdfTextService(
  repos: Repositories,
  _win: BrowserWindow | (() => BrowserWindow | null)
) {
  let worker: ReturnType<typeof utilityProcess.fork> | null = null
  let workerKilled = false
  let destroyed = false
  let workerIdleTimer: ReturnType<typeof setTimeout> | null = null
  const pending = new Map<string, PendingRequest>()
  let activeJobs = 0

  function scheduleIdleKill(): void {
    if (workerIdleTimer) clearTimeout(workerIdleTimer)
    workerIdleTimer = setTimeout(() => {
      if (pending.size === 0 && activeJobs === 0) {
        if (worker && !workerKilled) {
          logger.info('pdfText-worker:idle-kill')
          worker.kill()
          workerKilled = true
          worker = null
        }
      }
    }, WORKER_IDLE_TIMEOUT_MS)
  }

  function ensureWorker(): ReturnType<typeof utilityProcess.fork> {
    if (workerIdleTimer) {
      clearTimeout(workerIdleTimer)
      workerIdleTimer = null
    }
    if (worker && !workerKilled) return worker
    worker = utilityProcess.fork(join(__dirname, 'worker/pdf-worker.js'), [], {
      serviceName: 'PDF Text Worker',
      stdio: 'pipe'
    })
    workerKilled = false
    worker.on('message', (msg: WorkerResponse) => {
      const req = pending.get(msg.correlationId)
      if (req) {
        clearTimeout(req.timer)
        pending.delete(msg.correlationId)
        req.resolve(msg)
      }
    })
    worker.on('exit', (code) => {
      logger.warn(`pdfText-worker:exit code=${code} pending=${pending.size}`)
      if (workerIdleTimer) {
        clearTimeout(workerIdleTimer)
        workerIdleTimer = null
      }
      for (const [, req] of pending) {
        clearTimeout(req.timer)
        req.reject(new Error('PDF text worker exited unexpectedly'))
      }
      pending.clear()
      worker = null
      workerKilled = true
    })
    if (worker.stderr) {
      worker.stderr.on('data', (chunk: Buffer) => {
        logger.error(`pdfText-worker:stderr ${chunk.toString().trim()}`)
      })
    }
    logger.info('pdfText-worker:started')
    return worker
  }

  function requestExtract(filePath: string): Promise<WorkerResponse> {
    const w = ensureWorker()
    const correlationId = newId()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(correlationId)
        reject(new Error(`PDF text worker request timed out: ${filePath}`))
      }, WORKER_TIMEOUT_MS)
      pending.set(correlationId, { resolve, reject, timer })
      w.postMessage({ correlationId, filePath, maxPages: 0 })
    })
  }

  async function getOrExtract(docId: string): Promise<string> {
    if (destroyed) throw new Error('PDF text service destroyed')
    const existing = repos.aiSummaries.getFullText(docId)
    if (existing !== null) return existing

    const doc = repos.documents.get(docId)
    if (!doc) throw new RepoError('not_found', `Document ${docId} not found`)

    const filePath = resolvePath(doc.filePath)
    if (!filePath.toLowerCase().endsWith('.pdf')) {
      throw new RepoError('invalid_path', `Not a PDF file: ${filePath}`)
    }

    activeJobs++
    try {
      const response = await requestExtract(filePath)
      if (response.error) {
        throw new Error(response.error.message)
      }
      const text = response.text ?? ''
      repos.aiSummaries.setFullText(docId, text)
      return text
    } finally {
      activeJobs--
      if (activeJobs === 0 && pending.size === 0) {
        scheduleIdleKill()
      }
    }
  }

  function destroy(): void {
    destroyed = true
    if (workerIdleTimer) {
      clearTimeout(workerIdleTimer)
      workerIdleTimer = null
    }
    if (worker && !workerKilled) {
      worker.kill()
      workerKilled = true
      worker = null
    }
    for (const [, req] of pending) {
      clearTimeout(req.timer)
      req.reject(new Error('PDF text service destroyed'))
    }
    pending.clear()
    activeJobs = 0
  }

  return { getOrExtract, destroy }
}

export type PdfTextService = ReturnType<typeof createPdfTextService>
