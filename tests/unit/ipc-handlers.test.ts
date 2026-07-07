import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import { runMigrations, type SqliteLike } from '../../src/main/db/migrations'
import { createRepositories } from '../../src/main/db/repositories'
import type { NewDocument } from '../../src/main/db/repositories/documents'
import { seedDefaultSettings } from '../../src/main/db/settings-seed'
import type { SqliteDb } from '../../src/main/db/types'
import { createIpcHandlers } from '../../src/main/ipc/handlers'
import { IpcChannel } from '../../src/shared/ipc-channels'
import type { ListFilter, Result } from '../../src/shared/ipc-types'

const { mockTrashItem } = vi.hoisted(() => ({
  mockTrashItem: vi.fn<[string], Promise<void>>().mockResolvedValue(undefined)
}))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  ipcMain: { handle: vi.fn() },
  shell: { trashItem: mockTrashItem, showItemInFolder: vi.fn(), openExternal: vi.fn() },
  session: { defaultSession: { setProxy: vi.fn() } }
}))

vi.mock('../../src/main/services/logger', () => ({
  default: {},
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

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

function isOk<T>(r: Result<T>): r is { ok: true; data: T } {
  return r.ok === true
}

describe('IPC handlers (data layer)', () => {
  let db: RawDb
  let repos: ReturnType<typeof createRepositories>
  let handlers: ReturnType<typeof createIpcHandlers>

  beforeEach(() => {
    db = createDb()
    runMigrations(adapt(db))
    seedDefaultSettings(adapt(db), 'en')
    repos = createRepositories(db as unknown as SqliteDb)
    handlers = createIpcHandlers({ repos, win: undefined as never, importer: undefined })
    mockTrashItem.mockReset()
    mockTrashItem.mockResolvedValue(undefined)
  })

  function seedListDocs(): void {
    repos.documents.insert(
      makeDoc('d1', { addedAt: 100, lastReadAt: 500, starred: 1, originalFolderPath: '/folderA', title: 'Alpha' })
    )
    repos.documents.insert(
      makeDoc('d2', { addedAt: 200, lastReadAt: null, starred: 0, originalFolderPath: '/folderB', title: 'Beta' })
    )
    repos.documents.insert(
      makeDoc('d3', { addedAt: 300, lastReadAt: 300, starred: 1, originalFolderPath: '/folderA', title: 'Gamma' })
    )
  }

  it('documents.list covers all ListMode values through IPC', () => {
    seedListDocs()
    const cat = repos.categories.create('Cat A')
    repos.categories.assign('d1', cat.id)
    repos.categories.assign('d3', cat.id)

    const list = (filter: ListFilter) => {
      const r = handlers[IpcChannel.DocumentsList](filter)
      expect(isOk(r)).toBe(true)
      return ids((r as { ok: true; data: { id: string }[] }).data)
    }

    expect(list({ mode: 'all' })).toEqual(['d3', 'd2', 'd1'])
    expect(list({ mode: 'recentlyRead' })).toEqual(['d1', 'd3'])
    expect(list({ mode: 'recentlyAdded' })).toEqual(['d3', 'd2', 'd1'])
    expect(list({ mode: 'starred' })).toEqual(['d3', 'd1'])
    expect(list({ mode: 'category', categoryId: cat.id })).toEqual(['d3', 'd1'])
  })

  it('documents.update rejects non-editable fields with forbidden_field (never throws)', () => {
    repos.documents.insert(makeDoc('d1'))
    const r = handlers[IpcChannel.DocumentsUpdate]('d1', { id: 'x' } as never)
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('forbidden_field')
  })

  it('documents.update applies an editable patch', () => {
    repos.documents.insert(makeDoc('d1'))
    const r = handlers[IpcChannel.DocumentsUpdate]('d1', { title: 'New Title' })
    expect(isOk(r)).toBe(true)
    expect((r as { ok: true; data: { title: string; editedFields: string[] } }).data.title).toBe('New Title')
    expect((r as { ok: true; data: { editedFields: string[] } }).data.editedFields).toEqual(['title'])
  })

  it('a handler that throws internally resolves { ok: false } (never rejects)', () => {
    const r = handlers[IpcChannel.DocumentsUpdate]('missing', { title: 'x' })
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('not_found')
  })

  it('not_implemented stubs resolve { ok: false, code: not_implemented }', () => {
    const r = handlers[IpcChannel.DocumentsBulkRefreshMetadata](['id1']) as Result<unknown>
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('not_implemented')
  })

  it('documents.openPdf resolves { ok: false } for missing doc', async () => {
    const r = await handlers[IpcChannel.DocumentsOpenPdf]('missing') as Result<unknown>
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('not_found')
  })

  it('documents.openInFinder resolves { ok: false } for missing doc', () => {
    const r = handlers[IpcChannel.DocumentsOpenInFinder]('missing') as Result<unknown>
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('not_found')
  })

  it('getBootstrap returns BootstrapData with safe defaults', () => {
    const r = handlers[IpcChannel.Bootstrap]()
    expect(isOk(r)).toBe(true)
    const data = (r as { ok: true; data: Record<string, unknown> }).data
    expect(data).toEqual({
      language: 'en',
      windowBounds: null,
      listColumnState: null,
      sidebarCollapsed: false,
      firstRun: true,
      libraryFolderPath: ''
    })
  })

  it('settings.get/set round-trip through IPC', () => {
    const setR = handlers[IpcChannel.SettingsSet]('custom', { n: 1 })
    expect(setR.ok).toBe(true)
    const getR = handlers[IpcChannel.SettingsGet]('custom', null) as Result<unknown>
    expect(isOk(getR)).toBe(true)
    expect((getR as { ok: true; data: { n: number } }).data).toEqual({ n: 1 })
  })

  it('categories.create/list through IPC', () => {
    const createR = handlers[IpcChannel.CategoriesCreate]('Physics')
    expect(isOk(createR)).toBe(true)
    const cat = (createR as { ok: true; data: { id: string; name: string } }).data
    expect(cat.name).toBe('Physics')
    const listR = handlers[IpcChannel.CategoriesList]()
    expect(isOk(listR)).toBe(true)
    expect((listR as { ok: true; data: { name: string }[] }).data.map((c) => c.name)).toEqual(['Physics'])
  })

  it('documents.delete cascades to document_categories through IPC', async () => {
    repos.documents.insert(makeDoc('d5', { filePath: '/tmp/ipc-d5.pdf' }))
    const cat = repos.categories.create('Cascade')
    repos.categories.assign('d5', cat.id)
    expect(repos.categories.listForDocument('d5').length).toBe(1)

    const r = await handlers[IpcChannel.DocumentsDelete]('d5')
    expect(r.ok).toBe(true)
    expect(repos.categories.listForDocument('d5').length).toBe(0)
  })

  it('documents.bulkDelete removes multiple documents through IPC', async () => {
    repos.documents.insert(makeDoc('b1', { filePath: '/tmp/ipc-b1.pdf' }))
    repos.documents.insert(makeDoc('b2', { filePath: '/tmp/ipc-b2.pdf' }))
    repos.documents.insert(makeDoc('b3', { filePath: '/tmp/ipc-b3.pdf', fileMissing: 1 }))

    const r = await handlers[IpcChannel.DocumentsBulkDelete](['b1', 'b2', 'b3'])
    expect(r.ok).toBe(true)
    expect(repos.documents.list({ mode: 'all' })).toHaveLength(0)
  })

  it('documents.bulkCategorize assigns many docs to a category', () => {
    repos.documents.insert(makeDoc('b1'))
    repos.documents.insert(makeDoc('b2'))
    const cat = repos.categories.create('Bulk')
    const r = handlers[IpcChannel.DocumentsBulkCategorize](['b1', 'b2'], cat.id)
    expect(r.ok).toBe(true)
    expect(repos.categories.listForDocument('b1').length).toBe(1)
    expect(repos.categories.listForDocument('b2').length).toBe(1)
  })
})
