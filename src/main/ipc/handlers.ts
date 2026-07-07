import { dialog, ipcMain, shell, session, type BrowserWindow } from 'electron'
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve as resolvePath, parse as parsePath } from 'node:path'
import { IpcChannel } from '../../shared/ipc-channels'
import type {
  BootstrapData,
  Category,
  Document,
  DocumentPatch,
  ListFilter,
  Result,
  SearchResult,
  WatchFolder
} from '../../shared/ipc-types'
import type { Repositories } from '../db/repositories'
import { RepoError } from '../db/repositories/errors'
import type { ImportResult } from '../services/importer'
import { openPdf } from '../services/pdfOpen'
import { resolveMovePolicy, moveToLibrary, restoreToOriginal } from '../services/library'
import { relocate, deleteDocument, bulkDeleteDocuments } from '../services/files'
import { emitDocumentUpdated } from '../ipc/events'
import { writeExportFile, importFromJsonFile, toBibtex } from '../services/export'
import type { createWatcher } from '../services/watcher'

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
  const docCount = repos.documents.list({ mode: 'all' }).length
  return {
    language: bs.language,
    windowBounds: bs.windowBounds,
    listColumnState: bs.listColumnState,
    sidebarCollapsed: bs.sidebarCollapsed,
    firstRun: docCount === 0
  }
}

function findPdfsRecursively(dir: string): string[] {
  const results: string[] = []
  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const full = join(dir, entry)
      try {
        const st = statSync(full)
        if (st.isDirectory()) {
          results.push(...findPdfsRecursively(full))
        } else if (st.isFile() && full.toLowerCase().endsWith('.pdf')) {
          results.push(resolvePath(full))
        }
      } catch {
        continue
      }
    }
  } catch {
    return []
  }
  return results
}

export interface IpcHandlerDeps {
  repos: Repositories
  win: BrowserWindow
  getWin?: () => BrowserWindow | null
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
}

