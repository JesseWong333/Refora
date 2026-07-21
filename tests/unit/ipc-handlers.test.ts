import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRepositories } from '../../src/main/db/repositories'
import { seedDefaultSettings } from '../../src/main/db/settings-seed'
import { createIpcHandlers, validateProxyUrl } from '../../src/main/ipc/handlers'
import { IpcChannel } from '../../src/shared/ipc-channels'
import type { ListFilter, Result } from '../../src/shared/ipc-types'
import {
  adaptMainTestDb,
  createMainTestDb,
  makeNewDocument as makeDoc,
  migrateMainTestDb,
  type MainTestDb
} from '../helpers/mainDb'

const electronMocks = vi.hoisted(() => ({
  trashItem: vi.fn<[string], Promise<void>>(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showMessageBox: vi.fn(),
  showItemInFolder: vi.fn(),
  setProxy: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
    showSaveDialog: electronMocks.showSaveDialog,
    showMessageBox: electronMocks.showMessageBox
  },
  ipcMain: { handle: vi.fn() },
  shell: {
    trashItem: electronMocks.trashItem,
    showItemInFolder: electronMocks.showItemInFolder,
    openExternal: vi.fn()
  },
  session: { defaultSession: { setProxy: electronMocks.setProxy } }
}))

vi.mock('../../src/main/services/logger', () => ({
  default: {},
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('../../src/main/services/pdfPath', () => ({
  resolvePdfFilePath: (filePath: string) => filePath
}))

function ids(docs: { id: string }[]): string[] {
  return docs.map((d) => d.id)
}

function isOk<T>(r: Result<T>): r is { ok: true; data: T } {
  return r.ok === true
}

describe('IPC handlers (data layer)', () => {
  let db: MainTestDb
  let repos: ReturnType<typeof createRepositories>
  let handlers: ReturnType<typeof createIpcHandlers>

  beforeEach(() => {
    db = createMainTestDb()
    repos = createRepositories(migrateMainTestDb(db))
    seedDefaultSettings(adaptMainTestDb(db), 'en')
    handlers = createIpcHandlers({
      getWin: () => null,
      getRuntime: () => ({ repos })
    })
    vi.clearAllMocks()
    electronMocks.trashItem.mockResolvedValue(undefined)
    electronMocks.setProxy.mockResolvedValue(undefined)
  })

  function seedListDocs(): void {
    const now = Date.now()
    repos.documents.insert(
      makeDoc('d1', { addedAt: now - 2 * 24 * 60 * 60 * 1000, lastReadAt: 500, starred: 1, originalFolderPath: '/folderA', title: 'Alpha' })
    )
    repos.documents.insert(
      makeDoc('d2', { addedAt: now - 3 * 24 * 60 * 60 * 1000, lastReadAt: null, starred: 0, originalFolderPath: '/folderB', title: 'Beta' })
    )
    repos.documents.insert(
      makeDoc('d3', { addedAt: now, lastReadAt: 300, starred: 1, originalFolderPath: '/folderA', title: 'Gamma' })
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

    expect(list({ mode: 'all' })).toEqual(['d3', 'd1', 'd2'])
    expect(list({ mode: 'recentlyRead' })).toEqual(['d1', 'd3'])
    expect(list({ mode: 'recentlyAdded' })).toEqual(['d3', 'd1', 'd2'])
    expect(list({ mode: 'starred' })).toEqual(['d3', 'd1'])
    expect(list({ mode: 'category', categoryId: cat.id })).toEqual(['d3', 'd1'])
  })

  it('documents.counts returns totals per smart mode through IPC', () => {
    seedListDocs()
    repos.documents.insert(makeDoc('recent', { addedAt: Date.now(), lastReadAt: null, starred: 0 }))
    const r = handlers[IpcChannel.DocumentsCount]()
    expect(isOk(r)).toBe(true)
    expect((r as { ok: true; data: { all: number; recentlyRead: number; starred: number; recentlyAdded: number } }).data).toMatchObject({
      all: 4,
      recentlyRead: 2,
      starred: 2,
      recentlyAdded: 4
    })
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

  it('documents.update delegates arXiv ID verification to the metadata service', async () => {
    const original = repos.documents.insert(makeDoc('d1'))
    const verified = { ...original, arxivId: '2401.12345' }
    const metadataService = {
      enqueue: vi.fn(),
      updateVerifiedArxivId: vi.fn().mockResolvedValue(verified),
      refreshMetadata: vi.fn(),
      bulkRefreshMetadata: vi.fn(),
      resumeOnStartup: vi.fn(),
      destroy: vi.fn()
    }
    const localHandlers = createIpcHandlers({
      getWin: () => null,
      getRuntime: () => ({ repos, metadataService })
    })

    const result = await localHandlers[IpcChannel.DocumentsUpdate]('d1', {
      arxivId: 'https://arxiv.org/abs/2401.12345'
    })

    expect(result).toEqual({ ok: true, data: verified })
    expect(metadataService.updateVerifiedArxivId).toHaveBeenCalledWith(
      'd1',
      'https://arxiv.org/abs/2401.12345'
    )
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

  it('gets, searches, stars, and reveals documents through IPC', () => {
    repos.documents.insert(makeDoc('d1', { title: 'Searchable paper' }))

    expect(handlers[IpcChannel.DocumentsGet]('d1')).toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ id: 'd1' }) })
    )
    expect(handlers[IpcChannel.DocumentsSearch]('Searchable')).toEqual(
      expect.objectContaining({ ok: true, data: [expect.objectContaining({ id: 'd1' })] })
    )
    expect(handlers[IpcChannel.DocumentsSetStarred]('d1', true).ok).toBe(true)
    expect(repos.documents.get('d1')?.starred).toBe(1)
    expect(handlers[IpcChannel.DocumentsOpenInFinder]('d1').ok).toBe(true)
    expect(electronMocks.showItemInFolder).toHaveBeenCalledWith('/abs/d1.pdf')
  })

  it('searches papers, workspace content, workspace files, and chat history through one IPC result', () => {
    repos.documents.insert(makeDoc('d1', { title: 'Searchable paper' }))
    const documentSearch = vi.spyOn(repos.documents, 'search')
    const workspace = repos.workspaces.create('Research')
    repos.workspaceAssets.insert({
      id: 'asset-1',
      workspaceId: workspace.id,
      fileName: 'searchable-data.csv',
      filePath: 'refora-assets/asset-1/searchable-data.csv',
      sourcePath: '/tmp/searchable-data.csv',
      mimeType: 'text/csv',
      previewKind: 'text',
      fileSize: 1,
      fileHash: 'hash',
      fileMissing: 0,
      createdAt: 1,
      updatedAt: 1
    })
    const report = repos.aiReports.create({
      workspaceId: workspace.id,
      title: 'Research report',
      contentMd: 'searchable report conclusion',
      sourceDocIds: [],
      model: null
    })
    const note = repos.workspaceNotes.create(
      workspace.id,
      'Research note',
      'searchable note body',
      'markdown'
    )
    const thread = repos.chat.createThread(workspace.id, 'provider')
    repos.chat.addMessage(thread.id, 'user', 'searchable chat question')

    expect(handlers[IpcChannel.GlobalSearch]('searchable')).toEqual({
      ok: true,
      data: {
        documents: [expect.objectContaining({ id: 'd1' })],
        workspaceFiles: [expect.objectContaining({ id: 'asset-1', workspaceName: 'Research' })],
        workspaceContents: expect.arrayContaining([
          expect.objectContaining({ id: report.id, kind: 'report', workspaceName: 'Research' }),
          expect.objectContaining({ id: note.id, kind: 'note', workspaceName: 'Research' })
        ]),
        chats: [expect.objectContaining({ threadId: thread.id, workspaceName: 'Research' })]
      }
    })
    expect(documentSearch).toHaveBeenCalledWith('searchable', 10)
    expect(handlers[IpcChannel.GlobalSearch]('   ')).toEqual({
      ok: true,
      data: { documents: [], workspaceFiles: [], workspaceContents: [], chats: [] }
    })
  })

  it('delegates metadata refresh operations when the service is ready', () => {
    repos.documents.insert(makeDoc('d1'))
    const metadataService = {
      enqueue: vi.fn(),
      refreshMetadata: vi.fn(),
      bulkRefreshMetadata: vi.fn(),
      resumeOnStartup: vi.fn(),
      destroy: vi.fn()
    }
    const localHandlers = createIpcHandlers({
      getWin: () => null,
      getRuntime: () => ({ repos, metadataService })
    })

    expect(localHandlers[IpcChannel.DocumentsBulkRefreshMetadata](['d1']).ok).toBe(true)
    expect(metadataService.bulkRefreshMetadata).toHaveBeenCalledWith(['d1'])
    const refreshed = localHandlers[IpcChannel.DocumentsRefreshMetadata]('d1')
    expect(refreshed).toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ id: 'd1' }) })
    )
    expect(metadataService.refreshMetadata).toHaveBeenCalledWith('d1')
  })

  it('wraps synchronous metadata service failures in a Result envelope', () => {
    const metadataService = {
      enqueue: vi.fn(),
      refreshMetadata: vi.fn(),
      bulkRefreshMetadata: vi.fn(() => {
        throw new Error('metadata unavailable')
      }),
      resumeOnStartup: vi.fn(),
      destroy: vi.fn()
    }
    const localHandlers = createIpcHandlers({
      getWin: () => null,
      getRuntime: () => ({ repos, metadataService })
    })

    expect(localHandlers[IpcChannel.DocumentsBulkRefreshMetadata](['d1'])).toEqual({
      ok: false,
      error: { code: 'internal_error', message: 'metadata unavailable' }
    })
  })

  it('returns the current document when relocation selection is cancelled', async () => {
    repos.documents.insert(makeDoc('d1'))
    const win = { isDestroyed: vi.fn(() => false), focus: vi.fn() }
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const localHandlers = createIpcHandlers({
      getWin: () => win as never,
      getRuntime: () => ({ repos })
    })

    const result = await localHandlers[IpcChannel.DocumentsRelocateFile]('d1', '')
    expect(result).toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ id: 'd1' }) })
    )
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
      libraryFolderPath: null
    })
  })

  it('settings.get/set round-trip through IPC', () => {
    const setR = handlers[IpcChannel.SettingsSet]('crossrefMailto', 'test@example.com')
    expect(setR.ok).toBe(true)
    const getR = handlers[IpcChannel.SettingsGet]('crossrefMailto', null) as Result<unknown>
    expect(isOk(getR)).toBe(true)
    expect((getR as { ok: true; data: string }).data).toBe('test@example.com')
  })

  it('settings.set rejects unknown keys', () => {
    const setR = handlers[IpcChannel.SettingsSet]('custom', { n: 1 })
    expect(setR.ok).toBe(false)
  })

  it('validates proxy URLs and applies valid or cleared proxy settings', async () => {
    expect(validateProxyUrl('http://127.0.0.1:8080')).toBe(true)
    expect(validateProxyUrl('https://proxy.example.com')).toBe(true)
    expect(validateProxyUrl('socks5://127.0.0.1:1080')).toBe(true)
    expect(validateProxyUrl('ftp://example.com')).toBe(false)
    expect(validateProxyUrl('not a url')).toBe(false)

    expect(handlers[IpcChannel.SettingsSet]('proxyUrl', ' http://127.0.0.1:8080 ').ok).toBe(true)
    expect(electronMocks.setProxy).toHaveBeenCalledWith({ proxyRules: 'http://127.0.0.1:8080' })
    expect(handlers[IpcChannel.SettingsSet]('proxyUrl', '').ok).toBe(true)
    expect(electronMocks.setProxy).toHaveBeenCalledWith({ proxyRules: '' })

    expect(handlers[IpcChannel.SettingsSet]('proxyUrl', 'ftp://invalid').ok).toBe(true)
    await Promise.resolve()
    expect(electronMocks.setProxy).toHaveBeenCalledTimes(2)
  })

  it('requires library changes to use the library switch handler', () => {
    const result = handlers[IpcChannel.SettingsSet]('libraryFolderPath', '/new/library')
    expect(result).toEqual(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'use_library_switch' }) })
    )
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

  it('renames, assigns, unassigns, and deletes categories through IPC', () => {
    repos.documents.insert(makeDoc('d1'))
    const category = repos.categories.create('Original')

    expect(handlers[IpcChannel.CategoriesRename](category.id, 'Renamed').ok).toBe(true)
    expect(handlers[IpcChannel.CategoriesAssign]('d1', category.id).ok).toBe(true)
    expect(repos.categories.listForDocument('d1')).toHaveLength(1)
    expect(handlers[IpcChannel.CategoriesUnassign]('d1', category.id).ok).toBe(true)
    expect(repos.categories.listForDocument('d1')).toEqual([])
    expect(handlers[IpcChannel.CategoriesDelete](category.id).ok).toBe(true)
    expect(handlers[IpcChannel.CategoriesAssign]('d1', 'missing')).toEqual(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'not_found' }) })
    )
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

  it('imports explicit files and handles cancelled picker-based imports', async () => {
    const importer = {
      importFiles: vi.fn().mockResolvedValue({ added: ['doc-1'], skipped: [], errors: [] }),
      destroy: vi.fn()
    }
    const win = { isDestroyed: vi.fn(() => false), focus: vi.fn() }
    const localHandlers = createIpcHandlers({
      getWin: () => win as never,
      getRuntime: () => ({ repos, importer })
    })

    const explicit = await localHandlers[IpcChannel.ImportAddFiles](['/tmp/paper.pdf'])
    expect(explicit).toEqual({
      ok: true,
      data: { added: ['doc-1'], skipped: [], errors: [] }
    })
    expect(importer.importFiles).toHaveBeenCalledWith(['/tmp/paper.pdf'], false)

    electronMocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const emptyImport = { added: [], skipped: [], errors: [] }
    expect(await localHandlers[IpcChannel.ImportAddFiles]([])).toEqual({ ok: true, data: emptyImport })
    expect(await localHandlers[IpcChannel.ImportAddFolder]('')).toEqual({ ok: true, data: emptyImport })
    expect(await localHandlers[IpcChannel.ImportFromJson]('')).toEqual({ ok: true, data: 0 })
    expect(await localHandlers[IpcChannel.ImportFromZotero]()).toEqual({
      ok: true,
      data: { added: 0, skipped: 0, errors: [] }
    })
    expect(await localHandlers[IpcChannel.ImportFromMendeley]()).toEqual({
      ok: true,
      data: { added: 0, skipped: 0, errors: [] }
    })
  })

  it('returns Result envelopes when import dialogs have no active window or reject', async () => {
    const importer = {
      importFiles: vi.fn().mockResolvedValue({ added: [], skipped: [], errors: [] }),
      destroy: vi.fn()
    }
    const noWindowHandlers = createIpcHandlers({
      getWin: () => null,
      getRuntime: () => ({ repos, importer })
    })

    await expect(noWindowHandlers[IpcChannel.ImportAddFiles]([])).resolves.toEqual({
      ok: false,
      error: { code: 'internal_error', message: 'No active window' }
    })
    await expect(noWindowHandlers[IpcChannel.ImportAddFolder]('')).resolves.toEqual({
      ok: false,
      error: { code: 'internal_error', message: 'No active window' }
    })

    const win = { isDestroyed: vi.fn(() => false), focus: vi.fn() }
    const dialogHandlers = createIpcHandlers({
      getWin: () => win as never,
      getRuntime: () => ({ repos, importer })
    })
    electronMocks.showOpenDialog.mockRejectedValueOnce(new Error('dialog failed'))
    await expect(dialogHandlers[IpcChannel.ImportAddFiles]([])).resolves.toEqual({
      ok: false,
      error: { code: 'internal_error', message: 'dialog failed' }
    })
  })

  it('manages watch folders and watcher lifecycle through IPC', async () => {
    const watcher = {
      start: vi.fn(),
      stop: vi.fn(),
      sync: vi.fn(),
      destroy: vi.fn()
    }
    const localHandlers = createIpcHandlers({
      getWin: () => null,
      getRuntime: () => ({ repos, watcher: watcher as never })
    })

    const added = await localHandlers[IpcChannel.WatchAdd]('/private/tmp')
    expect(added.ok).toBe(true)
    if (!added.ok) throw new Error(added.error.message)
    expect(watcher.start).toHaveBeenCalledWith(added.data)
    expect(localHandlers[IpcChannel.WatchList]()).toEqual({ ok: true, data: [added.data] })

    expect(localHandlers[IpcChannel.WatchToggle](added.data.id, false).ok).toBe(true)
    expect(watcher.stop).toHaveBeenCalledWith(added.data.id)
    expect(localHandlers[IpcChannel.WatchToggle](added.data.id, true).ok).toBe(true)
    expect(watcher.start).toHaveBeenLastCalledWith(expect.objectContaining({ id: added.data.id }))

    expect(localHandlers[IpcChannel.WatchRemove](added.data.id).ok).toBe(true)
    expect(localHandlers[IpcChannel.WatchList]()).toEqual({ ok: true, data: [] })
  })

  it('returns selected directories and cancelled dialog results', async () => {
    const win = { isDestroyed: vi.fn(() => false), focus: vi.fn() }
    const localHandlers = createIpcHandlers({
      getWin: () => win as never,
      getRuntime: () => ({ repos })
    })

    electronMocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await localHandlers[IpcChannel.DialogOpenDirectory]()).toEqual({ ok: true, data: null })

    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/../tmp/library']
    })
    expect(await localHandlers[IpcChannel.DialogOpenDirectory]()).toEqual({
      ok: true,
      data: '/tmp/library'
    })
  })

  it('exports BibTeX strings and handles cancelled save dialogs', async () => {
    repos.documents.insert(makeDoc('d1', { title: 'Exported Paper' }))
    const win = { isDestroyed: vi.fn(() => false), focus: vi.fn() }
    const localHandlers = createIpcHandlers({
      getWin: () => win as never,
      getRuntime: () => ({ repos })
    })

    const bibtex = await localHandlers[IpcChannel.ExportBibtexString](['d1'])
    expect(bibtex.ok && bibtex.data).toContain('Exported Paper')
    expect(await localHandlers[IpcChannel.ExportBibtexString]([])).toEqual({ ok: true, data: '' })
    expect(await localHandlers[IpcChannel.ExportToBibtex]([])).toEqual({ ok: true, data: '' })

    electronMocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
    expect(await localHandlers[IpcChannel.ExportToBibtex](['d1'])).toEqual({ ok: true, data: '' })
    expect(await localHandlers[IpcChannel.ExportToJson]()).toEqual({ ok: true, data: '' })
  })

  it('library:switch delegates to switchLibraryFolder and returns its result', async () => {
    const switchFn = vi.fn<(folder: string) => Promise<unknown>>().mockResolvedValue({
      libraryFolderPath: '/lib',
      dbExisted: false,
      scanned: 3,
      imported: 2,
      skipped: 1,
      errors: []
    })
    const localHandlers = createIpcHandlers({
      getWin: () => null,
      getRuntime: () => ({ repos }),
      switchLibraryFolder: switchFn as never
    })

    const r = await localHandlers[IpcChannel.LibrarySwitch]('/lib') as Result<unknown>
    expect(r.ok).toBe(true)
    expect(switchFn).toHaveBeenCalledWith('/lib')
    const data = (r as { ok: true; data: { scanned: number } }).data
    expect(data.scanned).toBe(3)
  })

  it('library:switch resolves { ok: false, not_implemented } when no switch fn', async () => {
    const r = await handlers[IpcChannel.LibrarySwitch]('/lib') as Result<unknown>
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('not_implemented')
  })
})
