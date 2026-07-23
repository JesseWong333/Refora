import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Repositories } from '../db/repositories'
import { RepoError } from '../db/repositories/errors'
import type {
  OcrCompletedEvent,
  OcrDocumentState,
  OcrErrorEvent,
  OcrJob,
  OcrProfile,
  OcrProgressEvent,
  OcrResult
} from '../../shared/mineru-types'
import { MINERU_VERSION, OCR_RESULT_SCHEMA_VERSION } from '../../shared/mineru-types'
import { resolvePdfFilePath } from './pdfPath'
import { streamFileHash } from './fileHash'
import {
  getOcrDocumentRoot,
  getOcrPublishBackupRoot,
  getOcrResultRoot,
  getOcrRoot,
  getOcrStagingRoot,
  resolveOcrResultFile,
  toLibraryRelativePath
} from './ocrPaths'
import type { MineruEngineManager } from './mineruEngineManager'
import type { MineruWorkerProcess } from './mineruWorkerProcess'
import { logger } from './logger'

interface MineruDocumentServiceDeps {
  repos: Repositories
  engineManager: MineruEngineManager
  worker: MineruWorkerProcess
  getLibraryFolder: () => string
  emitProgress: (event: OcrProgressEvent) => void
  emitCompleted: (event: OcrCompletedEvent) => void
  emitError: (event: OcrErrorEvent) => void
  renamePath?: typeof rename
}

interface OcrManifest {
  schemaVersion: number
  documentId: string
  resultKey: string
  sourceHash: string
  mineruVersion: string
  modelRevision: string
  profile: OcrProfile
  optionsHash: string
  createdAt: number
  files: {
    markdown: string
    blocks: string
    middle: string
    assets: string | null
  }
  pageCount: number | null
  blockCount: number
}

