import { createRequire } from 'node:module'
import { runMigrations, type SqliteLike } from '../../src/main/db/migrations'
import type { NewDocument } from '../../src/main/db/repositories/documents'
import type { SqliteDb } from '../../src/main/db/types'

const nodeRequire = createRequire(import.meta.url)
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (location: string) => unknown
}

export interface RawStatement {
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
}

export interface MainTestDb {
  exec(sql: string): void
  prepare(sql: string): RawStatement
  close(): void
}

export function createMainTestDb(foreignKeys = true): MainTestDb {
  const db = new DatabaseSync(':memory:') as unknown as MainTestDb
  db.exec(`PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`)
  return db
}

export function adaptMainTestDb(db: MainTestDb): SqliteLike {
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
    },
    hasColumn: (table, column) =>
      db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(table, column) !== undefined,
    hasObject: (type, name) =>
      db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, name) !== undefined
  }
}

export function migrateMainTestDb(db: MainTestDb): SqliteDb {
  runMigrations(adaptMainTestDb(db))
  return db as unknown as SqliteDb
}

export function makeNewDocument(id: string, overrides: Partial<NewDocument> = {}): NewDocument {
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
    arxivId: null,
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
