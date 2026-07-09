import { dialog, ipcMain, shell, session, type BrowserWindow } from 'electron'
import { existsSync, statSync, writeFileSync } from 'node:fs'
import { resolve as resolvePath, parse as parsePath } from 'node:path'
import { IpcChannel } from '../../shared/ipc-channels'
import type {
  AiProvider,
  AiReport,
  AiSummary,
  BootstrapData,
  Category,
  ChatMessage,
  Document,
  DocumentPatch,
  ListFilter,
  LibrarySwitchResult,
  Result,
  SearchResult,
  WatchFolder,
  Workspace,
  WorkspaceItem,
  WorkspaceItemKind
} from '../../shared/ipc-types'
import type { Repositories } from '../db/repositories'
import type { SqliteDb } from '../db/types'
import { RepoError } from '../db/repositories/errors'
import { SETTING_KEYS } from '../db/settings-seed'
import type { ImportResult } from '../services/importer'
import { openPdf } from '../services/pdfOpen'
import { moveToLibrary, restoreToOriginal } from '../services/library'
import { relocate, deleteDocument, bulkDeleteDocuments, findPdfsRecursively } from '../services/files'
import { emitDocumentUpdated } from '../ipc/events'
import { writeExportFile, importFromJsonFile, toBibtex } from '../services/export'
import { isInsideLibrary, containsLibrary } from '../services/paths'
import { logger } from '../services/logger'
import type { createWatcher } from '../services/watcher'

type IpcChannelValue = (typeof IpcChannel)[keyof typeof IpcChannel]
type HandlerChannel = Exclude<
  IpcChannelValue,
  | typeof IpcChannel.EventDocumentUpdated
  | typeof IpcChannel.EventImportProgress
  | typeof IpcChannel.EventImportToast
  | typeof IpcChannel.EventMenuExportBibtex
  | typeof IpcChannel.EventLibraryScanning
  | typeof IpcChannel.EventLibrarySwitched
  | typeof IpcChannel.EventAiSummaryUpdated
  | typeof IpcChannel.EventAiChatToken
  | typeof IpcChannel.EventAiChatDone
  | typeof IpcChannel.EventAiChatError
  | typeof IpcChannel.EventAiReportCreated
>

function wrap<T>(fn: () => T): Result<T> {
  try {
    return { ok: true, data: fn() }
  } catch (e) {
    if (e instanceof RepoError) {
      return { ok: false, error: { code: e.code, message: e.message } }
    }
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: { code: 'internal_error', message } }
  }
}

async function asyncWrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    if (e instanceof RepoError) {
      return { ok: false, error: { code: e.code, message: e.message } }
    }
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: { code: 'internal_error', message } }
  }
}

function notImplemented(what: string): Result<never> {
  return { ok: false, error: { code: 'not_implemented', message: `${what} is not implemented yet` } }
}

function bootstrapFromSettings(repos: Repositories): BootstrapData {
  const bs = repos.settings.getBootstrapSettings()
  return {
    language: bs.language,
    windowBounds: bs.windowBounds,
    listColumnState: bs.listColumnState,
    sidebarCollapsed: bs.sidebarCollapsed,
    firstRun: !bs.libraryFolderPath,
    libraryFolderPath: bs.libraryFolderPath || null
  }
}

export function validateProxyUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      parsed.protocol === 'socks5:'
    )
  } catch {
    return false
  }
}

function applyProxyRules(rules: string): void {
  if (rules && !validateProxyUrl(rules)) {
    logger.warn(`proxy:invalid-url skipping setProxy: ${rules}`)
    return
  }
  void session.defaultSession.setProxy({ proxyRules: rules }).catch((e) => {
    logger.warn(`proxy:set failed: ${e instanceof Error ? e.message : String(e)}`)
  })
}

export interface RuntimeRef {
  repos: Repositories
  db?: SqliteDb
  importer?: {
    importFiles: (paths: string[], isWatch: boolean) => Promise<ImportResult>
    destroy: () => void
  }
  metadataService?: {
    enqueue: (docId: string) => void
    refreshMetadata: (docId: string) => void
    bulkRefreshMetadata: (ids: string[]) => void
    resumeOnStartup: () => void
    destroy: () => void
  }
  watcher?: ReturnType<typeof createWatcher>
  aiProvidersService?: unknown
  pdfTextService?: unknown
  aiSummaryService?: unknown
  aiAgentService?: unknown
}

