import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../src/main/db/migrations'
import { seedDefaultSettings } from '../../src/main/db/settings-seed'
import { createRepositories } from '../../src/main/db/repositories'
import type { OcrJob, OcrResult } from '../../src/shared/mineru-types'

const nodeRequire = createRequire(import.meta.url)
const { DatabaseSync } = nodeRequire('node:sqlite')

function createTestDb() {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = ON')
  const db = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    getUserVersion: () => {
      const row = raw.prepare('PRAGMA user_version').get() as { user_version: number }
      return row.user_version
    },
    setUserVersion: (version: number) => raw.exec(`PRAGMA user_version = ${version}`),
    hasColumn: (table: string, column: string) =>
      raw.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(table, column) !== undefined,
    hasObject: (type: 'table' | 'index', name: string) =>
      raw.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, name) !== undefined
  }
  runMigrations(db)
  seedDefaultSettings(db, 'en')
  db.prepare(
    `INSERT INTO documents (id, filePath, originalFolderPath, fileName, fileHash, addedAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('doc-1', '/tmp/doc.pdf', '/tmp', 'doc.pdf', 'source-1', 1, 1)
  return db
}

function makeJob(id = 'job-1'): OcrJob {
  return {
    id,
    documentId: 'doc-1',
    resultKey: 'result-1',
    sourceHash: 'source-1',
    profile: 'balanced',
    status: 'queued',
    stage: 'queued',
    progress: 0,
    errorCode: null,
    errorMessage: null,
    createdAt: 10,
    startedAt: null,
    finishedAt: null,
    updatedAt: 10
  }
}

function makeResult(sourceHash = 'source-1'): OcrResult {
  return {
    id: 'ocr-result-1',
    documentId: 'doc-1',
    resultKey: 'result-1',
    sourceHash,
    mineruVersion: '3.4.4',
    modelRevision: 'models-1',
    profile: 'balanced',
    optionsHash: 'options-1',
    schemaVersion: 1,
    relativeRoot: '.refora/derived/OCR/doc-1/result-1',
    markdownRelativePath: '.refora/derived/OCR/doc-1/result-1/document.md',
    blocksRelativePath: '.refora/derived/OCR/doc-1/result-1/blocks.jsonl',
    manifestRelativePath: '.refora/derived/OCR/doc-1/result-1/manifest.json',
    createdAt: 20,
    stale: false
  }
}

let repos: ReturnType<typeof createRepositories>

beforeEach(() => {
  repos = createRepositories(createTestDb())
})

describe('document OCR repository', () => {
  it('creates and updates an active job', () => {
    expect(repos.documentOcr.createJob(makeJob())).toMatchObject({
      id: 'job-1',
      status: 'queued',
      progress: 0
    })
    expect(repos.documentOcr.getAnyActiveJob()?.id).toBe('job-1')
    expect(repos.documentOcr.updateJob('job-1', {
      status: 'running',
      stage: 'parsing',
      progress: 0.5,
      startedAt: 12
    })).toMatchObject({ status: 'running', stage: 'parsing', progress: 0.5, startedAt: 12 })
  })

  it('marks unfinished jobs as interrupted', () => {
    repos.documentOcr.createJob(makeJob())
    expect(repos.documentOcr.markRunningInterrupted()).toBe(1)
    expect(repos.documentOcr.getJob('job-1')).toMatchObject({
      status: 'interrupted',
      errorCode: 'interrupted'
    })
    expect(repos.documentOcr.getAnyActiveJob()).toBeNull()
  })

  it('stores results and reports source changes as stale', () => {
    expect(repos.documentOcr.insertResult(makeResult())).toMatchObject({ stale: false })
    expect(repos.documentOcr.getResult('doc-1', 'source-1')).toMatchObject({
      resultKey: 'result-1',
      stale: false
    })
    expect(repos.documentOcr.getResult('doc-1', 'source-2')).toMatchObject({ stale: true })
    expect(repos.documentOcr.getResultByKey('doc-1', 'result-1')).toMatchObject({
      mineruVersion: '3.4.4'
    })
  })

  it('cascades OCR metadata when a document is deleted', () => {
    repos.documentOcr.createJob(makeJob())
    repos.documentOcr.insertResult(makeResult())
    repos.documents.delete('doc-1')
    expect(repos.documentOcr.getJob('job-1')).toBeNull()
    expect(repos.documentOcr.getResultByKey('doc-1', 'result-1')).toBeNull()
  })
})
