import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { runMigrations, trigramAvailable, ftsColumns, type SqliteLike } from '../../src/main/db/migrations'
import {
  seedDefaultSettings,
  DEFAULT_LIBRARY_FOLDER,
  SETTING_KEYS
} from '../../src/main/db/settings-seed'

const nodeRequire = createRequire(import.meta.url)
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (location: string) => unknown
}

interface SqliteStatement {
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
}
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
}

function createDb(): SqliteDb {
  const db = new DatabaseSync(':memory:') as unknown as SqliteDb
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

function adapt(db: SqliteDb): SqliteLike {
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

function userVersion(db: SqliteDb): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  return row?.user_version ?? 0
}

function ftsCount(db: SqliteDb): number {
  const row = db.prepare('SELECT count(*) AS c FROM docs_fts').get() as { c: number }
  return row.c
}

function matchCount(db: SqliteDb, query: string): number {
  const row = db.prepare('SELECT count(*) AS c FROM docs_fts WHERE docs_fts MATCH ?').get(query) as {
    c: number
  }
  return row.c
}

function insertDoc(db: SqliteDb, id: string, title: string | null): void {
  db.prepare(
    `INSERT INTO documents (id, filePath, originalFolderPath, fileName, title, addedAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, `/abs/${id}.pdf`, '/abs', `${id}.pdf`, title, 1000, 1000)
}

function rowidOf(db: SqliteDb, id: string): number {
  const row = db.prepare('SELECT rowid AS r FROM documents WHERE id = ?').get(id) as { r: number }
  return row.r
}

describe('db migrations + schema', () => {
  let db: SqliteDb

  beforeEach(() => {
    db = createDb()
  })

  it('creates the v1 schema on a fresh db and sets user_version=1', () => {
    expect(userVersion(db)).toBe(0)
    const result = runMigrations(adapt(db))
    expect(result.from).toBe(0)
    expect(result.to).toBe(1)
    expect(userVersion(db)).toBe(1)

    for (const table of ['documents', 'categories', 'document_categories', 'watch_folders', 'settings', 'docs_fts']) {
      const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table)
      expect(row?.name).toBe(table)
    }
    for (const trigger of ['documents_ai', 'documents_ad', 'documents_au']) {
      const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name=?`).get(trigger)
      expect(row?.name).toBe(trigger)
    }
  })

  it('verifies the trigram tokenizer at runtime', () => {
    expect(trigramAvailable(adapt(db))).toBe(true)
    runMigrations(adapt(db))
    const result = runMigrations(adapt(db))
    expect(result.trigram).toBe(true)
    expect(result.searchMode).toBe('trigram')
  })

  it('indexes documents and matches ASCII + CJK substrings via trigram', () => {
    runMigrations(adapt(db))
    insertDoc(db, 'd1', 'apple pie')
    insertDoc(db, 'd2', '机器学习论文')
    expect(ftsCount(db)).toBe(2)
    expect(matchCount(db, 'ppl')).toBe(1)
    expect(matchCount(db, '机器学')).toBe(1)
  })

  it('is idempotent: running migrations twice does not error or change version', () => {
    runMigrations(adapt(db))
    const second = runMigrations(adapt(db))
    expect(second.from).toBe(1)
    expect(second.to).toBe(1)
    expect(userVersion(db)).toBe(1)
  })

  it('cascades document deletion to document_categories (foreign_keys=ON)', () => {
    runMigrations(adapt(db))
    db.prepare(
      `INSERT INTO documents (id, filePath, originalFolderPath, fileName, addedAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('d1', '/abs/d1.pdf', '/abs', 'd1.pdf', 1000, 1000)
    db.prepare(`INSERT INTO categories (id, name, sortOrder, createdAt) VALUES (?, ?, ?, ?)`).run(
      'c1',
      'Cat',
      0,
      1000
    )
    db.prepare(`INSERT INTO document_categories (documentId, categoryId) VALUES (?, ?)`).run('d1', 'c1')

    const before = db.prepare(`SELECT count(*) AS c FROM document_categories WHERE documentId=?`).get('d1') as {
      c: number
    }
    expect(before.c).toBe(1)

    db.prepare(`DELETE FROM documents WHERE id=?`).run('d1')

    const after = db.prepare(`SELECT count(*) AS c FROM document_categories WHERE documentId=?`).get('d1') as {
      c: number
    }
    expect(after.c).toBe(0)
  })

  it('does NOT reindex FTS when toggling non-FTS columns (trigger scoping regression)', () => {
    runMigrations(adapt(db))
    insertDoc(db, 'd1', 'apple')
    expect(matchCount(db, 'apple')).toBe(1)

    // Positive control: updating an FTS column fires the trigger (reindex).
    db.prepare(`UPDATE documents SET title = ? WHERE id = ?`).run('banana', 'd1')
    expect(matchCount(db, 'banana')).toBe(1)
    expect(matchCount(db, 'apple')).toBe(0)

    // Desync the FTS index from the documents row by manually removing the
    // indexed entry (bypassing the ad trigger). A correctly-scoped au trigger
    // must NOT re-add it when only non-FTS columns change. We measure via MATCH
    // (not count(*)) because for external-content FTS5 tables count(*) reflects
    // the content table, not the index.
    const cols = ftsColumns()
    const colList = cols.join(', ')
    const placeholders = cols.map(() => '?').join(', ')
    const r = rowidOf(db, 'd1')
    const deleteValues: unknown[] = [r, 'banana', ...cols.slice(1).map(() => null)]
    db.prepare(`INSERT INTO docs_fts(docs_fts, rowid, ${colList}) VALUES ('delete', ?, ${placeholders})`).run(
      ...deleteValues
    )
    expect(matchCount(db, 'banana')).toBe(0)

    // Toggle every non-FTS column named in the spec. None of these appear in the
    // `UPDATE OF` clause of documents_au, so the index must stay desynced (0).
    const nonFtsUpdates: Array<[string, unknown[]]> = [
      ['UPDATE documents SET starred = 1 WHERE id = ?', ['d1']],
      ['UPDATE documents SET lastReadAt = 555 WHERE id = ?', ['d1']],
      ['UPDATE documents SET editedFields = ? WHERE id = ?', ['["title"]', 'd1']],
      ['UPDATE documents SET metadataStatus = ? WHERE id = ?', ['done', 'd1']],
      ['UPDATE documents SET metadataAttempts = 2 WHERE id = ?', ['d1']],
      ['UPDATE documents SET fileMissing = 1 WHERE id = ?', ['d1']],
      ['UPDATE documents SET remoteValues = ? WHERE id = ?', [JSON.stringify({ title: { value: 'x', source: 'manual' } }), 'd1']],
      ['UPDATE documents SET filePath = ? WHERE id = ?', ['/abs/moved.pdf', 'd1']],
      ['UPDATE documents SET updatedAt = 999 WHERE id = ?', ['d1']],
      ['UPDATE documents SET volume = ? WHERE id = ?', ['42', 'd1']]
    ]
    for (const [sql, params] of nonFtsUpdates) {
      db.prepare(sql).run(...params)
      expect(matchCount(db, 'banana')).toBe(0)
    }
  })
})

describe('settings seeding', () => {
  let db: SqliteDb

  beforeEach(() => {
    db = createDb()
    runMigrations(adapt(db))
  })

  it('seeds all default settings keys on first run with correct values', () => {
    seedDefaultSettings(adapt(db), 'en')

    const rows = db.prepare(`SELECT key, value FROM settings`).all() as Array<{
      key: string
      value: string
    }>
    const map = new Map(rows.map((r) => [r.key, r.value]))

    expect(new Set(map.keys())).toEqual(new Set<string>(SETTING_KEYS))
    expect(map.get('libraryFolderPath')).toBe(JSON.stringify(DEFAULT_LIBRARY_FOLDER))
    expect(map.get('crossrefMailto')).toBe(JSON.stringify(''))
    expect(map.get('theme')).toBe(JSON.stringify('dark'))
    expect(map.get('sidebarCollapsed')).toBe(JSON.stringify('0'))
    expect(map.get('lastWatchScanAt')).toBe(JSON.stringify(0))
    expect(map.get('language')).toBe(JSON.stringify('en'))
    expect(map.get('moveToLibraryOnCategorize')).toBe(JSON.stringify('1'))
    expect(map.get('proxyUrl')).toBe(JSON.stringify(''))
    expect(map.get('windowBounds')).toBe(JSON.stringify(null))
    expect(map.get('listColumnState')).toBe(JSON.stringify(null))
  })

  it('does not overwrite existing settings on re-seed (INSERT OR IGNORE)', () => {
    seedDefaultSettings(adapt(db), 'en')
    db.prepare(`UPDATE settings SET value = ? WHERE key = ?`).run(JSON.stringify('zh'), 'language')

    seedDefaultSettings(adapt(db), 'en')

    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get('language') as {
      value: string
    }
    expect(row.value).toBe(JSON.stringify('zh'))
  })
})