export function createIpcHandlers(deps: IpcHandlerDeps) {
  const { repos, importer, metadataService, watcher } = deps

  const getWin = (): BrowserWindow | null => {
    const w = deps.getWin ? deps.getWin() : deps.win
    if (!w || w.isDestroyed()) return null
    return w
  }

  const requireWin = (): BrowserWindow => {
    const w = getWin()
    if (!w) throw new Error('No active window')
    return w
  }

  const handlers = {
    [IpcChannel.Bootstrap]: (): Result<BootstrapData> => wrap(() => bootstrapFromSettings(repos)),

    [IpcChannel.DocumentsList]: (filter: ListFilter): Result<Document[]> =>
      wrap(() => repos.documents.list(filter)),
    [IpcChannel.DocumentsSearch]: (q: string): Result<SearchResult> =>
      wrap(() => repos.documents.search(q)),
    [IpcChannel.DocumentsGet]: (id: string): Result<Document | null> =>
      wrap(() => repos.documents.get(id)),
    [IpcChannel.DocumentsUpdate]: (id: string, patch: DocumentPatch): Result<Document> =>
      wrap(() => repos.documents.update(id, patch)),
    [IpcChannel.DocumentsSetStarred]: (id: string, value: boolean): Result<void> =>
      wrap(() => repos.documents.setStarred(id, value)),
    [IpcChannel.DocumentsDelete]: (id: string): Promise<Result<void>> =>
      asyncWrap(() => deleteDocument(repos, id)),
    [IpcChannel.DocumentsBulkDelete]: (ids: string[]): Promise<Result<void>> =>
      asyncWrap(() => bulkDeleteDocuments(repos, ids)),
    [IpcChannel.DocumentsBulkCategorize]: (ids: string[], catId: string): Result<void> =>
      wrap(() => {
        const cats = repos.categories.list()
        const cat = cats.find((c) => c.id === catId)
        if (!cat) throw new RepoError('not_found', `Category ${catId} not found`)
        const globalSetting = repos.settings.get<string>('moveToLibraryOnCategorize', '1')
        const libraryFolder = repos.settings.get<string>('libraryFolderPath', '')
        const shouldMove = resolveMovePolicy(cat.moveToLibrary, globalSetting)
        for (const id of ids) {
          repos.categories.assign(id, catId)
          if (shouldMove && libraryFolder) {
            const doc = repos.documents.get(id)
            if (!doc) continue
            if (!doc.filePath.startsWith(libraryFolder)) {
              try {
                const newPath = moveToLibrary(doc.filePath, libraryFolder)
                repos.documents.updateFilePath(id, newPath, parsePath(newPath).base)
              } catch {
                continue
              }
            }
          }
        }
      }),

    [IpcChannel.DocumentsBulkRefreshMetadata]: (ids: string[]): Result<void> =>
      metadataService ? (metadataService.bulkRefreshMetadata(ids), { ok: true, data: undefined }) : notImplemented('documents.bulkRefreshMetadata'),
    [IpcChannel.DocumentsOpenPdf]: async (id: string): Promise<Result<Document>> =>
      asyncWrap(() => openPdf(repos, getWin(), id)),
    [IpcChannel.DocumentsOpenInFinder]: (id: string): Result<void> =>
      wrap(() => {
        const doc = repos.documents.get(id)
        if (!doc) throw new RepoError('not_found', `Document ${id} not found`)
        shell.showItemInFolder(doc.filePath)
      }),
    [IpcChannel.DocumentsRefreshMetadata]: (id: string): Result<Document> =>
      metadataService
        ? wrap(() => {
            metadataService!.refreshMetadata(id)
            return repos.documents.get(id) as Document
          })
        : notImplemented('documents.refreshMetadata'),
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
            const doc = repos.documents.get(id)
            if (!doc) throw new RepoError('not_found', `Document ${id} not found`)
            return doc
          }
          path = result.filePaths[0]
        }
        const doc = relocate(repos, id, path)
        const w = getWin()
        if (w) emitDocumentUpdated(w, doc)
        return doc
      }),
    [IpcChannel.DocumentsRestoreFile]: (id: string): Result<Document> =>
      wrap(() => {
        restoreToOriginal(repos, id)
        const doc = repos.documents.get(id)
        return doc as Document
      }),

    [IpcChannel.ImportAddFiles]: async (paths: string[]): Promise<Result<string[]>> => {
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
        return importFromJsonFile(repos, filePath, mode)
      }),

    [IpcChannel.CategoriesList]: (): Result<Category[]> => wrap(() => {
      const cats = repos.categories.list()
      const counts = repos.categories.countByCategory()
      return cats.map((c) => ({ ...c, count: counts.get(c.id) ?? 0 }))
    }),
    [IpcChannel.CategoriesCreate]: (name: string, moveToLibrary?: number): Result<Category> =>
      wrap(() => repos.categories.create(name, moveToLibrary)),
    [IpcChannel.CategoriesRename]: (id: string, name: string): Result<void> =>
      wrap(() => repos.categories.rename(id, name)),
    [IpcChannel.CategoriesDelete]: (id: string): Result<void> => wrap(() => repos.categories.delete(id)),
    [IpcChannel.CategoriesSetMoveToLibrary]: (id: string, value: number | null): Result<void> =>
      wrap(() => repos.categories.setMoveToLibrary(id, value)),
    [IpcChannel.CategoriesAssign]: (docId: string, catId: string): Result<void> =>
      wrap(() => {
        const doc = repos.documents.get(docId)
        if (!doc) throw new RepoError('not_found', `Document ${docId} not found`)
        const cats = repos.categories.list()
        const cat = cats.find((c) => c.id === catId)
        if (!cat) throw new RepoError('not_found', `Category ${catId} not found`)
        const globalSetting = repos.settings.get<string>('moveToLibraryOnCategorize', '1')
        const libraryFolder = repos.settings.get<string>('libraryFolderPath', '')
        const shouldMove = resolveMovePolicy(cat.moveToLibrary, globalSetting)
        const alreadyInLibrary = libraryFolder ? doc.filePath.startsWith(libraryFolder) : false
        if (shouldMove && !alreadyInLibrary) {
          try {
            const newPath = moveToLibrary(doc.filePath, libraryFolder)
            repos.documents.updateFilePath(docId, newPath, parsePath(newPath).base)
          } catch {
            repos.categories.assign(docId, catId)
            throw new RepoError('move_failed', 'Failed to move file to library folder')
          }
        }
        repos.categories.assign(docId, catId)
      }),
    [IpcChannel.CategoriesUnassign]: (docId: string, catId: string): Result<void> =>
      wrap(() => repos.categories.unassign(docId, catId)),

    [IpcChannel.WatchList]: (): Result<WatchFolder[]> => wrap(() => repos.watchFolders.list()),
    [IpcChannel.WatchAdd]: async (path: string): Promise<Result<WatchFolder>> =>
      asyncWrap(async () => {
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
        const libraryFolder = repos.settings.get<string>('libraryFolderPath', '')
        if (libraryFolder) {
          const normalizedLib = resolvePath(libraryFolder) + '/'
          const normalizedWatch = absPath + '/'
          if (normalizedWatch.startsWith(normalizedLib)) {
            throw new RepoError('inside_library', 'Path cannot be inside the library folder.')
          }
          if (normalizedLib.startsWith(normalizedWatch)) {
            throw new RepoError('contains_library', 'Path cannot be inside a watch folder.')
          }
        }
        const wf = repos.watchFolders.add(absPath)
        if (wf.enabled === 1) watcher?.start(wf)
        return wf
      }),
    [IpcChannel.WatchRemove]: (id: string): Result<void> =>
      wrap(() => {
        watcher?.stop(id)
        repos.watchFolders.remove(id)
      }),
    [IpcChannel.WatchToggle]: (id: string, enabled: boolean): Result<void> =>
      wrap(() => {
        repos.watchFolders.toggle(id, enabled)
        if (enabled) {
          const wf = repos.watchFolders.list().find((w) => w.id === id)
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

    [IpcChannel.SettingsGet]: (key: string, defaultValue: unknown): Result<unknown> =>
      wrap(() => repos.settings.get(key, defaultValue)),
    [IpcChannel.SettingsSet]: (key: string, value: unknown): Result<void> =>
      wrap(() => {
        repos.settings.set(key, value)
        if (key === 'proxyUrl') {
          const rules = typeof value === 'string' && value.trim() ? value.trim() : ''
          session.defaultSession.setProxy({ proxyRules: rules })
        }
        if (key === 'libraryFolderPath' && typeof value === 'string' && value) {
          const watchFolders = repos.watchFolders.list()
          const normalizedLib = resolvePath(value) + '/'
          for (const wf of watchFolders) {
            const normalizedWatch = resolvePath(wf.path) + '/'
            if (normalizedLib.startsWith(normalizedWatch)) {
              throw new RepoError('library_inside_watch', 'Library folder cannot be inside a watch folder.')
            }
          }
          watcher?.startLibraryWatcher(resolvePath(value))
        } else if (key === 'libraryFolderPath') {
          watcher?.stopLibraryWatcher()
        }
      }),

    [IpcChannel.ExportToJson]: async (): Promise<Result<string>> =>
      asyncWrap(async () => {
        const result = await dialog.showSaveDialog(requireWin(), {
          title: 'Export JSON',
          defaultPath: `scholarnote-export-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: 'JSON files', extensions: ['json'] }]
        })
        if (result.canceled || !result.filePath) return ''
        writeExportFile(repos, result.filePath)
        return result.filePath
      }),
    [IpcChannel.ExportToBibtex]: async (ids: string[]): Promise<Result<string>> =>
      asyncWrap(async () => {
        if (ids.length === 0) return ''
        const docs = ids.map((id) => repos.documents.get(id)).filter(Boolean) as Document[]
        if (docs.length === 0) return ''
        const result = await dialog.showSaveDialog(requireWin(), {
          title: 'Export BibTeX',
          defaultPath: `scholarnote-export-${new Date().toISOString().slice(0, 10)}.bib`,
          filters: [{ name: 'BibTeX files', extensions: ['bib'] }]
        })
        if (result.canceled || !result.filePath) return ''
        const bibtex = toBibtex(docs)
        const { writeFileSync } = await import('node:fs')
        writeFileSync(result.filePath, bibtex, 'utf-8')
        return result.filePath
      })
  }

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
