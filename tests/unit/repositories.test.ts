import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { runMigrations, type SqliteLike } from '../../src/main/db/migrations'
import { createRepositories } from '../../src/main/db/repositories'
import type { NewDocument } from '../../src/main/db/repositories/documents'
import { RepoError } from '../../src/main/db/repositories/errors'
import { seedDefaultSettings } from '../../src/main/db/settings-seed'
import type { SqliteDb } from '../../src/main/db/types'
import type { ListFilter } from '../../src/shared/ipc-types'

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

function ids(docs: { id: string }[]): string[] {
  return docs.map((d) => d.id)
}

function expectRepoError(fn: () => unknown, code: string): void {
  let caught: unknown
  try {
    fn()
  } catch (e) {
    caught = e
  }
  expect(caught).toBeInstanceOf(RepoError)
  expect((caught as RepoError).code).toBe(code)
}

describe('documents repository', () => {
  let db: RawDb
  let repos: ReturnType<typeof createRepositories>

  beforeEach(() => {
    db = createDb()
    runMigrations(adapt(db))
    repos = createRepositories(db as unknown as SqliteDb)
  })

  function seedListDocs(): void {
    repos.documents.insert(
      makeDoc('d1', {
        addedAt: 100,
        lastReadAt: 500,
        starred: 1,
        originalFolderPath: '/folderA',
        title: 'Alpha'
      })
    )
    repos.documents.insert(
      makeDoc('d2', { addedAt: 200, lastReadAt: null, starred: 0, originalFolderPath: '/folderB', title: 'Beta' })
    )
    repos.documents.insert(
      makeDoc('d3', { addedAt: 300, lastReadAt: 300, starred: 1, originalFolderPath: '/folderA', title: 'Gamma' })
    )
  }

  it('list(mode=all) returns all documents ordered by addedAt desc by default', () => {
    seedListDocs()
    expect(ids(repos.documents.list({ mode: 'all' }))).toEqual(['d3', 'd2', 'd1'])
  })

  it('list applies an explicit sort override', () => {
    seedListDocs()
    const filter: ListFilter = { mode: 'all', sort: { field: 'title', dir: 'asc' } }
    expect(ids(repos.documents.list(filter))).toEqual(['d1', 'd2', 'd3'])
  })

  it('list(mode=recentlyRead) filters lastReadAt NOT NULL ordered desc', () => {
    seedListDocs()
    expect(ids(repos.documents.list({ mode: 'recentlyRead' }))).toEqual(['d1', 'd3'])
  })

  it('list(mode=recentlyAdded) orders by addedAt desc', () => {
    seedListDocs()
    expect(ids(repos.documents.list({ mode: 'recentlyAdded' }))).toEqual(['d3', 'd2', 'd1'])
  })

  it('list(mode=starred) returns starred=1', () => {
    seedListDocs()
    expect(ids(repos.documents.list({ mode: 'starred' }))).toEqual(['d3', 'd1'])
  })

  it('list(mode=category) joins document_categories', () => {
    seedListDocs()
    const cat = repos.categories.create('Cat A')
    repos.categories.assign('d1', cat.id)
    repos.categories.assign('d3', cat.id)
    expect(ids(repos.documents.list({ mode: 'category', categoryId: cat.id }))).toEqual(['d3', 'd1'])
  })

  it('search uses FTS MATCH for >=3 chars and LIKE for 1-2 chars', () => {
    seedListDocs()
    expect(ids(repos.documents.search('Alpha'))).toEqual(['d1'])
    expect(ids(repos.documents.search('Alp'))).toEqual(['d1'])
    expect(ids(repos.documents.search('Al'))).toEqual(['d1'])
    expect(repos.documents.search('   ')).toEqual([])
  })

  it('search escapes LIKE wildcards so % and _ match literally', () => {
    repos.documents.insert(makeDoc('pct', { title: '50% solution' }))
    repos.documents.insert(makeDoc('und', { title: 'a_b_c' }))
    repos.documents.insert(makeDoc('plain', { title: 'plain text' }))

    expect(ids(repos.documents.search('%'))).toEqual(['pct'])
    expect(ids(repos.documents.search('_'))).toEqual(['und'])
    expect(ids(repos.documents.search('pl'))).toEqual(['plain'])
  })

  it('update rejects non-editable fields with forbidden_field', () => {
    repos.documents.insert(makeDoc('d1'))
    expectRepoError(() => repos.documents.update('d1', { id: 'x' } as never), 'forbidden_field')
    expectRepoError(() => repos.documents.update('d1', { starred: 1 } as never), 'forbidden_field')
    expectRepoError(() => repos.documents.update('d1', { filePath: '/x' } as never), 'forbidden_field')
    expectRepoError(() => repos.documents.update('d1', { addedAt: 1 } as never), 'forbidden_field')
  })

  it('update manages editedFields: add on edit, remove on clear', () => {
    repos.documents.insert(makeDoc('d1'))

    let doc = repos.documents.update('d1', { title: 'Edited' })
    expect(doc.title).toBe('Edited')
    expect(doc.editedFields).toEqual(['title'])

    doc = repos.documents.update('d1', { doi: '10.1/x' })
    expect(doc.editedFields).toEqual(['title', 'doi'])

    doc = repos.documents.update('d1', { title: '' })
    expect(doc.title).toBe('')
    expect(doc.editedFields).toEqual(['doi'])

    doc = repos.documents.update('d1', { note: 'a note' })
    expect(doc.editedFields).toEqual(['doi', 'note'])
  })

  it('update with an empty patch is a no-op', () => {
    repos.documents.insert(makeDoc('d1', { title: 'Keep' }))
    const doc = repos.documents.update('d1', {})
    expect(doc.title).toBe('Keep')
    expect(doc.editedFields).toEqual([])
  })

  it('update on a missing document throws not_found', () => {
    expectRepoError(() => repos.documents.update('missing', { title: 'x' }), 'not_found')
  })

  it('delete cascades to document_categories', () => {
    repos.documents.insert(makeDoc('d5'))
    const cat = repos.categories.create('Cascade Cat')
    repos.categories.assign('d5', cat.id)
    expect(repos.categories.listForDocument('d5').length).toBe(1)

    repos.documents.delete('d5')

    expect(repos.categories.listForDocument('d5').length).toBe(0)
    expect(repos.categories.countByCategory().get(cat.id) ?? 0).toBe(0)
  })

  it('setStarred, setLastReadAt, setFileMissing, setMetadataStatus persist', () => {
    repos.documents.insert(makeDoc('d1'))
    repos.documents.setStarred('d1', true)
    repos.documents.setLastReadAt('d1', 9999)
    repos.documents.setFileMissing('d1', true)
    repos.documents.setMetadataStatus('d1', 'done', 'crossref')
    const doc = repos.documents.get('d1')
    expect(doc?.starred).toBe(1)
    expect(doc?.lastReadAt).toBe(9999)
    expect(doc?.fileMissing).toBe(1)
    expect(doc?.metadataStatus).toBe('done')
    expect(doc?.metadataSource).toBe('crossref')
  })

  it('getResumableMetadataRows returns pending and failed<3', () => {
    repos.documents.insert(makeDoc('p1', { metadataStatus: 'pending' }))
    repos.documents.insert(makeDoc('p2', { metadataStatus: 'pending' }))
    repos.documents.insert(makeDoc('f1', { metadataStatus: 'failed', metadataAttempts: 2 }))
    repos.documents.insert(makeDoc('f2', { metadataStatus: 'failed', metadataAttempts: 3 }))
    repos.documents.insert(makeDoc('d1', { metadataStatus: 'done' }))
    const rows = repos.documents.getResumableMetadataRows()
    expect(ids(rows).sort()).toEqual(['f1', 'p1', 'p2'])
  })

  it('bulkDelete removes multiple documents', () => {
    repos.documents.insert(makeDoc('b1'))
    repos.documents.insert(makeDoc('b2'))
    repos.documents.insert(makeDoc('b3'))
    repos.documents.bulkDelete(['b1', 'b3'])
    expect(ids(repos.documents.list({ mode: 'all' }))).toEqual(['b2'])
  })

  it('stores filePath library-relative and resolves it to absolute on read', () => {
    repos.settings.set('libraryFolderPath', '/Users/x/Library')
    const doc = repos.documents.insert(
      makeDoc('r1', { filePath: '/Users/x/Library/sub/paper.pdf', originalFolderPath: '/Users/x/Downloads' })
    )
    expect(doc.filePath).toBe('/Users/x/Library/sub/paper.pdf')

    const raw = db.prepare('SELECT filePath FROM documents WHERE id = ?').get('r1') as { filePath: string }
    expect(raw.filePath).toBe('sub/paper.pdf')

    const fetched = repos.documents.get('r1')
    expect(fetched?.filePath).toBe('/Users/x/Library/sub/paper.pdf')
    expect(fetched?.originalFolderPath).toBe('/Users/x/Downloads')

    expect(repos.documents.findByPath('/Users/x/Library/sub/paper.pdf')?.id).toBe('r1')
  })

  it('leaves outside-library filePaths absolute on insert and find', () => {
    repos.settings.set('libraryFolderPath', '/Users/x/Library')
    repos.documents.insert(makeDoc('o1', { filePath: '/Users/x/Downloads/other.pdf' }))
    const raw = db.prepare('SELECT filePath FROM documents WHERE id = ?').get('o1') as { filePath: string }
    expect(raw.filePath).toBe('/Users/x/Downloads/other.pdf')
    expect(repos.documents.findByPath('/Users/x/Downloads/other.pdf')?.id).toBe('o1')
  })

  it('resolves relative filePaths after switching library folder to a new absolute root', () => {
    repos.settings.set('libraryFolderPath', '/Users/x/Library')
    repos.documents.insert(makeDoc('p1', { filePath: '/Users/x/Library/sub/paper.pdf' }))
    const raw = db.prepare('SELECT filePath FROM documents WHERE id = ?').get('p1') as { filePath: string }
    expect(raw.filePath).toBe('sub/paper.pdf')

    repos.settings.set('libraryFolderPath', '/Users/y/Library')
    const fetched = repos.documents.get('p1')
    expect(fetched?.filePath).toBe('/Users/y/Library/sub/paper.pdf')
  })
})