function resultOptions(profile: OcrProfile): string {
  return JSON.stringify({
    schemaVersion: OCR_RESULT_SCHEMA_VERSION,
    mineruVersion: MINERU_VERSION,
    profile,
    language: 'ch',
    formula: true,
    table: true
  })
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function errorCode(error: unknown): string {
  if (error instanceof RepoError) return error.code
  if (error instanceof Error && error.name) return error.name
  return 'ocr_failed'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createMineruDocumentService(deps: MineruDocumentServiceDeps) {
  const cancelled = new Set<string>()
  let destroyed = false
  let runningJobId: string | null = null
  let runningTask: { jobId: string; promise: Promise<void> } | null = null
  let startPending = false
  const renamePath = deps.renamePath ?? rename

  function emitJob(job: OcrJob): void {
    deps.emitProgress({ job })
  }

  function updateJob(
    id: string,
    patch: Partial<Pick<OcrJob, 'status' | 'stage' | 'progress' | 'errorCode' | 'errorMessage' | 'startedAt' | 'finishedAt'>>
  ): OcrJob {
    const job = deps.repos.documentOcr.updateJob(id, patch)
    emitJob(job)
    return job
  }

  async function cleanupStaging(): Promise<void> {
    const library = deps.getLibraryFolder()
    if (!library) return
    const root = getOcrRoot(library)
    const documents = await readdir(root, { withFileTypes: true }).catch(() => [])
    await Promise.all(documents
      .filter((entry) => entry.isDirectory() && /^[a-zA-Z0-9_-]+$/.test(entry.name))
      .map((entry) => rm(join(root, entry.name, '.staging'), { recursive: true, force: true })))
  }

  async function initialize(): Promise<void> {
    deps.repos.documentOcr.markRunningInterrupted()
    await cleanupStaging()
  }

  async function getSourceHash(documentId: string): Promise<{ path: string; hash: string }> {
    const document = deps.repos.documents.get(documentId)
    if (!document) throw new RepoError('not_found', `Document not found: ${documentId}`)
    const path = resolvePdfFilePath(document.filePath)
    return { path, hash: document.fileHash || await streamFileHash(path) }
  }

  async function getState(documentId: string): Promise<OcrDocumentState> {
    const document = deps.repos.documents.get(documentId)
    if (!document) throw new RepoError('not_found', `Document not found: ${documentId}`)
    return {
      engine: await deps.engineManager.getStatus(),
      activeJob: deps.repos.documentOcr.getActiveJob(documentId),
      result: deps.repos.documentOcr.getResult(documentId, document.fileHash)
    }
  }

  async function validateNormalizedFiles(staging: string): Promise<void> {
    for (const name of ['document.md', 'blocks.jsonl', 'middle.json']) {
      const path = join(staging, name)
      const entry = await lstat(path)
      if (entry.isSymbolicLink() || !entry.isFile() || entry.size === 0) {
        throw new Error(`MinerU produced an invalid ${name}`)
      }
    }
  }

  function requireActiveJob(jobId: string): void {
    if (destroyed || cancelled.has(jobId)) {
      throw new Error('MinerU conversion was cancelled')
    }
  }

  async function publishResult(
    library: string,
    job: OcrJob,
    staging: string,
    destination: string
  ): Promise<{ commit: () => void; rollback: () => Promise<void> }> {
    const backup = getOcrPublishBackupRoot(library, job.documentId, job.id)
    await mkdir(dirname(backup), { recursive: true, mode: 0o700 })
    await rm(backup, { recursive: true, force: true })
    requireActiveJob(job.id)
    const destinationExists = await access(destination).then(() => true, () => false)
    let backedUp = false
    if (destinationExists) {
      await renamePath(destination, backup)
      backedUp = true
    }
    let published = false
    try {
      requireActiveJob(job.id)
      await renamePath(staging, destination)
      published = true
      requireActiveJob(job.id)
    } catch (error) {
      if (published) {
        await rm(destination, { recursive: true, force: true }).catch(() => undefined)
      }
      if (backedUp) {
        try {
          await renamePath(backup, destination)
        } catch (restoreError) {
          logger.error(
            `ocr:result restore failed for ${job.id}: ${errorMessage(restoreError)}`
          )
        }
      }
      throw error
    }
    return {
      commit: () => {
        if (!backedUp) return
        void rm(backup, { recursive: true, force: true }).catch((error) => {
          logger.warn(`ocr:backup cleanup failed for ${job.id}: ${errorMessage(error)}`)
        })
      },
      rollback: async () => {
        await rm(destination, { recursive: true, force: true }).catch(() => undefined)
        if (!backedUp) return
        await renamePath(backup, destination)
      }
    }
  }

  async function runJob(job: OcrJob, inputPath: string, modelRevision: string): Promise<void> {
    const library = deps.getLibraryFolder()
    const staging = getOcrStagingRoot(library, job.documentId, job.id)
    const destination = getOcrResultRoot(library, job.documentId, job.resultKey)
    runningJobId = job.id
    try {
      await mkdir(staging, { recursive: true, mode: 0o700 })
      updateJob(job.id, {
        status: 'running',
        stage: 'startingWorker',
        progress: 0.02,
        startedAt: Date.now()
      })
      const workerResult = await deps.worker.parse(
        inputPath,
        staging,
        job.profile,
        ({ stage, progress }) => {
          if (!destroyed && !cancelled.has(job.id)) updateJob(job.id, { stage, progress })
        }
      )
      requireActiveJob(job.id)
      updateJob(job.id, { stage: 'validating', progress: 0.98 })
      await validateNormalizedFiles(staging)
      requireActiveJob(job.id)
      const optionsHash = digest(resultOptions(job.profile))
      const createdAt = Date.now()
      const manifest: OcrManifest = {
        schemaVersion: OCR_RESULT_SCHEMA_VERSION,
        documentId: job.documentId,
        resultKey: job.resultKey,
        sourceHash: job.sourceHash,
        mineruVersion: MINERU_VERSION,
        modelRevision,
        profile: job.profile,
        optionsHash,
        createdAt,
        files: {
          markdown: workerResult.markdown,
          blocks: workerResult.blocks,
          middle: workerResult.middle,
          assets: workerResult.assets
        },
        pageCount: workerResult.pageCount,
        blockCount: workerResult.blockCount
      }
      await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), {
        mode: 0o600
      })
      requireActiveJob(job.id)
      const publishStaging = getOcrStagingRoot(library, job.documentId, job.id)
      const publishDestination = getOcrResultRoot(library, job.documentId, job.resultKey)
      await mkdir(getOcrDocumentRoot(library, job.documentId), { recursive: true, mode: 0o700 })
      const publication = await publishResult(
        library,
        job,
        publishStaging,
        publishDestination
      )
      let stored: OcrResult
      try {
        requireActiveJob(job.id)
        const relativeRoot = toLibraryRelativePath(library, destination)
        const result: OcrResult = {
          id: randomUUID(),
          documentId: job.documentId,
          resultKey: job.resultKey,
          sourceHash: job.sourceHash,
          mineruVersion: MINERU_VERSION,
          modelRevision,
          profile: job.profile,
          optionsHash,
          schemaVersion: OCR_RESULT_SCHEMA_VERSION,
          relativeRoot,
          markdownRelativePath: join(relativeRoot, 'document.md'),
          blocksRelativePath: join(relativeRoot, 'blocks.jsonl'),
          manifestRelativePath: join(relativeRoot, 'manifest.json'),
          createdAt,
          stale: false
        }
        stored = deps.repos.documentOcr.insertResult(result)
        updateJob(job.id, {
          status: 'succeeded',
          stage: 'completed',
          progress: 1,
          finishedAt: Date.now()
        })
      } catch (error) {
        await publication.rollback()
        throw error
      }
      publication.commit()
      deps.emitCompleted({ jobId: job.id, documentId: job.documentId, result: stored })
    } catch (error) {
      try {
        const safeStaging = getOcrStagingRoot(library, job.documentId, job.id)
        await rm(safeStaging, { recursive: true, force: true })
      } catch {
        logger.warn(`ocr:staging cleanup skipped for ${job.id}`)
      }
      if (destroyed) return
      if (!deps.repos.documentOcr.getJob(job.id)) return
      const wasCancelled = destroyed || cancelled.has(job.id)
      const code = wasCancelled ? 'cancelled' : errorCode(error)
      const message = wasCancelled ? 'MinerU conversion was cancelled' : errorMessage(error)
      updateJob(job.id, {
        status: wasCancelled ? 'cancelled' : 'failed',
        errorCode: code,
        errorMessage: message,
        finishedAt: Date.now()
      })
      if (!wasCancelled) {
        logger.error(`ocr:job ${job.id} failed: ${message}`)
        deps.emitError({ jobId: job.id, documentId: job.documentId, code, message })
      }
    } finally {
      cancelled.delete(job.id)
      if (runningJobId === job.id) runningJobId = null
    }
  }

  async function start(documentId: string, profile: OcrProfile): Promise<OcrJob> {
    if (destroyed) throw new Error('OCR service is unavailable')
    if (!['compatible', 'balanced', 'quality'].includes(profile)) {
      throw new RepoError('invalid_value', 'Unsupported OCR profile', 'profile')
    }
    if (startPending) throw new RepoError('busy', 'MinerU is already processing a document')
    startPending = true
    try {
      const engine = await deps.engineManager.getRuntime()
      const existing = deps.repos.documentOcr.getAnyActiveJob()
      if (existing) throw new RepoError('busy', 'MinerU is already processing a document')
      const source = await getSourceHash(documentId)
      if (destroyed) throw new Error('OCR service is unavailable')
      const optionsHash = digest(resultOptions(profile))
      const resultKey = digest(`${source.hash}:${optionsHash}:${engine.modelRevision}`).slice(0, 32)
      const now = Date.now()
      const job = deps.repos.documentOcr.createJob({
        id: randomUUID(),
        documentId,
        resultKey,
        sourceHash: source.hash,
        profile,
        status: 'queued',
        stage: 'queued',
        progress: 0,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        startedAt: null,
        finishedAt: null,
        updatedAt: now
      })
      emitJob(job)
      const task = runJob(job, source.path, engine.modelRevision)
      runningTask = { jobId: job.id, promise: task }
      void task.then(
        () => {
          if (runningTask?.jobId === job.id) runningTask = null
        },
        (error) => {
          if (runningTask?.jobId === job.id) runningTask = null
          logger.error(`ocr:job ${job.id} stopped unexpectedly: ${errorMessage(error)}`)
        }
      )
      return job
    } finally {
      startPending = false
    }
  }

  async function cancel(jobId: string): Promise<OcrJob> {
    const job = deps.repos.documentOcr.getJob(jobId)
    if (!job) throw new RepoError('not_found', `OCR job not found: ${jobId}`)
    if (!['queued', 'running'].includes(job.status)) return job
    cancelled.add(jobId)
    if (runningJobId === jobId) await deps.worker.cancel()
    if (runningTask?.jobId === jobId) await runningTask.promise
    return deps.repos.documentOcr.getJob(jobId) ?? job
  }

  function readMarkdown(documentId: string, resultKey: string): Promise<string> {
    const result = deps.repos.documentOcr.getResultByKey(documentId, resultKey)
    if (!result) throw new RepoError('not_found', 'OCR result not found')
    const path = resolveOcrResultFile(deps.getLibraryFolder(), result.markdownRelativePath)
    return readFile(path, 'utf8')
  }

  async function waitForJob(
    jobId: string,
    signal: AbortSignal | undefined,
    cancelOnAbort: boolean
  ): Promise<OcrJob> {
    const current = deps.repos.documentOcr.getJob(jobId)
    if (!current) throw new RepoError('not_found', `OCR job not found: ${jobId}`)
    if (!['queued', 'running'].includes(current.status)) {
      if (current.status !== 'succeeded') {
        throw new Error(current.errorMessage || `OCR job ended with status ${current.status}`)
      }
      return current
    }
    const task = runningTask?.jobId === jobId ? runningTask.promise : null
    if (!task) throw new Error('OCR job is not running in this process')

    let handleAbort: (() => void) | null = null
    const aborted = signal
      ? new Promise<void>((_resolve, reject) => {
          handleAbort = () => {
            const cancellation = cancelOnAbort ? cancel(jobId).then(() => undefined) : Promise.resolve()
            void cancellation.then(
              () => reject(new Error('OCR reading was cancelled')),
              reject
            )
          }
          signal.addEventListener('abort', handleAbort, { once: true })
        })
      : null

    try {
      if (signal?.aborted) {
        if (cancelOnAbort) await cancel(jobId)
        throw new Error('OCR reading was cancelled')
      }
      await (aborted ? Promise.race([task, aborted]) : task)
    } finally {
      if (signal && handleAbort) signal.removeEventListener('abort', handleAbort)
    }

    const completed = deps.repos.documentOcr.getJob(jobId)
    if (!completed) throw new RepoError('not_found', `OCR job not found: ${jobId}`)
    if (completed.status !== 'succeeded') {
      throw new Error(completed.errorMessage || `OCR job ended with status ${completed.status}`)
    }
    return completed
  }

  async function readCachedForAgent(
    documentId: string
  ): Promise<{ result: OcrResult; markdown: string } | null> {
    const state = await getState(documentId)
    if (!state.result || state.result.stale) return null
    return {
      result: state.result,
      markdown: await readMarkdown(documentId, state.result.resultKey)
    }
  }

  async function prepareForAgent(
    documentId: string,
    signal?: AbortSignal
  ): Promise<{ result: OcrResult; markdown: string }> {
    if (signal?.aborted) throw new Error('OCR reading was cancelled')
    const profile: OcrProfile = 'balanced'
    const isSuitableProfile = (candidate: OcrProfile) =>
      candidate === 'balanced' || candidate === 'quality'
    let state = await getState(documentId)
    if (state.result && !state.result.stale && isSuitableProfile(state.result.profile)) {
      return {
        result: state.result,
        markdown: await readMarkdown(documentId, state.result.resultKey)
      }
    }

    let job = state.activeJob
    let startedByAgent = false
    if (job && !isSuitableProfile(job.profile)) {
      throw new RepoError(
        'busy',
        `MinerU is already processing this document with the ${job.profile} profile`
      )
    }
    if (!job) {
      job = await start(documentId, profile)
      startedByAgent = true
    }

    await waitForJob(job.id, signal, startedByAgent)
    state = await getState(documentId)
    if (!state.result || state.result.stale || !isSuitableProfile(state.result.profile)) {
      throw new Error('Balanced OCR result is unavailable')
    }
    return {
      result: state.result,
      markdown: await readMarkdown(documentId, state.result.resultKey)
    }
  }

  async function resolveAsset(
    documentId: string,
    resultKey: string,
    assetPath: string
  ): Promise<string> {
    const result = deps.repos.documentOcr.getResultByKey(documentId, resultKey)
    if (!result) throw new RepoError('not_found', 'OCR result not found')
    const root = getOcrResultRoot(deps.getLibraryFolder(), documentId, resultKey)
    const candidate = resolve(root, assetPath)
    if (!assetPath || isAbsolute(assetPath) || !isWithin(root, candidate)) {
      throw new RepoError('invalid_path', 'Invalid OCR asset path')
    }
    await access(candidate, constants.R_OK)
    const entry = await lstat(candidate)
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new RepoError('invalid_path', 'OCR asset must be a regular file')
    }
    const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)])
    if (!isWithin(realRoot, realCandidate)) {
      throw new RepoError('invalid_path', 'OCR asset resolves outside the managed directory')
    }
    return candidate
  }

  async function prepareDocumentDelete(documentId: string): Promise<void> {
    const active = deps.repos.documentOcr.getActiveJob(documentId)
    if (active) await cancel(active.id)
    const root = getOcrDocumentRoot(deps.getLibraryFolder(), documentId)
    await rm(root, { recursive: true, force: true })
  }

  function destroy(): void {
    destroyed = true
    if (runningJobId) cancelled.add(runningJobId)
    deps.worker.destroy()
  }

  function stopWorker(): Promise<void> {
    return deps.worker.stop()
  }

  return {
    initialize,
    getState,
    start,
    cancel,
    readMarkdown,
    readCachedForAgent,
    prepareForAgent,
    resolveAsset,
    prepareDocumentDelete,
    stopWorker,
    destroy
  }
}

export type MineruDocumentService = ReturnType<typeof createMineruDocumentService>
