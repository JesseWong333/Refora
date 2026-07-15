import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { runMigrations, type SqliteLike } from '../../src/main/db/migrations'
import { createAiReportsRepository } from '../../src/main/db/repositories/aiReports'
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
    exec: (sql) => {
      db.exec(sql)
    },
    getUserVersion: () => {
      const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
      return row?.user_version ?? 0
    },
    setUserVersion: (version) => {
      db.exec(`PRAGMA user_version = ${version}`)
    }
  }
}

function getSourceDocIds(db: RawDb, id: string): string[] {
  const row = db
    .prepare('SELECT sourceDocIds FROM ai_reports WHERE id = ?')
    .get(id) as { sourceDocIds?: string } | undefined
  if (!row?.sourceDocIds) return []
  try {
    const parsed = JSON.parse(row.sourceDocIds)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function insertReport(db: RawDb, id: string, sourceDocIds: string[]): void {
  db.prepare(
    `INSERT INTO ai_reports (id, workspaceId, title, contentMd, sourceDocIds, model, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, 'ws1', `Report ${id}`, '', JSON.stringify(sourceDocIds), null, 1000)
}

describe('aiReports repository - removeDocFromSources', () => {
  let db: RawDb

  beforeEach(() => {
    db = createDb()
    runMigrations(adapt(db))
    db.prepare(
      `INSERT INTO workspaces (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)`
    ).run('ws1', 'Test Workspace', 1000, 1000)
    insertReport(db, 'rA', ['doc1', 'doc2'])
    insertReport(db, 'rB', ['doc10', 'doc3'])
    insertReport(db, 'rC', ['doc2'])
    insertReport(db, 'rD', [])
  })

  it('removes doc1 from report A but leaves doc10 in report B unchanged', () => {
    const repo = createAiReportsRepository(db as unknown as SqliteDb)
    repo.removeDocFromSources('doc1')

    expect(getSourceDocIds(db, 'rA')).toEqual(['doc2'])
    expect(getSourceDocIds(db, 'rB')).toEqual(['doc10', 'doc3'])
    expect(getSourceDocIds(db, 'rC')).toEqual(['doc2'])
    expect(getSourceDocIds(db, 'rD')).toEqual([])
  })

  it('removes doc2 from reports A and C', () => {
    const repo = createAiReportsRepository(db as unknown as SqliteDb)
    repo.removeDocFromSources('doc2')

    expect(getSourceDocIds(db, 'rA')).toEqual(['doc1'])
    expect(getSourceDocIds(db, 'rC')).toEqual([])
    expect(getSourceDocIds(db, 'rB')).toEqual(['doc10', 'doc3'])
    expect(getSourceDocIds(db, 'rD')).toEqual([])
  })

  it('removes doc1 then doc2 sequentially from report A', () => {
    const repo = createAiReportsRepository(db as unknown as SqliteDb)
    repo.removeDocFromSources('doc1')
    expect(getSourceDocIds(db, 'rA')).toEqual(['doc2'])

    repo.removeDocFromSources('doc2')
    expect(getSourceDocIds(db, 'rA')).toEqual([])
    expect(getSourceDocIds(db, 'rC')).toEqual([])
  })

  it('no-ops for a nonexistent docId', () => {
    const repo = createAiReportsRepository(db as unknown as SqliteDb)
    repo.removeDocFromSources('nonexistent')

    expect(getSourceDocIds(db, 'rA')).toEqual(['doc1', 'doc2'])
    expect(getSourceDocIds(db, 'rB')).toEqual(['doc10', 'doc3'])
    expect(getSourceDocIds(db, 'rC')).toEqual(['doc2'])
    expect(getSourceDocIds(db, 'rD')).toEqual([])
  })

  it('does not match doc1 against doc10 (LIKE boundary safety)', () => {
    const repo = createAiReportsRepository(db as unknown as SqliteDb)
    repo.removeDocFromSources('doc1')

    expect(getSourceDocIds(db, 'rB')).toEqual(['doc10', 'doc3'])
  })
})