describe('categories repository', () => {
  let db: RawDb
  let repos: ReturnType<typeof createRepositories>

  beforeEach(() => {
    db = createDb()
    runMigrations(adapt(db))
    repos = createRepositories(db as unknown as SqliteDb)
  })

  it('create/list/rename/delete', () => {
    const cat = repos.categories.create('Physics')
    expect(cat.name).toBe('Physics')
    expect(repos.categories.list().map((c) => c.name)).toEqual(['Physics'])

    repos.categories.rename(cat.id, 'Astrophysics')
    expect(repos.categories.list()[0].name).toBe('Astrophysics')

    repos.categories.delete(cat.id)
    expect(repos.categories.list()).toEqual([])
  })

  it('rejects duplicate names (UNIQUE constraint)', () => {
    repos.categories.create('Unique')
    expect(() => repos.categories.create('Unique')).toThrow()
  })

  it('assign/unassign are idempotent and cascade on category delete', () => {
    const doc = makeDoc('c1')
    repos.documents.insert(doc)
    const cat = repos.categories.create('Cat')

    repos.categories.assign('c1', cat.id)
    repos.categories.assign('c1', cat.id)
    expect(repos.categories.listForDocument('c1').length).toBe(1)

    repos.categories.unassign('c1', cat.id)
    expect(repos.categories.listForDocument('c1').length).toBe(0)

    repos.categories.assign('c1', cat.id)
    repos.categories.delete(cat.id)
    expect(repos.categories.listForDocument('c1').length).toBe(0)
  })
})

