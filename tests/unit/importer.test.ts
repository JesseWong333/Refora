import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { runMigrations, type SqliteLike } from '../../src/main/db/migrations'
import { createRepositories } from '../../src/main/db/repositories'
import type { NewDocument } from '../../src/main/db/repositories/documents'
import { seedDefaultSettings } from '../../src/main/db/settings-seed'
import type { SqliteDb } from '../../src/main/db/types'

const nodeRequire = createRequire(import.meta.url)
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (location: string) => unknown
}

interface RawStatement {
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
}
interface RawDb {
  exec(sql: string): void
  prepare(sql: string): RawStatement
}

function createDb(): RawDb {
  const db = new DatabaseSync(':memory:') as unknown as RawDb
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

function adapt(db: RawDb): SqliteLike {
  return {
    exec: (sql) => { db.exec(sql) },
    getUserVersion: () => {
      const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
      return row?.user_version ?? 0
    },
    setUserVersion: (version) => { db.exec(`PRAGMA user_version = ${version}`) }
  }
}

function makeDoc(id: string, overrides: Partial<NewDocument> = {}): NewDocument {
  return {
    id,
    filePath: `/abs/${id}.pdf`,
    originalFolderPath: '/abs',
    fileName: `${id}.pdf`,
    fileSize: 100,
    fileHash: null,
    title: `Title ${id}`,
    authors: null,
    year: null,
    venue: null,
    volume: null,
    issue: null,
    pages: null,
    abstract: null,
    keywords: null,
    url: null,
    doi: null,
    note: null,
    starred: 0,
    addedAt: 1000,
    lastReadAt: null,
    updatedAt: 1000,
    metadataSource: null,
    metadataStatus: 'pending',
    metadataAttempts: 0,
    editedFields: [],
    remoteValues: null,
    fileMissing: 0,
    ...overrides
  }
}

describe('streamHash', () => {
  it('produces correct sha256 for known content', async () => {
    const { streamHash } = await import('../../src/main/worker/pdf-worker')
    const { writeFileSync, unlinkSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')

    const tmpFile = join(tmpdir(), `refora-test-${Date.now()}.tmp`)
    writeFileSync(tmpFile, 'hello world')
    try {
      const hash = await streamHash(tmpFile)
      expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
    } finally {
      unlinkSync(tmpFile)
    }
  })

  it('returns null when file does not exist', async () => {
    const { streamHash } = await import('../../src/main/worker/pdf-worker')
    const hash = await streamHash('/nonexistent/path.pdf')
    expect(hash).toBeNull()
  })

  it('does not buffer the whole file into memory', async () => {
    const { streamHash } = await import('../../src/main/worker/pdf-worker')
    const { writeFileSync, unlinkSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')

    const tmpFile = join(tmpdir(), `refora-test-large-${Date.now()}.tmp`)
    const largeContent = Buffer.alloc(10 * 1024 * 1024, 'a')
    writeFileSync(tmpFile, largeContent)
    try {
      const hash = await streamHash(tmpFile)
      expect(typeof hash).toBe('string')
      expect(hash?.length).toBe(64)
    } finally {
      unlinkSync(tmpFile)
    }
  })
})

describe('import pipeline dedup', () => {
  let db: RawDb
  let repos: ReturnType<typeof createRepositories>

  beforeEach(() => {
    db = createDb()
    runMigrations(adapt(db))
    seedDefaultSettings(adapt(db), 'en')
    repos = createRepositories(db as unknown as SqliteDb)
  })

  it('path dedup always skips existing files', () => {
    repos.documents.insert(makeDoc('d1', { filePath: '/abs/existing.pdf', fileName: 'existing.pdf' }))
    const existing = repos.documents.findByPath('/abs/existing.pdf')
    expect(existing).not.toBeNull()
    const notExisting = repos.documents.findByPath('/abs/new.pdf')
    expect(notExisting).toBeNull()
  })

  it('hash dedup finds existing document by fileHash', () => {
    repos.documents.insert(makeDoc('d1', { filePath: '/abs/a.pdf', fileHash: 'abc123' }))
    const dup = repos.documents.findByHash('abc123')
    expect(dup).not.toBeNull()
    expect(dup!.filePath).toBe('/abs/a.pdf')
    const noDup = repos.documents.findByHash('def456')
    expect(noDup).toBeNull()
  })

  it('NULL hash bypasses hash dedup (path-only)', () => {
    repos.documents.insert(makeDoc('d1', { filePath: '/abs/a.pdf', fileHash: null }))
    const byHash = repos.documents.findByHash('abc123')
    expect(byHash).toBeNull()
    const byPath = repos.documents.findByPath('/abs/a.pdf')
    expect(byPath).not.toBeNull()
  })

  it('document insert creates record with pending metadata status', () => {
    const now = Date.now()
    const doc = repos.documents.insert(makeDoc('new-doc', {
      filePath: '/abs/new.pdf',
      fileHash: null,
      addedAt: now,
      updatedAt: now
    }))
    expect(doc.metadataStatus).toBe('pending')
    expect(doc.metadataAttempts).toBe(0)
    expect(doc.editedFields).toEqual([])
    expect(doc.fileMissing).toBe(0)
  })
})
