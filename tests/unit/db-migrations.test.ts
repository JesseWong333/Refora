import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import {
  runMigrations,
  trigramAvailable,
  ftsColumns,
  loadMigrationFiles,
  type SqliteLike
} from '../../src/main/db/migrations'
import schemaSql from '../../src/main/db/schema.sql?raw'
import {
  seedDefaultSettings,
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
    },
    hasColumn: (table, column) =>
      db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(table, column) !== undefined,
    hasObject: (type, name) =>
      db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, name) !== undefined
  }
}

function migrateThrough(db: SqliteDb, version: number): void {
  db.exec(schemaSql)
  for (const migration of loadMigrationFiles().filter((item) => item.version <= version)) {
    db.exec(migration.sql)
  }
  db.exec(`PRAGMA user_version = ${version}`)
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

  it('runs all migrations on a fresh db and sets user_version to the latest', () => {
    expect(userVersion(db)).toBe(0)
    const result = runMigrations(adapt(db))
    expect(result.from).toBe(0)
    expect(result.to).toBe(26)
    expect(userVersion(db)).toBe(26)

    for (const table of ['documents', 'categories', 'document_categories', 'watch_folders', 'settings', 'docs_fts', 'agent_trace_steps', 'agent_runs', 'agent_interrupts', 'agent_tool_effects', 'workspace_agent_memories', 'workspace_agent_memory_revisions', 'workspace_connections', 'workspace_assets', 'document_ocr_jobs', 'document_ocr_results', 'web_search_config']) {
      const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table)
      expect(row?.name).toBe(table)
    }
    for (const trigger of ['documents_ai', 'documents_ad', 'documents_au']) {
      const triggerRow = db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name=?`).get(trigger)
      expect(triggerRow?.name).toBe(trigger)
    }

    const summaryCols = db.prepare(`PRAGMA table_info(ai_summaries)`).all() as Array<{ name: string }>
    expect(summaryCols.map((c) => c.name)).toContain('fullTextHash')

    const documentCols = db.prepare(`PRAGMA table_info(documents)`).all() as Array<{ name: string }>
    expect(documentCols.map((c) => c.name)).toContain('arxivId')

    const providerCols = db.prepare(`PRAGMA table_info(ai_providers)`).all() as Array<{ name: string }>
    expect(providerCols.map((c) => c.name)).toContain('temperature')
    expect(providerCols.map((c) => c.name)).toContain('maxTokens')
    expect(providerCols.map((c) => c.name)).toContain('modelsJson')
    expect(db.prepare('SELECT provider FROM web_search_config WHERE id = 1').get())
      .toMatchObject({ provider: 'ddgs' })

    const workspaceItemCols = db.prepare(`PRAGMA table_info(workspace_items)`).all() as Array<{ name: string }>
    expect(workspaceItemCols.map((c) => c.name)).toContain('assetId')
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
    expect(second.from).toBe(26)
    expect(second.to).toBe(26)
    expect(userVersion(db)).toBe(26)
  })

  it('preserves an explicit disabled web-search choice while defaulting untouched config to DDGS', () => {
    migrateThrough(db, 25)
    db.prepare(
      "UPDATE web_search_config SET provider = 'disabled', updatedAt = 123 WHERE id = 1"
    ).run()

    const result = runMigrations(adapt(db))

    expect(result.from).toBe(25)
    expect(result.to).toBe(26)
    expect(db.prepare('SELECT provider, updatedAt FROM web_search_config WHERE id = 1').get())
      .toMatchObject({ provider: 'disabled', updatedAt: 123 })
  })

  it('repairs a missing OCR job status index at the current schema version', () => {
    runMigrations(adapt(db))
    db.exec('DROP INDEX idx_document_ocr_jobs_status')

    const result = runMigrations(adapt(db))

    expect(result.from).toBe(26)
    expect(result.to).toBe(26)
    expect(db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_document_ocr_jobs_status'"
    ).get()).toMatchObject({ name: 'idx_document_ocr_jobs_status' })
  })

  it('preserves existing canvas connections while adding asset-backed cards', () => {
    migrateThrough(db, 18)
    db.prepare('INSERT INTO workspaces (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run('ws-1', 'Research', 1, 1)
    for (const id of ['doc-1', 'doc-2']) {
      db.prepare(
        `INSERT INTO documents (id, filePath, originalFolderPath, fileName, addedAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, `/tmp/${id}.pdf`, '/tmp', `${id}.pdf`, 1, 1)
    }
    db.prepare(
      `INSERT INTO workspace_items
       (id, workspaceId, kind, docId, reportId, noteId, sortOrder, width, height, x, y, zIndex, addedAt)
       VALUES (?, ?, 'document', ?, NULL, NULL, ?, 300, 200, ?, 0, ?, 1)`
    ).run('item-1', 'ws-1', 'doc-1', 0, 0, 0)
    db.prepare(
      `INSERT INTO workspace_items
       (id, workspaceId, kind, docId, reportId, noteId, sortOrder, width, height, x, y, zIndex, addedAt)
       VALUES (?, ?, 'document', ?, NULL, NULL, ?, 300, 200, ?, 0, ?, 1)`
    ).run('item-2', 'ws-1', 'doc-2', 1, 400, 1)
    db.prepare(
      `INSERT INTO workspace_connections
       (id, workspaceId, sourceItemId, targetItemId, sourceAnchor, targetAnchor, createdAt)
       VALUES (?, ?, ?, ?, 'right', 'left', ?)`
    ).run('connection-1', 'ws-1', 'item-1', 'item-2', 1)

    const result = runMigrations(adapt(db))

    expect(result.to).toBe(26)
    expect(db.prepare('SELECT * FROM workspace_connections WHERE id = ?').get('connection-1'))
      .toBeDefined()
    expect(db.prepare("SELECT 1 FROM pragma_table_info('workspace_items') WHERE name = 'assetId'").get())
      .toBeDefined()
    expect(() => db.prepare('UPDATE workspace_items SET width = ?, height = ? WHERE id = ?')
      .run(1, 10_000, 'item-1')).not.toThrow()
  })

  it('preserves existing chat data and allows global threads', () => {
    migrateThrough(db, 19)
    db.prepare('INSERT INTO workspaces (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run('ws-1', 'Research', 1, 1)
    db.prepare(
      'INSERT INTO chat_threads (id, workspaceId, providerId, createdAt, title) VALUES (?, ?, ?, ?, ?)'
    ).run('thread-1', 'ws-1', 'provider-1', 1, 'Existing chat')
    db.prepare(
      'INSERT INTO chat_messages (id, threadId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)'
    ).run('message-1', 'thread-1', 'user', 'Existing message', 2)
    db.prepare(
      `INSERT INTO agent_trace_steps
       (id, threadId, runId, kind, name, input, output, status, startedAt, endedAt, seq,
        inputTokens, outputTokens, totalTokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'trace-1', 'thread-1', 'run-1', 'llm', 'model_call', 'input', 'output', 'done',
      3, 4, 0, 10, 20, 30
    )

    const result = runMigrations(adapt(db))

    expect(result.to).toBe(26)
    expect(db.prepare('SELECT * FROM chat_threads WHERE id = ?').get('thread-1'))
      .toMatchObject({ workspaceId: 'ws-1', title: 'Existing chat' })
    expect(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get('message-1'))
      .toMatchObject({ content: 'Existing message' })
    expect(db.prepare('SELECT * FROM agent_trace_steps WHERE id = ?').get('trace-1'))
      .toMatchObject({ inputTokens: 10, outputTokens: 20, totalTokens: 30 })

    const workspaceColumn = db
      .prepare("SELECT * FROM pragma_table_info('chat_threads') WHERE name = 'workspaceId'")
      .get() as { notnull: number }
    expect(workspaceColumn.notnull).toBe(0)
    db.prepare(
      'INSERT INTO chat_threads (id, workspaceId, providerId, createdAt, title) VALUES (?, NULL, ?, ?, ?)'
    ).run('global-thread', 'provider-1', 5, 'Global chat')

    db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-1')

    expect(db.prepare('SELECT * FROM chat_threads WHERE id = ?').get('thread-1')).toBeUndefined()
    expect(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get('message-1')).toBeUndefined()
    expect(db.prepare('SELECT * FROM agent_trace_steps WHERE id = ?').get('trace-1')).toBeUndefined()
    expect(db.prepare('SELECT * FROM chat_threads WHERE id = ?').get('global-thread')).toBeDefined()
  })

  it('reconciles a database created by the workspace branch before migrations were renumbered', () => {
    migrateThrough(db, 11)
    const migrations = loadMigrationFiles()
    for (const version of [14, 15, 16, 17]) {
      db.exec(migrations.find((migration) => migration.version === version)!.sql)
    }
    db.exec('PRAGMA user_version = 14')

    const result = runMigrations(adapt(db))

    expect(result.to).toBe(26)
    expect(db.prepare("SELECT 1 FROM pragma_table_info('documents') WHERE name = 'affiliations'").get())
      .toBeDefined()
    expect(db.prepare("SELECT 1 FROM pragma_table_info('ai_providers') WHERE name = 'presetId'").get())
      .toBeDefined()
    expect(db.prepare("SELECT 1 FROM pragma_table_info('workspace_items') WHERE name = 'x'").get())
      .toBeDefined()
    expect(db.prepare("SELECT 1 FROM pragma_table_info('workspace_notes') WHERE name = 'noteType'").get())
      .toBeDefined()
    expect(db.prepare("SELECT 1 FROM pragma_table_info('ai_providers') WHERE name = 'modelsJson'").get())
      .toBeDefined()
  })

  it('reconciles a database created by the provider branch at the same migration number', () => {
    migrateThrough(db, 11)
    const providerMigration = loadMigrationFiles().find((migration) => migration.version === 13)!
    db.exec(providerMigration.sql)
    db.exec('PRAGMA user_version = 12')

    const result = runMigrations(adapt(db))

    expect(result.to).toBe(26)
    expect(db.prepare("SELECT 1 FROM pragma_table_info('documents') WHERE name = 'affiliations'").get())
      .toBeDefined()
    expect(db.prepare("SELECT 1 FROM pragma_table_info('ai_providers') WHERE name = 'reasoningEffort'").get())
      .toBeDefined()
    expect(db.prepare("SELECT 1 FROM pragma_table_info('workspace_items') WHERE name = 'noteId'").get())
      .toBeDefined()
  })

  it('drops the legacy moveToLibrary column from categories', () => {
    runMigrations(adapt(db))
    const cols = db.prepare(`PRAGMA table_info(categories)`).all() as Array<{ name: string }>
    const names = cols.map((c) => c.name)
    expect(names).not.toContain('moveToLibrary')
    expect(names).toContain('name')
    expect(names).toContain('sortOrder')
    expect(names).toContain('createdAt')
  })

  it('drops moveToLibrary from a pre-migration v1 schema', () => {
    db.exec('PRAGMA user_version = 0')
    db.exec(`
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        filePath TEXT NOT NULL,
        originalFolderPath TEXT NOT NULL,
        fileName TEXT NOT NULL,
        fileSize INTEGER,
        fileHash TEXT,
        title TEXT,
        authors TEXT,
        year TEXT,
        venue TEXT,
        volume TEXT,
        abstract TEXT,
        keywords TEXT,
        url TEXT,
        doi TEXT,
        note TEXT,
        starred INTEGER NOT NULL DEFAULT 0,
        addedAt INTEGER NOT NULL,
        lastReadAt INTEGER,
        updatedAt INTEGER NOT NULL,
        metadataSource TEXT,
        metadataStatus TEXT NOT NULL DEFAULT 'pending',
        metadataAttempts INTEGER NOT NULL DEFAULT 0,
        editedFields TEXT NOT NULL DEFAULT '[]',
        remoteValues TEXT,
        fileMissing INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        moveToLibrary INTEGER,
        createdAt INTEGER NOT NULL,
        UNIQUE(name)
      );
      CREATE TABLE document_categories (
        documentId TEXT NOT NULL,
        categoryId TEXT NOT NULL,
        PRIMARY KEY (documentId, categoryId),
        FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE,
        FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE CASCADE
      );
      CREATE TABLE watch_folders (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        addedAt INTEGER NOT NULL
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    db.exec(`PRAGMA user_version = 1`)
    const result = runMigrations(adapt(db))
    expect(result.to).toBe(26)
    const cols = db.prepare(`PRAGMA table_info(categories)`).all() as Array<{ name: string }>
    expect(cols.map((c) => c.name)).not.toContain('moveToLibrary')
  })

  it('migration 0004 adds issue and pages columns to documents', () => {
    db.exec('PRAGMA user_version = 0')
    db.exec(`
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        filePath TEXT NOT NULL,
        originalFolderPath TEXT NOT NULL,
        fileName TEXT NOT NULL,
        fileSize INTEGER,
        fileHash TEXT,
        title TEXT,
        authors TEXT,
        year TEXT,
        venue TEXT,
        volume TEXT,
        abstract TEXT,
        keywords TEXT,
        url TEXT,
        doi TEXT,
        note TEXT,
        starred INTEGER NOT NULL DEFAULT 0,
        addedAt INTEGER NOT NULL,
        lastReadAt INTEGER,
        updatedAt INTEGER NOT NULL,
        metadataSource TEXT,
        metadataStatus TEXT NOT NULL DEFAULT 'pending',
        metadataAttempts INTEGER NOT NULL DEFAULT 0,
        editedFields TEXT NOT NULL DEFAULT '[]',
        remoteValues TEXT,
        fileMissing INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        moveToLibrary INTEGER,
        createdAt INTEGER NOT NULL,
        UNIQUE(name)
      );
      CREATE TABLE document_categories (
        documentId TEXT NOT NULL,
        categoryId TEXT NOT NULL,
        PRIMARY KEY (documentId, categoryId),
        FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE,
        FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE CASCADE
      );
      CREATE TABLE watch_folders (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        addedAt INTEGER NOT NULL
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    db.exec(`PRAGMA user_version = 3`)
    const result = runMigrations(adapt(db))
    expect(result.to).toBe(26)

    const cols = db.prepare(`PRAGMA table_info(documents)`).all() as Array<{ name: string }>
    const names = cols.map((c) => c.name)
    expect(names).toContain('issue')
    expect(names).toContain('pages')
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

  it('migration 0003 rewrites library-absolute filePaths to library-relative', () => {
    // Build a v2 schema (post-0002, pre-0003) without running 0004 twice.
    db.exec(`
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        filePath TEXT NOT NULL,
        originalFolderPath TEXT NOT NULL,
        fileName TEXT NOT NULL,
        fileSize INTEGER,
        fileHash TEXT,
        title TEXT,
        authors TEXT,
        year TEXT,
        venue TEXT,
        volume TEXT,
        abstract TEXT,
        keywords TEXT,
        url TEXT,
        doi TEXT,
        note TEXT,
        starred INTEGER NOT NULL DEFAULT 0,
        addedAt INTEGER NOT NULL,
        lastReadAt INTEGER,
        updatedAt INTEGER NOT NULL,
        metadataSource TEXT,
        metadataStatus TEXT NOT NULL DEFAULT 'pending',
        metadataAttempts INTEGER NOT NULL DEFAULT 0,
        editedFields TEXT NOT NULL DEFAULT '[]',
        remoteValues TEXT,
        fileMissing INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        UNIQUE(name)
      );
      CREATE TABLE document_categories (
        documentId TEXT NOT NULL,
        categoryId TEXT NOT NULL,
        PRIMARY KEY (documentId, categoryId),
        FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE,
        FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE CASCADE
      );
      CREATE TABLE watch_folders (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        addedAt INTEGER NOT NULL
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    db.exec('PRAGMA user_version = 2')
    seedDefaultSettings(adapt(db), 'en')
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'libraryFolderPath'`).run(
      JSON.stringify('/Users/x/Library')
    )

    db.prepare(
      `INSERT INTO documents (id, filePath, originalFolderPath, fileName, addedAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('in-lib', '/Users/x/Library/paper.pdf', '/Users/x/Downloads', 'paper.pdf', 1000, 1000)
    db.prepare(
      `INSERT INTO documents (id, filePath, originalFolderPath, fileName, addedAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('nested', '/Users/x/Library/sub/nested.pdf', '/Users/x/Downloads', 'nested.pdf', 1000, 1000)
    db.prepare(
      `INSERT INTO documents (id, filePath, originalFolderPath, fileName, addedAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('outside', '/Users/x/Downloads/other.pdf', '/Users/x/Downloads', 'other.pdf', 1000, 1000)

    const result = runMigrations(adapt(db))
    expect(result.to).toBe(26)

    const inLib = db.prepare(`SELECT filePath FROM documents WHERE id = ?`).get('in-lib') as { filePath: string }
    const nested = db.prepare(`SELECT filePath FROM documents WHERE id = ?`).get('nested') as { filePath: string }
    const outside = db.prepare(`SELECT filePath FROM documents WHERE id = ?`).get('outside') as { filePath: string }
    expect(inLib.filePath).toBe('paper.pdf')
    expect(nested.filePath).toBe('sub/nested.pdf')
    expect(outside.filePath).toBe('/Users/x/Downloads/other.pdf')
  })

  it('migration 0003 is a no-op when libraryFolderPath is empty', () => {
    db.exec(`
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        filePath TEXT NOT NULL,
        originalFolderPath TEXT NOT NULL,
        fileName TEXT NOT NULL,
        fileSize INTEGER,
        fileHash TEXT,
        title TEXT,
        authors TEXT,
        year TEXT,
        venue TEXT,
        volume TEXT,
        abstract TEXT,
        keywords TEXT,
        url TEXT,
        doi TEXT,
        note TEXT,
        starred INTEGER NOT NULL DEFAULT 0,
        addedAt INTEGER NOT NULL,
        lastReadAt INTEGER,
        updatedAt INTEGER NOT NULL,
        metadataSource TEXT,
        metadataStatus TEXT NOT NULL DEFAULT 'pending',
        metadataAttempts INTEGER NOT NULL DEFAULT 0,
        editedFields TEXT NOT NULL DEFAULT '[]',
        remoteValues TEXT,
        fileMissing INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        UNIQUE(name)
      );
      CREATE TABLE document_categories (
        documentId TEXT NOT NULL,
        categoryId TEXT NOT NULL,
        PRIMARY KEY (documentId, categoryId),
        FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE,
        FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE CASCADE
      );
      CREATE TABLE watch_folders (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        addedAt INTEGER NOT NULL
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    db.exec('PRAGMA user_version = 2')
    seedDefaultSettings(adapt(db), 'en')
    db.prepare(
      `INSERT INTO documents (id, filePath, originalFolderPath, fileName, addedAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('d1', '/abs/d1.pdf', '/abs', 'd1.pdf', 1000, 1000)

    runMigrations(adapt(db))

    const row = db.prepare(`SELECT filePath FROM documents WHERE id = ?`).get('d1') as { filePath: string }
    expect(row.filePath).toBe('/abs/d1.pdf')
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
    expect(map.get('libraryFolderPath')).toBe(JSON.stringify(''))
    expect(map.get('crossrefMailto')).toBe(JSON.stringify(''))
    expect(map.get('theme')).toBe(JSON.stringify('dark'))
    expect(map.get('sidebarCollapsed')).toBe(JSON.stringify('0'))
    expect(map.get('lastWatchScanAt')).toBe(JSON.stringify(0))
    expect(map.get('language')).toBe(JSON.stringify('en'))
    expect(map.get('proxyUrl')).toBe(JSON.stringify(''))
    expect(map.get('windowBounds')).toBe(JSON.stringify(null))
    expect(map.get('listColumnState')).toBe(JSON.stringify(null))
    expect(map.get('activeProviderId')).toBe(JSON.stringify(''))
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