describe('watchFolders repository', () => {
  let db: RawDb
  let repos: ReturnType<typeof createRepositories>

  beforeEach(() => {
    db = createDb()
    runMigrations(adapt(db))
    repos = createRepositories(db as unknown as SqliteDb)
  })

  it('add/list/toggle/getEnabled/remove', () => {
    const a = repos.watchFolders.add('/watch/a')
    const b = repos.watchFolders.add('/watch/b')
    expect(repos.watchFolders.list().length).toBe(2)
    expect(repos.watchFolders.getEnabled().length).toBe(2)

    repos.watchFolders.toggle(a.id, false)
    expect(repos.watchFolders.getEnabled().length).toBe(1)
    expect(repos.watchFolders.list().length).toBe(2)

    repos.watchFolders.remove(b.id)
    expect(repos.watchFolders.list().length).toBe(1)
  })
})

describe('settings repository', () => {
  let db: RawDb
  let repos: ReturnType<typeof createRepositories>

  beforeEach(() => {
    db = createDb()
    runMigrations(adapt(db))
    repos = createRepositories(db as unknown as SqliteDb)
  })

  it('set/get round-trips JSON values', () => {
    repos.settings.set('custom', { a: 1, b: [2, 3] })
    expect(repos.settings.get('custom', null)).toEqual({ a: 1, b: [2, 3] })
  })

  it('get returns default for missing key', () => {
    expect(repos.settings.get('missing', 'fallback')).toBe('fallback')
  })

  it('get returns default on corrupt JSON (never throws)', () => {
    db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('bad', 'not json')")
    expect(repos.settings.get('bad', 'fallback')).toBe('fallback')
  })

  it('getBootstrapSettings returns seeded defaults', () => {
    seedDefaultSettings(adapt(db), 'en')
    const bs = repos.settings.getBootstrapSettings()
    expect(bs.language).toBe('en')
    expect(bs.sidebarCollapsed).toBe(false)
    expect(bs.libraryFolderPath).toBe('')
    expect(bs.proxyUrl).toBe('')
    expect(bs.windowBounds).toBeNull()
    expect(bs.listColumnState).toBeNull()
  })

  it('set updates an existing key', () => {
    seedDefaultSettings(adapt(db), 'en')
    repos.settings.set('language', 'zh')
    expect(repos.settings.get('language', 'en')).toBe('zh')
    expect(repos.settings.getBootstrapSettings().language).toBe('zh')
  })
})
