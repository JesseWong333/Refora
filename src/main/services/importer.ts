import { statSync, existsSync } from 'node:fs'
import { basename, dirname, resolve as resolvePath, join, parse as parsePath } from 'node:path'
import { dialog, utilityProcess, BrowserWindow } from 'electron'
import { EventEmitter } from 'node:events'
import type { Repositories } from '../db/repositories'
import { newId } from '../db/repositories/documents'
import { emitImportProgress } from '../ipc/events'
import { logger } from './logger'
import { copyToLibrary } from './library'

interface WorkerRequest {
  correlationId: string
  filePath: string
}

interface WorkerResponse {
  correlationId: string
  error?: { type: 'encrypted' | 'corrupted' | 'other'; message: string }
  fileHash?: string | null
  info?: Record<string, unknown>
  text?: string
}

interface PendingRequest {
  resolve: (value: WorkerResponse) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const WORKER_TIMEOUT_MS = 120_000

export interface ImportResult {
  added: string[]
  skipped: string[]
  errors: Array<{ path: string; message: string }>
}

export function createImporter(repos: Repositories, win: BrowserWindow | (() => BrowserWindow | null)) {
  let worker: ReturnType<typeof utilityProcess.fork> | null = null
  let workerKilled = false
  const pending = new Map<string, PendingRequest>()
  const emitter = new EventEmitter()

  const getWin = (): BrowserWindow | null => {
    const w = typeof win === 'function' ? win() : win
    if (!w || w.isDestroyed()) return null
    return w
  }

  function ensureWorker(): ReturnType<typeof utilityProcess.fork> {
    if (worker && !workerKilled) return worker
    worker = utilityProcess.fork(join(__dirname, 'worker/pdf-worker.js'), [], {
      serviceName: 'PDF Worker',
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
    worker.on('exit', (_code) => {
      for (const [, req] of pending) {
        clearTimeout(req.timer)
        req.reject(new Error('PDF worker exited unexpectedly'))
      }
      pending.clear()
      worker = null
      workerKilled = true
    })
    logger.info('pdf-worker:started')
    return worker
  }

  function requestFromWorker(filePath: string): Promise<WorkerResponse> {
    const w = ensureWorker()
    const correlationId = newId()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(correlationId)
        reject(new Error(`Worker request timed out: ${filePath}`))
      }, WORKER_TIMEOUT_MS)
      pending.set(correlationId, { resolve, reject, timer })
      w.postMessage({ correlationId, filePath } satisfies WorkerRequest)
    })
  }

  function validateFilePath(raw: string): string | null {
    const abs = resolvePath(raw)
    if (!abs.toLowerCase().endsWith('.pdf')) return null
    if (!existsSync(abs)) return null
    try {
      if (!statSync(abs).isFile()) return null
    } catch {
      return null
    }
    return abs
  }

  async function showDuplicateDialog(fileName: string): Promise<boolean> {
    const w = getWin()
    if (!w) return true
    const result = await dialog.showMessageBox(w, {
      type: 'question',
      title: 'Duplicate File',
      message: 'This file appears to be a duplicate.',
      detail: `"${fileName}" has the same content as a file already in your library. Skip this file?`,
      buttons: ['Skip', 'Import Anyway'],
      defaultId: 0,
      cancelId: 0
    })
    return result.response === 0
  }

  async function importFiles(paths: string[], isWatch: boolean): Promise<ImportResult> {
    const added: string[] = []
    const skipped: string[] = []
    const errors: Array<{ path: string; message: string }> = []
    const total = paths.length

    if (total === 0) return { added, skipped, errors }

    for (let i = 0; i < paths.length; i++) {
      const current = i + 1
      const raw = paths[i]

      if (total >= 3) {
        const w = getWin()
        if (w) emitImportProgress(w, { current, total })
      }

      const abs = validateFilePath(raw)
      if (!abs) {
        skipped.push(raw)
        logger.warn(`import:skip invalid path: ${raw}`)
        continue
      }

      const existing = repos.documents.findByPath(abs)
      if (existing) {
        skipped.push(abs)
        logger.info(`import:skip path-duplicate: ${abs}`)
        continue
      }

      let workerResponse: WorkerResponse
      try {
        workerResponse = await requestFromWorker(abs)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push({ path: abs, message: msg })
        logger.error(`import:worker-error ${abs}: ${msg}`)
        continue
      }

      if (workerResponse.error) {
        const fileName = basename(abs)
        if (workerResponse.error.type === 'encrypted') {
          errors.push({
            path: abs,
            message: `Skipping encrypted PDF: ${fileName} (password-protected).`
          })
          logger.info(`import:skip encrypted: ${abs}`)
        } else if (workerResponse.error.type === 'corrupted') {
          errors.push({
            path: abs,
            message: `Could not read: ${fileName} (file may be corrupted).`
          })
          logger.info(`import:skip corrupted: ${abs}`)
        } else {
          errors.push({ path: abs, message: workerResponse.error.message })
          logger.info(`import:skip error: ${abs} — ${workerResponse.error.message}`)
        }
        continue
      }

      const fileHash = workerResponse.fileHash ?? null

      if (fileHash !== null) {
        const hashDup = repos.documents.findByHash(fileHash)
        if (hashDup) {
          if (isWatch) {
            skipped.push(abs)
            logger.info(`import:skip hash-duplicate (watch): ${abs}`)
            continue
          } else {
            const shouldSkip = await showDuplicateDialog(basename(abs))
            if (shouldSkip) {
              skipped.push(abs)
              logger.info(`import:skip hash-duplicate (user-skip): ${abs}`)
              continue
            }
            logger.info(`import:hash-duplicate user chose import-anyway: ${abs}`)
          }
        }
      }

      const fileSize = statSync(abs).size
      const now = Date.now()

      const doc = repos.documents.insert({
        id: newId(),
        filePath: abs,
        originalFolderPath: dirname(abs),
        fileName: basename(abs),
        fileSize,
        fileHash,
        title: null,
        authors: null,
        year: null,
        venue: null,
        volume: null,
        abstract: null,
        keywords: null,
        url: null,
        doi: null,
        note: null,
        starred: 0,
        addedAt: now,
        lastReadAt: null,
        updatedAt: now,
        metadataSource: null,
        metadataStatus: 'pending',
        metadataAttempts: 0,
        editedFields: [],
        remoteValues: null,
        fileMissing: 0
      })

      const libraryFolder = repos.settings.get<string>('libraryFolderPath', '')
      if (libraryFolder) {
        try {
          const inLibrary = abs.startsWith(libraryFolder + '/') || abs === libraryFolder
          if (!inLibrary) {
            const newPath = copyToLibrary(abs, libraryFolder)
            repos.documents.updateFilePath(doc.id, newPath, parsePath(newPath).base)
          }
        } catch (copyErr) {
          logger.warn(`import:copy-to-library failed ${abs}: ${copyErr instanceof Error ? copyErr.message : String(copyErr)}`)
        }
      }

      added.push(doc.id)
      logger.info(`import:added ${doc.id} — ${abs}`)
    }

    if (total >= 3) {
      const w = getWin()
      if (w) emitImportProgress(w, { current: total, total })
    }

    emitter.emit('import:complete', { added, skipped, errors })
    return { added, skipped, errors }
  }

  function destroy(): void {
    if (worker && !workerKilled) {
      worker.kill()
      workerKilled = true
      worker = null
    }
    pending.clear()
    emitter.removeAllListeners()
  }

  return { importFiles, destroy, onComplete: (cb: (result: ImportResult) => void) => emitter.on('import:complete', cb) }
}