export interface IpcHandlerDeps {
  getWin: () => BrowserWindow | null
  getRuntime: () => RuntimeRef | null
  switchLibraryFolder?: (folder: string) => Promise<LibrarySwitchResult>
}

export function createIpcHandlers(deps: IpcHandlerDeps) {
  const getWin = (): BrowserWindow | null => {
    const w = deps.getWin()
    if (!w || w.isDestroyed()) return null
    return w
  }

  const requireWin = (): BrowserWindow => {
    const w = getWin()
    if (!w) throw new Error('No active window')
    return w
  }

  const repos = (): Repositories => {
    const rt = deps.getRuntime()
    if (!rt) throw new Error('Runtime not ready')
    return rt.repos
  }

  function categorizeAndMoveToLibrary(docId: string, catId: string): void {
    const r = repos()
    const doc = r.documents.get(docId)
    if (!doc) throw new RepoError('not_found', `Document ${docId} not found`)
    const libraryFolder = r.settings.get<string>('libraryFolderPath', '')
    const alreadyInLibrary = libraryFolder ? isInsideLibrary(doc.filePath, libraryFolder) : false
    if (libraryFolder && !alreadyInLibrary) {
      try {
        const newPath = moveToLibrary(doc.filePath, libraryFolder)
        r.documents.updateFilePath(docId, newPath, parsePath(newPath).base)
      } catch (e) {
        logger.warn(
          `categorize:move-failed ${doc.filePath}: ${e instanceof Error ? e.message : String(e)}`
        )
      }
    }
    r.categories.assign(docId, catId)
  }

  const handlers = {
    [IpcChannel.Bootstrap]: (): Result<BootstrapData> => wrap(() => bootstrapFromSettings(repos())),

    [IpcChannel.DocumentsList]: (filter: ListFilter): Result<Document[]> =>
      wrap(() => repos().documents.list(filter)),
    [IpcChannel.DocumentsSearch]: (q: string): Result<SearchResult> =>
      wrap(() => repos().documents.search(q)),
    [IpcChannel.DocumentsGet]: (id: string): Result<Document | null> =>
      wrap(() => repos().documents.get(id)),
    [IpcChannel.DocumentsUpdate]: (id: string, patch: DocumentPatch): Result<Document> =>
      wrap(() => repos().documents.update(id, patch)),
    [IpcChannel.DocumentsSetStarred]: (id: string, value: boolean): Result<void> =>
      wrap(() => repos().documents.setStarred(id, value)),
    [IpcChannel.DocumentsDelete]: (id: string): Promise<Result<void>> =>
      asyncWrap(() => deleteDocument(repos(), id)),
    [IpcChannel.DocumentsBulkDelete]: (ids: string[]): Promise<Result<void>> =>
      asyncWrap(() => bulkDeleteDocuments(repos(), ids)),
    [IpcChannel.DocumentsBulkCategorize]: (ids: string[], catId: string): Result<void> =>
      wrap(() => {
        const r = repos()
        const cats = r.categories.list()
        const cat = cats.find((c) => c.id === catId)
        if (!cat) throw new RepoError('not_found', `Category ${catId} not found`)
        for (const id of ids) {
          categorizeAndMoveToLibrary(id, catId)
        }
      }),

    [IpcChannel.DocumentsBulkRefreshMetadata]: (ids: string[]): Result<void> => {
      const ms = deps.getRuntime()?.metadataService
      return ms ? (ms.bulkRefreshMetadata(ids), { ok: true, data: undefined }) : notImplemented('documents.bulkRefreshMetadata')
    },
    [IpcChannel.DocumentsCountPendingMetadata]: (): Result<number> =>
      wrap(() => repos().documents.countPendingMetadata()),
    [IpcChannel.DocumentsOpenPdf]: async (id: string): Promise<Result<Document>> =>
      asyncWrap(() => openPdf(repos(), getWin(), id)),
    [IpcChannel.DocumentsOpenInFinder]: (id: string): Result<void> =>
      wrap(() => {
        const doc = repos().documents.get(id)
        if (!doc) throw new RepoError('not_found', `Document ${id} not found`)
        shell.showItemInFolder(doc.filePath)
      }),
    [IpcChannel.DocumentsRefreshMetadata]: (id: string): Result<Document> => {
      const rt = deps.getRuntime()
      const ms = rt?.metadataService
      return ms
        ? wrap(() => {
            ms!.refreshMetadata(id)
            return rt!.repos.documents.get(id) as Document
          })
        : notImplemented('documents.refreshMetadata')
    },
    [IpcChannel.DocumentsRelocateFile]: async (id: string, newPath: string): Promise<Result<Document>> =>
      asyncWrap(async () => {
        let path = newPath
        if (!path) {
          const result = await dialog.showOpenDialog(requireWin(), {
            title: 'Select PDF File',
            properties: ['openFile'],
            filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
          })
          if (result.canceled || result.filePaths.length === 0) {
            const doc = repos().documents.get(id)
            if (!doc) throw new RepoError('not_found', `Document ${id} not found`)
            return doc
          }
          path = result.filePaths[0]
        }
        const doc = relocate(repos(), id, path)
        const w = getWin()
        if (w) emitDocumentUpdated(w, doc)
        return doc
      }),
    [IpcChannel.DocumentsRestoreFile]: (id: string): Result<Document> =>
      wrap(() => {
        const r = repos()
        restoreToOriginal(r, id)
        const doc = r.documents.get(id)
        return doc as Document
      }),

    [IpcChannel.ImportAddFiles]: async (paths: string[]): Promise<Result<string[]>> => {
      const importer = deps.getRuntime()?.importer
      if (!importer) return notImplemented('import.addFiles') as Result<string[]>
      let filePaths = paths
      if (filePaths.length === 0) {
        const w = requireWin()
        w.focus()
        const result = await dialog.showOpenDialog(w, {
          title: 'Add PDF Files',
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
        })
        if (result.canceled) return { ok: true, data: [] }
        filePaths = result.filePaths
      }
      return asyncWrap(async () => {
        const importResult = await importer.importFiles(filePaths, false)
        return importResult.added
      })
    },

    [IpcChannel.ImportAddFolder]: async (_dir: string): Promise<Result<string[]>> => {
      const importer = deps.getRuntime()?.importer
      if (!importer) return notImplemented('import.addFolder') as Result<string[]>
      const w = requireWin()
      w.focus()
      const result = await dialog.showOpenDialog(w, {
        title: 'Add Folder',
        properties: ['openDirectory']
      })
      if (result.canceled) return { ok: true, data: [] }
      const dir = result.filePaths[0]
      const pdfPaths = findPdfsRecursively(dir)
      return asyncWrap(async () => {
        const importResult = await importer.importFiles(pdfPaths, false)
        return importResult.added
      })
    },

    [IpcChannel.ImportFromJson]: async (_file: string): Promise<Result<number>> =>
      asyncWrap(async () => {
        const w = requireWin()
        w.focus()
        const result = await dialog.showOpenDialog(w, {
          title: 'Import JSON',
          properties: ['openFile'],
          filters: [{ name: 'JSON files', extensions: ['json'] }]
        })
        if (result.canceled || result.filePaths.length === 0) return 0
        const filePath = result.filePaths[0]

        const modeChoice = await dialog.showMessageBox(w, {
          type: 'question',
          title: 'Import Mode',
          message: 'How should the import handle existing data?',
          buttons: ['Merge (keep existing, add new)', 'Replace (clear all, import)', 'Cancel'],
          defaultId: 0,
          cancelId: 2
        })

        if (modeChoice.response === 2) return 0

        const mode = modeChoice.response === 1 ? 'replace' : 'merge'
        const rt = deps.getRuntime()
        if (!rt) throw new Error('Runtime not ready')
        return importFromJsonFile(rt.repos, filePath, mode, rt.db)
      }),

    [IpcChannel.CategoriesList]: (): Result<Category[]> => wrap(() => {
      const r = repos()
      const cats = r.categories.list()
      const counts = r.categories.countByCategory()
      return cats.map((c) => ({ ...c, count: counts.get(c.id) ?? 0 }))
    }),
    [IpcChannel.CategoriesCreate]: (name: string): Result<Category> =>
      wrap(() => repos().categories.create(name)),
    [IpcChannel.CategoriesRename]: (id: string, name: string): Result<void> =>
      wrap(() => repos().categories.rename(id, name)),
    [IpcChannel.CategoriesDelete]: (id: string): Result<void> => wrap(() => repos().categories.delete(id)),
    [IpcChannel.CategoriesAssign]: (docId: string, catId: string): Result<void> =>
      wrap(() => {
        const r = repos()
        const cats = r.categories.list()
        const cat = cats.find((c) => c.id === catId)
        if (!cat) throw new RepoError('not_found', `Category ${catId} not found`)
        categorizeAndMoveToLibrary(docId, catId)
      }),
    [IpcChannel.CategoriesUnassign]: (docId: string, catId: string): Result<void> =>
      wrap(() => repos().categories.unassign(docId, catId)),

    [IpcChannel.WatchList]: (): Result<WatchFolder[]> => wrap(() => repos().watchFolders.list()),
    [IpcChannel.WatchAdd]: async (path: string): Promise<Result<WatchFolder>> =>
      asyncWrap(async () => {
        const r = repos()
        const watcher = deps.getRuntime()?.watcher
        let absPath = path ? resolvePath(path) : ''
        if (!absPath) {
          const result = await dialog.showOpenDialog(requireWin(), {
            title: 'Select Watch Folder',
            properties: ['openDirectory']
          })
          if (result.canceled) throw new RepoError('cancelled', '')
          absPath = resolvePath(result.filePaths[0])
        }
        if (!existsSync(absPath)) throw new RepoError('invalid_path', `Path does not exist: ${absPath}`)
        if (!statSync(absPath).isDirectory()) throw new RepoError('invalid_path', `Not a directory: ${absPath}`)
        const libraryFolder = r.settings.get<string>('libraryFolderPath', '')
        if (libraryFolder) {
          if (isInsideLibrary(absPath, libraryFolder)) {
            throw new RepoError('inside_library', 'Path cannot be inside the library folder.')
          }
          if (containsLibrary(absPath, libraryFolder)) {
            throw new RepoError('contains_library', 'Path cannot be inside a watch folder.')
          }
        }
        const wf = r.watchFolders.add(absPath)
        if (wf.enabled === 1) watcher?.start(wf)
        return wf
      }),
    [IpcChannel.WatchRemove]: (id: string): Result<void> =>
      wrap(() => {
        const r = repos()
        const watcher = deps.getRuntime()?.watcher
        watcher?.stop(id)
        r.watchFolders.remove(id)
      }),
    [IpcChannel.WatchToggle]: (id: string, enabled: boolean): Result<void> =>
      wrap(() => {
        const r = repos()
        const watcher = deps.getRuntime()?.watcher
        r.watchFolders.toggle(id, enabled)
        if (enabled) {
          const wf = r.watchFolders.list().find((w) => w.id === id)
          if (wf) watcher?.start(wf)
        } else {
          watcher?.stop(id)
        }
      }),

    [IpcChannel.DialogOpenDirectory]: async (): Promise<Result<string | null>> =>
      asyncWrap(async () => {
        const result = await dialog.showOpenDialog(requireWin(), {
          title: 'Select Folder',
          properties: ['openDirectory']
        })
        if (result.canceled) return null
        return resolvePath(result.filePaths[0])
      }),

    [IpcChannel.LibrarySwitch]: async (folder: string): Promise<Result<LibrarySwitchResult>> =>
      asyncWrap(async () => {
        if (!deps.switchLibraryFolder) throw new RepoError('not_implemented', 'library switch not available')
        const w = getWin()
        if (w) w.focus()
        return deps.switchLibraryFolder(folder)
      }),

    [IpcChannel.SettingsGet]: (key: string, defaultValue: unknown): Result<unknown> =>
      wrap(() => repos().settings.get(key, defaultValue)),
    [IpcChannel.SettingsSet]: (key: string, value: unknown): Result<void> =>
      wrap(() => {
        const r = repos()
        if (!SETTING_KEYS.includes(key as never)) {
          throw new RepoError('forbidden_field', `Unknown setting key: ${key}`)
        }
        if (key === 'libraryFolderPath' && typeof value === 'string' && value) {
          throw new RepoError('use_library_switch', 'Use library.switch to change the library folder')
        }
        r.settings.set(key, value)
        if (key === 'proxyUrl') {
          const rules = typeof value === 'string' && value.trim() ? value.trim() : ''
          applyProxyRules(rules)
        }
      }),

    [IpcChannel.ExportToJson]: async (): Promise<Result<string>> =>
      asyncWrap(async () => {
        const result = await dialog.showSaveDialog(requireWin(), {
          title: 'Export JSON',
          defaultPath: `refora-export-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: 'JSON files', extensions: ['json'] }]
        })
        if (result.canceled || !result.filePath) return ''
        writeExportFile(repos(), result.filePath)
        return result.filePath
      }),
    [IpcChannel.ExportToBibtex]: async (ids: string[]): Promise<Result<string>> =>
      asyncWrap(async () => {
        if (ids.length === 0) return ''
        const r = repos()
        const docs = ids.map((id) => r.documents.get(id)).filter(Boolean) as Document[]
        if (docs.length === 0) return ''
        const result = await dialog.showSaveDialog(requireWin(), {
          title: 'Export BibTeX',
          defaultPath: `refora-export-${new Date().toISOString().slice(0, 10)}.bib`,
          filters: [{ name: 'BibTeX files', extensions: ['bib'] }]
        })
        if (result.canceled || !result.filePath) return ''
        const bibtex = toBibtex(docs)
        writeFileSync(result.filePath, bibtex, 'utf-8')
        return result.filePath
      }),
    [IpcChannel.ExportBibtexString]: async (ids: string[]): Promise<Result<string>> =>
      asyncWrap(async () => {
        if (ids.length === 0) return ''
        const r = repos()
        const docs = ids.map((id) => r.documents.get(id)).filter(Boolean) as Document[]
        if (docs.length === 0) return ''
        return toBibtex(docs)
      }),

    [IpcChannel.WorkspacesList]: (): Result<Workspace[]> =>
      wrap(() => repos().workspaces.list()),
    [IpcChannel.WorkspacesCreate]: (name: string): Result<Workspace> =>
      wrap(() => repos().workspaces.create(name)),
    [IpcChannel.WorkspacesRename]: (id: string, name: string): Result<void> =>
      wrap(() => repos().workspaces.rename(id, name)),
    [IpcChannel.WorkspacesDelete]: (id: string): Result<void> =>
      wrap(() => repos().workspaces.delete(id)),

    [IpcChannel.WorkspaceItemsList]: (workspaceId: string): Result<WorkspaceItem[]> =>
      wrap(() => repos().workspaceItems.list(workspaceId)),
    [IpcChannel.WorkspaceItemsAdd]: (
      workspaceId: string,
      kind: WorkspaceItemKind,
      ids: string[]
    ): Result<WorkspaceItem[]> => wrap(() => repos().workspaceItems.add(workspaceId, kind, ids)),
    [IpcChannel.WorkspaceItemsRemove]: (itemId: string): Result<void> =>
      wrap(() => repos().workspaceItems.remove(itemId)),
    [IpcChannel.WorkspaceItemsReorder]: (workspaceId: string, orderedIds: string[]): Result<void> =>
      wrap(() => repos().workspaceItems.reorder(workspaceId, orderedIds)),

    [IpcChannel.AiProvidersList]: (): Result<AiProvider[]> =>
      notImplemented('ai:providers:list') as Result<AiProvider[]>,
    [IpcChannel.AiProvidersCreate]: (_input: unknown): Result<AiProvider> =>
      notImplemented('ai:providers:create') as Result<AiProvider>,
    [IpcChannel.AiProvidersUpdate]: (_id: string, _patch: unknown): Result<AiProvider> =>
      notImplemented('ai:providers:update') as Result<AiProvider>,
    [IpcChannel.AiProvidersDelete]: (_id: string): Result<void> =>
      notImplemented('ai:providers:delete') as Result<void>,
    [IpcChannel.AiProvidersTest]: (_id: string): Result<{ ok: boolean; models?: string[] }> =>
      notImplemented('ai:providers:test') as Result<{ ok: boolean; models?: string[] }>,

    [IpcChannel.AiDocTextGet]: (_docId: string): Result<string> =>
      notImplemented('ai:docText:get') as Result<string>,
    [IpcChannel.AiSummarize]: (_docId: string): Result<void> =>
      notImplemented('ai:summarize') as Result<void>,
    [IpcChannel.AiSummaryGet]: (docId: string): Result<AiSummary | null> =>
      wrap(() => repos().aiSummaries.getSummary(docId)),

    [IpcChannel.AiChatSend]: (_req: unknown): Result<{ threadId: string }> =>
      notImplemented('ai:chat:send') as Result<{ threadId: string }>,
    [IpcChannel.AiChatHistory]: (threadId: string): Result<ChatMessage[]> =>
      wrap(() => {
        if (!threadId) return []
        return repos().chat.listMessages(threadId)
      }),

    [IpcChannel.AiReportsList]: (workspaceId: string): Result<AiReport[]> =>
      wrap(() => repos().aiReports.list(workspaceId)),
    [IpcChannel.AiReportsDelete]: (id: string): Result<void> =>
      wrap(() => repos().aiReports.delete(id))
  } satisfies Record<HandlerChannel, (...args: never[]) => unknown>

  return handlers
}

export type IpcHandlerMap = ReturnType<typeof createIpcHandlers>

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  const handlers = createIpcHandlers(deps)
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args) =>
      (handler as (...a: unknown[]) => unknown)(...args)
    )
  }
}
