import type { OcrJob, OcrJobStage, OcrJobStatus, OcrProfile, OcrResult } from '../../../shared/mineru-types'
import type { SqliteDb } from '../types'

function mapJob(row: Record<string, unknown>): OcrJob {
  return {
    id: row.id as string,
    documentId: row.documentId as string,
    resultKey: row.resultKey as string,
    sourceHash: row.sourceHash as string,
    profile: row.profile as OcrProfile,
    status: row.status as OcrJobStatus,
    stage: row.stage as OcrJobStage,
    progress: (row.progress as number | null) ?? null,
    errorCode: (row.errorCode as string | null) ?? null,
    errorMessage: (row.errorMessage as string | null) ?? null,
    createdAt: row.createdAt as number,
    startedAt: (row.startedAt as number | null) ?? null,
    finishedAt: (row.finishedAt as number | null) ?? null,
    updatedAt: row.updatedAt as number
  }
}

function mapResult(row: Record<string, unknown>, sourceHash?: string | null): OcrResult {
  return {
    id: row.id as string,
    documentId: row.documentId as string,
    resultKey: row.resultKey as string,
    sourceHash: row.sourceHash as string,
    mineruVersion: row.mineruVersion as string,
    modelRevision: row.modelRevision as string,
    profile: row.profile as OcrProfile,
    optionsHash: row.optionsHash as string,
    schemaVersion: row.schemaVersion as number,
    relativeRoot: row.relativeRoot as string,
    markdownRelativePath: row.markdownRelativePath as string,
    blocksRelativePath: row.blocksRelativePath as string,
    manifestRelativePath: row.manifestRelativePath as string,
    createdAt: row.createdAt as number,
    stale: sourceHash != null && row.sourceHash !== sourceHash
  }
}

export function createDocumentOcrRepository(db: SqliteDb) {
  function createJob(job: OcrJob): OcrJob {
    db.prepare(
      `INSERT INTO document_ocr_jobs
       (id, documentId, resultKey, sourceHash, profile, status, stage, progress, errorCode,
        errorMessage, createdAt, startedAt, finishedAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      job.id,
      job.documentId,
      job.resultKey,
      job.sourceHash,
      job.profile,
      job.status,
      job.stage,
      job.progress,
      job.errorCode,
      job.errorMessage,
      job.createdAt,
      job.startedAt,
      job.finishedAt,
      job.updatedAt
    )
    return getJob(job.id) as OcrJob
  }

  function getJob(id: string): OcrJob | null {
    const row = db.prepare('SELECT * FROM document_ocr_jobs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    return row ? mapJob(row) : null
  }

  function getActiveJob(documentId: string): OcrJob | null {
    const row = db.prepare(
      `SELECT * FROM document_ocr_jobs
       WHERE documentId = ? AND status IN ('queued', 'running')
       ORDER BY createdAt DESC LIMIT 1`
    ).get(documentId) as Record<string, unknown> | undefined
    return row ? mapJob(row) : null
  }

  function getAnyActiveJob(): OcrJob | null {
    const row = db.prepare(
      `SELECT * FROM document_ocr_jobs
       WHERE status IN ('queued', 'running')
       ORDER BY createdAt ASC LIMIT 1`
    ).get() as Record<string, unknown> | undefined
    return row ? mapJob(row) : null
  }

  function updateJob(
    id: string,
    patch: Partial<Pick<OcrJob, 'status' | 'stage' | 'progress' | 'errorCode' | 'errorMessage' | 'startedAt' | 'finishedAt'>>
  ): OcrJob {
    const current = getJob(id)
    if (!current) throw new Error(`OCR job not found: ${id}`)
    const next = { ...current, ...patch, updatedAt: Date.now() }
    db.prepare(
      `UPDATE document_ocr_jobs SET
       status = ?, stage = ?, progress = ?, errorCode = ?, errorMessage = ?,
       startedAt = ?, finishedAt = ?, updatedAt = ? WHERE id = ?`
    ).run(
      next.status,
      next.stage,
      next.progress,
      next.errorCode,
      next.errorMessage,
      next.startedAt,
      next.finishedAt,
      next.updatedAt,
      id
    )
    return getJob(id) as OcrJob
  }

  function markRunningInterrupted(): number {
    const now = Date.now()
    return db.prepare(
      `UPDATE document_ocr_jobs
       SET status = 'interrupted', errorCode = 'interrupted',
           errorMessage = 'OCR process stopped before completion', finishedAt = ?, updatedAt = ?
       WHERE status IN ('queued', 'running')`
    ).run(now, now).changes
  }

  function insertResult(result: OcrResult): OcrResult {
    db.prepare(
      `INSERT INTO document_ocr_results
       (id, documentId, resultKey, sourceHash, mineruVersion, modelRevision, profile,
        optionsHash, schemaVersion, relativeRoot, markdownRelativePath, blocksRelativePath,
        manifestRelativePath, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(documentId, resultKey) DO UPDATE SET
         sourceHash = excluded.sourceHash,
         mineruVersion = excluded.mineruVersion,
         modelRevision = excluded.modelRevision,
         profile = excluded.profile,
         optionsHash = excluded.optionsHash,
         schemaVersion = excluded.schemaVersion,
         relativeRoot = excluded.relativeRoot,
         markdownRelativePath = excluded.markdownRelativePath,
         blocksRelativePath = excluded.blocksRelativePath,
         manifestRelativePath = excluded.manifestRelativePath,
         createdAt = excluded.createdAt`
    ).run(
      result.id,
      result.documentId,
      result.resultKey,
      result.sourceHash,
      result.mineruVersion,
      result.modelRevision,
      result.profile,
      result.optionsHash,
      result.schemaVersion,
      result.relativeRoot,
      result.markdownRelativePath,
      result.blocksRelativePath,
      result.manifestRelativePath,
      result.createdAt
    )
    return getResult(result.documentId, result.sourceHash) as OcrResult
  }

  function getResult(documentId: string, sourceHash?: string | null): OcrResult | null {
    const row = db.prepare(
      `SELECT * FROM document_ocr_results WHERE documentId = ? ORDER BY createdAt DESC LIMIT 1`
    ).get(documentId) as Record<string, unknown> | undefined
    return row ? mapResult(row, sourceHash) : null
  }

  function getResultByKey(documentId: string, resultKey: string): OcrResult | null {
    const row = db.prepare(
      'SELECT * FROM document_ocr_results WHERE documentId = ? AND resultKey = ?'
    ).get(documentId, resultKey) as Record<string, unknown> | undefined
    return row ? mapResult(row) : null
  }

  function removeResult(documentId: string, resultKey: string): void {
    db.prepare('DELETE FROM document_ocr_results WHERE documentId = ? AND resultKey = ?')
      .run(documentId, resultKey)
  }

  return {
    createJob,
    getJob,
    getActiveJob,
    getAnyActiveJob,
    updateJob,
    markRunningInterrupted,
    insertResult,
    getResult,
    getResultByKey,
    deleteResult: removeResult
  }
}
