import { dialog, ipcMain, shell, session, type BrowserWindow } from 'electron'
import { existsSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolve as resolvePath, parse as parsePath } from 'node:path'
import { IpcChannel } from '../../shared/ipc-channels'
import type {
  AgentTraceStep,
  AiProvider,
  AiProviderInput,
  AiProviderPatch,
  AiReport,
  AiSummary,
  BibImportResult,
  BootstrapData,
  Category,
  ChatMessage,
  ChatSendRequest,
  ChatThread,
  Document,
  DocumentCounts,
  DocumentPatch,
  GlobalSearchResult,
  IdentifierImportResult,
  ListFilter,
  ListModelsRequest,
  ListModelsResult,
  LibrarySwitchResult,
  Result,
  SearchResult,
  WatchFolder,
  Workspace,
  WorkspaceAsset,
  WorkspaceAssetImportResult,
  WorkspaceAssetTextPreview,
  WorkspaceCanvasViewport,
  WorkspaceConnection,
  WorkspaceConnectionAnchor,
  WorkspaceItem,
  WorkspaceItemKind,
  WorkspaceItemPlacement,
  WorkspaceNote,
  WorkspaceNotePatch,
  WorkspaceNoteType
} from '../../shared/ipc-types'
import type { Repositories } from '../db/repositories'
import type { SqliteDb } from '../db/types'
import { RepoError } from '../db/repositories/errors'
import { SETTING_KEYS } from '../db/settings-seed'
import type { ImportResult } from '../services/importer'
import { openPdf } from '../services/pdfOpen'
import { moveToLibrary, restoreToOriginal } from '../services/library'
import { relocate, deleteDocument, bulkDeleteDocuments, findPdfsRecursively } from '../services/files'
import { resolvePdfFilePath } from '../services/pdfPath'
import { emitDocumentUpdated } from '../ipc/events'
import { writeExportFile, importFromJsonFile, toBibtex } from '../services/export'
import { importFromBibtex, type BibImportSource } from '../services/bibImport'
import { isInsideLibrary, containsLibrary } from '../services/paths'
import { importFromIdentifier } from '../services/identifierImport'
import { logger } from '../services/logger'
import type { createWatcher } from '../services/watcher'
import type { AiProvidersService } from '../services/aiProviders'
import type { PdfTextService } from '../services/pdfText'
import type { AiSummaryService } from '../services/aiSummary'
import type { AiAgentService } from '../services/aiAgent'
import type { AgentSandboxService } from '../services/agentSandbox'
import type { AgentExecutionService } from '../services/agentExecution'
import type { AgentArtifactPublisher } from '../services/agentArtifactPublisher'
import type { MineruEngineManager } from '../services/mineruEngineManager'
import type { MineruDocumentService } from '../services/mineruDocumentService'
import type { OcrJob, OcrProfile } from '../../shared/mineru-types'
import {
  deleteWorkspaceAsset,
  deleteWorkspaceWithAssets,
  getWorkspaceAssetTextPreview,
  importWorkspaceAssets,
  listWorkspaceAssets,
  openWorkspaceAsset,
  requireWorkspaceAssetFile,
  revealWorkspaceAsset
} from '../services/workspaceAssets'
import {
  writeFileToClipboard,
  writeMarkdownFileToClipboard,
  writeTextToClipboard
} from '../services/clipboard'

type IpcChannelValue = (typeof IpcChannel)[keyof typeof IpcChannel]
type HandlerChannel = Exclude<
  IpcChannelValue,
  | typeof IpcChannel.EventDocumentUpdated
  | typeof IpcChannel.EventWindowFocusChanged
  | typeof IpcChannel.EventImportProgress
  | typeof IpcChannel.EventImportToast
  | typeof IpcChannel.EventMenuExportBibtex
  | typeof IpcChannel.EventMenuImportZotero
  | typeof IpcChannel.EventMenuImportMendeley
  | typeof IpcChannel.EventMenuImportIdentifier
  | typeof IpcChannel.EventLibraryScanning
  | typeof IpcChannel.EventLibrarySwitched
  | typeof IpcChannel.EventAiSummaryUpdated
  | typeof IpcChannel.EventAiSummaryError
  | typeof IpcChannel.EventAiChatToken
  | typeof IpcChannel.EventAiChatReasoning
  | typeof IpcChannel.EventAiChatDone
  | typeof IpcChannel.EventAiChatError
  | typeof IpcChannel.EventAiChatTrace
  | typeof IpcChannel.EventAiChatTitleUpdated
  | typeof IpcChannel.EventAiReportCreated
  | typeof IpcChannel.EventWorkspaceItemsChanged
  | typeof IpcChannel.EventMineruInstallProgress
  | typeof IpcChannel.EventOcrProgress
  | typeof IpcChannel.EventOcrCompleted
  | typeof IpcChannel.EventOcrError
>

function errorResult(e: unknown): Result<never> {
  if (e instanceof RepoError) {
    return { ok: false, error: { code: e.code, message: e.message } }
  }
  const message = e instanceof Error ? e.message : String(e)
  return { ok: false, error: { code: 'internal_error', message } }
}

function wrap<T>(fn: () => T): Result<T> {
  try {
    return { ok: true, data: fn() }
  } catch (e) {
    return errorResult(e)
  }
}

async function asyncWrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    return errorResult(e)
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
    updateVerifiedArxivId: (docId: string, input: string) => Promise<Document>
    refreshMetadata: (docId: string) => void
    bulkRefreshMetadata: (ids: string[]) => void
    resumeOnStartup: () => void
    destroy: () => void
  }
  watcher?: ReturnType<typeof createWatcher>
  aiProvidersService?: AiProvidersService
  pdfTextService?: PdfTextService
  aiSummaryService?: AiSummaryService
  aiAgentService?: AiAgentService
  agentSandboxService?: AgentSandboxService
  agentExecutionService?: AgentExecutionService
  agentArtifactPublisher?: AgentArtifactPublisher
  mineruDocumentService?: MineruDocumentService
}

export interface IpcHandlerDeps {
  getWin: () => BrowserWindow | null
  getRuntime: () => RuntimeRef | null
  mineruEngineManager: MineruEngineManager
  switchLibraryFolder?: (folder: string) => Promise<LibrarySwitchResult>
}

async function importBibtex(
  deps: IpcHandlerDeps,
  source: BibImportSource
): Promise<BibImportResult> {
  const w = deps.getWin()
  if (!w || w.isDestroyed()) throw new Error('No active window')
  w.focus()
  const title = source === 'zotero' ? 'Import from Zotero (BibTeX)' : 'Import from Mendeley (BibTeX)'
  const result = await dialog.showOpenDialog(w, {
    title,
    properties: ['openFile'],
    filters: [{ name: 'BibTeX files', extensions: ['bib', 'bibtex'] }]
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { added: 0, skipped: 0, errors: [] }
  }
  const rt = deps.getRuntime()
  if (!rt) throw new Error('Runtime not ready')
  const res = await importFromBibtex(
    rt.repos,
    result.filePaths[0],
    source,
    rt.metadataService?.updateVerifiedArxivId
  )
  return { added: res.added.length, skipped: res.skipped.length, errors: res.errors }
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
        const newPath = moveToLibrary(resolvePdfFilePath(doc.filePath), libraryFolder)
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
    [IpcChannel.DocumentsCount]: (): Result<DocumentCounts> =>
      wrap(() => repos().documents.counts()),
    [IpcChannel.DocumentsSearch]: (q: string): Result<SearchResult> =>
      wrap(() => repos().documents.search(q)),
    [IpcChannel.DocumentsGet]: (id: string): Result<Document | null> =>
      wrap(() => repos().documents.get(id)),
    [IpcChannel.DocumentsUpdate]: (id: string, patch: DocumentPatch): Result<Document> | Promise<Result<Document>> => {
      if (patch.arxivId === undefined) return wrap(() => repos().documents.update(id, patch))
      if (typeof patch.arxivId !== 'string') return wrap(() => repos().documents.update(id, patch))
      const rawArxivId = patch.arxivId
      return asyncWrap(async () => {
        const service = deps.getRuntime()?.metadataService
        if (!service) throw new RepoError('metadata_unavailable', 'Metadata service is unavailable')
        const otherFields = { ...patch }
        delete otherFields.arxivId
        const verified = await service.updateVerifiedArxivId(id, rawArxivId)
        return Object.keys(otherFields).length > 0
          ? repos().documents.update(verified.id, otherFields)
          : verified
      })
    },
    [IpcChannel.DocumentsSetStarred]: (id: string, value: boolean): Result<void> =>
      wrap(() => repos().documents.setStarred(id, value)),
    [IpcChannel.DocumentsDelete]: (id: string): Promise<Result<void>> =>
      asyncWrap(async () => {
        await deps.getRuntime()?.mineruDocumentService?.prepareDocumentDelete(id)
        await deleteDocument(repos(), id)
      }),
    [IpcChannel.DocumentsBulkDelete]: (ids: string[]): Promise<Result<void>> =>
      asyncWrap(async () => {
        const service = deps.getRuntime()?.mineruDocumentService
        if (service) {
          for (const id of ids) await service.prepareDocumentDelete(id)
        }
        await bulkDeleteDocuments(repos(), ids)
      }),
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
      return ms ? wrap(() => ms.bulkRefreshMetadata(ids)) : notImplemented('documents.bulkRefreshMetadata')
    },
    [IpcChannel.DocumentsOpenPdf]: async (id: string): Promise<Result<Document>> =>
      asyncWrap(() => openPdf(repos(), getWin(), id)),
    [IpcChannel.DocumentsOpenInFinder]: (id: string): Result<void> =>
      wrap(() => {
        const doc = repos().documents.get(id)
        if (!doc) throw new RepoError('not_found', `Document ${id} not found`)
        shell.showItemInFolder(resolvePdfFilePath(doc.filePath))
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
        const doc = await relocate(repos(), id, path)
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

    [IpcChannel.GlobalSearch]: (q: string): Result<GlobalSearchResult> =>
      wrap(() => {
        if (typeof q !== 'string' || !q.trim()) {
          return { documents: [], workspaceFiles: [], workspaceContents: [], chats: [] }
        }
        const r = repos()
        const query = q.trim().slice(0, 500)
        return {
          documents: r.documents.search(query, 10),
          workspaceFiles: r.workspaceAssets.search(query, 10),
          workspaceContents: r.workspaces.searchContent(query, 10),
          chats: r.chat.search(query, 10)
        }
      }),

    [IpcChannel.ImportAddFiles]: (paths: string[]): Promise<Result<ImportResult>> => {
      const importer = deps.getRuntime()?.importer
      if (!importer) return Promise.resolve(notImplemented('import.addFiles') as Result<ImportResult>)
      return asyncWrap(async () => {
        let filePaths = paths
        if (filePaths.length === 0) {
          const w = requireWin()
          w.focus()
          const result = await dialog.showOpenDialog(w, {
            title: 'Add PDF Files',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
          })
          if (result.canceled) return { added: [], skipped: [], errors: [] }
          filePaths = result.filePaths
        }
        return importer.importFiles(filePaths, false)
      })
    },

    [IpcChannel.ImportAddFolder]: (requestedDir: string): Promise<Result<ImportResult>> => {
      const importer = deps.getRuntime()?.importer
      if (!importer) return Promise.resolve(notImplemented('import.addFolder') as Result<ImportResult>)
      return asyncWrap(async () => {
        let dir = requestedDir ? resolvePath(requestedDir) : ''
        if (!dir) {
          const w = requireWin()
          w.focus()
          const result = await dialog.showOpenDialog(w, {
            title: 'Add Folder',
            properties: ['openDirectory']
          })
          if (result.canceled) return { added: [], skipped: [], errors: [] }
          dir = resolvePath(result.filePaths[0])
        }
        if (!existsSync(dir) || !statSync(dir).isDirectory()) {
          throw new RepoError('invalid_path', `Not a directory: ${dir}`)
        }
        const pdfPaths = await findPdfsRecursively(dir)
        return importer.importFiles(pdfPaths, false)
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

    [IpcChannel.ImportFromZotero]: async (): Promise<Result<BibImportResult>> =>
      asyncWrap(() => importBibtex(deps, 'zotero')),

    [IpcChannel.ImportFromMendeley]: async (): Promise<Result<BibImportResult>> =>
      asyncWrap(() => importBibtex(deps, 'mendeley')),

    [IpcChannel.ImportFromIdentifier]: async (identifier: string): Promise<Result<IdentifierImportResult>> =>
      asyncWrap(async () => {
        const rt = deps.getRuntime()
        if (!rt) throw new Error('Runtime not ready')
        return importFromIdentifier(
          { repos: rt.repos, getLibraryFolder: () => rt.repos.settings.get<string>('libraryFolderPath', '') },
           identifier
         )
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

    [IpcChannel.MineruStatus]: (): Promise<Result<Awaited<ReturnType<MineruEngineManager['getStatus']>>>> =>
      asyncWrap(() => deps.mineruEngineManager.getStatus()),
    [IpcChannel.MineruChooseInstallRoot]: (): Promise<Result<Awaited<ReturnType<MineruEngineManager['getStatus']>>>> =>
      asyncWrap(async () => {
        const result = await dialog.showOpenDialog(requireWin(), {
          title: 'Select MinerU Install Location',
          properties: ['openDirectory', 'createDirectory']
        })
        if (result.canceled || result.filePaths.length === 0) {
          return deps.mineruEngineManager.getStatus()
        }
        return deps.mineruEngineManager.setInstallRoot(resolvePath(result.filePaths[0]))
      }),
    [IpcChannel.MineruInstall]: (): Promise<Result<Awaited<ReturnType<MineruEngineManager['getStatus']>>>> =>
      asyncWrap(() => deps.mineruEngineManager.install()),
    [IpcChannel.MineruCancelInstall]: (): Promise<Result<Awaited<ReturnType<MineruEngineManager['getStatus']>>>> =>
      asyncWrap(() => deps.mineruEngineManager.cancelInstall()),
    [IpcChannel.MineruUninstall]: (): Promise<Result<Awaited<ReturnType<MineruEngineManager['getStatus']>>>> =>
      asyncWrap(async () => {
        await deps.getRuntime()?.mineruDocumentService?.stopWorker()
        return deps.mineruEngineManager.uninstall()
      }),

    [IpcChannel.OcrGetState]: (documentId: string): Promise<Result<Awaited<ReturnType<MineruDocumentService['getState']>>>> =>
      asyncWrap(async () => {
        const service = deps.getRuntime()?.mineruDocumentService
        if (!service) throw new RepoError('not_ready', 'OCR service is not ready')
        return service.getState(documentId)
      }),
    [IpcChannel.OcrStart]: (documentId: string, profile: OcrProfile): Promise<Result<OcrJob>> =>
      asyncWrap(async () => {
        const service = deps.getRuntime()?.mineruDocumentService
        if (!service) throw new RepoError('not_ready', 'OCR service is not ready')
        return service.start(documentId, profile)
      }),
    [IpcChannel.OcrCancel]: (jobId: string): Promise<Result<OcrJob>> =>
      asyncWrap(async () => {
        const service = deps.getRuntime()?.mineruDocumentService
        if (!service) throw new RepoError('not_ready', 'OCR service is not ready')
        return service.cancel(jobId)
      }),
    [IpcChannel.OcrReadMarkdown]: (documentId: string, resultKey: string): Promise<Result<string>> =>
      asyncWrap(async () => {
        const service = deps.getRuntime()?.mineruDocumentService
        if (!service) throw new RepoError('not_ready', 'OCR service is not ready')
        return service.readMarkdown(documentId, resultKey)
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

    [IpcChannel.ClipboardWriteText]: (text: string): Result<void> =>
      wrap(() => writeTextToClipboard(text)),
    [IpcChannel.ClipboardCopyMarkdown]: (title: string, content: string): Result<void> =>
      wrap(() => {
        writeMarkdownFileToClipboard(title, content)
      }),
    [IpcChannel.ClipboardCopyWorkspaceAsset]: (id: string): Result<void> =>
      wrap(() => writeFileToClipboard(requireWorkspaceAssetFile(repos(), id).filePath)),

    [IpcChannel.WorkspacesList]: (): Result<Workspace[]> =>
      wrap(() => repos().workspaces.list()),
    [IpcChannel.WorkspacesCreate]: (name: string): Promise<Result<Workspace>> =>
      asyncWrap(async () => {
        const rt = deps.getRuntime()
        const workspace = repos().workspaces.create(name)
        try {
          await rt?.agentSandboxService?.ensure(workspace.id)
          return workspace
        } catch (error) {
          repos().workspaces.delete(workspace.id)
          throw error
        }
      }),
    [IpcChannel.WorkspacesRename]: (id: string, name: string): Result<void> =>
      wrap(() => repos().workspaces.rename(id, name)),
    [IpcChannel.WorkspacesDelete]: (id: string): Promise<Result<void>> =>
      asyncWrap(async () => {
        const rt = deps.getRuntime()
        await deleteWorkspaceWithAssets(repos(), id)
        try {
          await rt?.agentSandboxService?.deleteWorkspace(id)
        } catch (error) {
          logger.warn(`agentSandbox:trash-failed ${id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }),
    [IpcChannel.WorkspacesOpenSandbox]: (id: string): Promise<Result<void>> =>
      asyncWrap(async () => {
        const rt = deps.getRuntime()
        if (!rt?.agentSandboxService) throw new RepoError('not_ready', 'Agent sandbox is not available')
        if (!repos().workspaces.list().some((workspace) => workspace.id === id)) {
          throw new RepoError('not_found', `workspace not found: ${id}`)
        }
        const paths = await rt.agentSandboxService.ensure(id)
        const message = await shell.openPath(paths.sandboxRoot)
        if (message) throw new RepoError('open_failed', message)
      }),

    [IpcChannel.WorkspaceItemsList]: (workspaceId: string): Result<WorkspaceItem[]> =>
      wrap(() => repos().workspaceItems.list(workspaceId)),
    [IpcChannel.WorkspaceItemsAdd]: (
      workspaceId: string,
      kind: WorkspaceItemKind,
      ids: string[],
      placement?: WorkspaceItemPlacement
    ): Result<WorkspaceItem[]> => wrap(() => {
      const rt = repos()
      return rt.transaction(() => rt.workspaceItems.add(workspaceId, kind, ids, placement))
    }),
    [IpcChannel.WorkspaceItemsRemove]: (itemId: string): Result<void> =>
      wrap(() => repos().workspaceItems.remove(itemId)),
    [IpcChannel.WorkspaceItemsReorder]: (workspaceId: string, orderedIds: string[]): Result<WorkspaceItem[]> =>
      wrap(() => {
        const rt = repos()
        return rt.transaction(() => rt.workspaceItems.reorder(workspaceId, orderedIds))
      }),
    [IpcChannel.WorkspaceItemsResize]: (itemId: string, width: number, height: number): Result<WorkspaceItem> =>
      wrap(() => repos().workspaceItems.resize(itemId, width, height)),
    [IpcChannel.WorkspaceItemsMove]: (itemId: string, x: number, y: number, zIndex: number): Result<WorkspaceItem> =>
      wrap(() => repos().workspaceItems.move(itemId, x, y, zIndex)),

    [IpcChannel.WorkspaceAssetsList]: (workspaceId: string): Result<WorkspaceAsset[]> =>
      wrap(() => listWorkspaceAssets(repos(), workspaceId)),
    [IpcChannel.WorkspaceAssetsAddFiles]: (
      workspaceId: string,
      paths: string[],
      placement?: WorkspaceItemPlacement
    ): Promise<Result<WorkspaceAssetImportResult>> =>
      asyncWrap(async () => {
        let filePaths = paths
        if (filePaths.length === 0) {
          const result = await dialog.showOpenDialog(requireWin(), {
            title: 'Add Files to Workspace',
            properties: ['openFile', 'multiSelections']
          })
          if (result.canceled) return { imported: [], errors: [] }
          filePaths = result.filePaths
        }
        return importWorkspaceAssets(repos(), workspaceId, filePaths, placement)
      }),
    [IpcChannel.WorkspaceAssetsTextPreview]: (id: string): Promise<Result<WorkspaceAssetTextPreview>> =>
      asyncWrap(() => getWorkspaceAssetTextPreview(repos(), id)),
    [IpcChannel.WorkspaceAssetsOpen]: (id: string): Promise<Result<void>> =>
      asyncWrap(() => openWorkspaceAsset(repos(), id)),
    [IpcChannel.WorkspaceAssetsReveal]: (id: string): Result<void> =>
      wrap(() => revealWorkspaceAsset(repos(), id)),
    [IpcChannel.WorkspaceAssetsDelete]: (id: string): Promise<Result<void>> =>
      asyncWrap(() => deleteWorkspaceAsset(repos(), id)),

    [IpcChannel.WorkspaceCanvasGet]: (workspaceId: string): Result<WorkspaceCanvasViewport> =>
      wrap(() => repos().workspaceCanvas.get(workspaceId)),
    [IpcChannel.WorkspaceCanvasUpdate]: (
      workspaceId: string,
      viewport: WorkspaceCanvasViewport
    ): Result<WorkspaceCanvasViewport> => wrap(() => repos().workspaceCanvas.update(workspaceId, viewport)),

    [IpcChannel.WorkspaceConnectionsList]: (workspaceId: string): Result<WorkspaceConnection[]> =>
      wrap(() => repos().workspaceConnections.list(workspaceId)),
    [IpcChannel.WorkspaceConnectionsCreate]: (
      workspaceId: string,
      sourceItemId: string,
      targetItemId: string,
      sourceAnchor: WorkspaceConnectionAnchor,
      targetAnchor: WorkspaceConnectionAnchor
    ): Result<WorkspaceConnection> =>
      wrap(() => repos().workspaceConnections.create(
        workspaceId,
        sourceItemId,
        targetItemId,
        sourceAnchor,
        targetAnchor
      )),
    [IpcChannel.WorkspaceConnectionsDelete]: (id: string): Result<void> =>
      wrap(() => repos().workspaceConnections.remove(id)),

    [IpcChannel.WorkspaceNotesList]: (workspaceId: string): Result<WorkspaceNote[]> =>
      wrap(() => repos().workspaceNotes.list(workspaceId)),
    [IpcChannel.WorkspaceNotesCreate]: (
      workspaceId: string,
      title: string,
      contentMd: string,
      noteType: WorkspaceNoteType,
      placement?: WorkspaceItemPlacement
    ): Result<WorkspaceNote> => wrap(() => {
      const rt = repos()
      return rt.transaction(() => {
        const note = rt.workspaceNotes.create(workspaceId, title, contentMd, noteType)
        rt.workspaceItems.add(workspaceId, 'note', [note.id], placement)
        return note
      })
    }),
    [IpcChannel.WorkspaceNotesUpdate]: (id: string, patch: WorkspaceNotePatch): Result<WorkspaceNote> =>
      wrap(() => repos().workspaceNotes.update(id, patch)),
    [IpcChannel.WorkspaceNotesDelete]: (id: string): Result<void> =>
      wrap(() => {
        const rt = repos()
        return rt.transaction(() => {
          rt.workspaceItems.removeByNoteId(id)
          rt.workspaceNotes.delete(id)
        })
      }),

    [IpcChannel.AiProvidersList]: (): Result<AiProvider[]> => {
      const rt = deps.getRuntime()
      return wrap(() => rt!.aiProvidersService!.list())
    },
    [IpcChannel.AiProvidersCreate]: (input: AiProviderInput): Promise<Result<AiProvider>> => {
      const rt = deps.getRuntime()
      return asyncWrap(async () => rt!.aiProvidersService!.create(input))
    },
    [IpcChannel.AiProvidersUpdate]: (
      id: string,
      patch: AiProviderPatch
    ): Promise<Result<AiProvider>> => {
      const rt = deps.getRuntime()
      return asyncWrap(async () => rt!.aiProvidersService!.update(id, patch))
    },
    [IpcChannel.AiProvidersDelete]: (id: string): Result<void> => {
      const rt = deps.getRuntime()
      return wrap(() => rt!.aiProvidersService!.remove(id))
    },
    [IpcChannel.AiProvidersTest]: (id: string): Promise<Result<{ ok: boolean; models?: string[] }>> => {
      const rt = deps.getRuntime()
      return asyncWrap(async () => rt!.aiProvidersService!.test(id))
    },
    [IpcChannel.AiProvidersListModels]: (req: ListModelsRequest): Promise<Result<ListModelsResult>> => {
      const rt = deps.getRuntime()
      return asyncWrap(async () => rt!.aiProvidersService!.listModels(req))
    },

    [IpcChannel.AiDocTextGet]: (id: string): Promise<Result<string>> => {
      const rt = deps.getRuntime()
      return asyncWrap(async () => rt!.pdfTextService!.getOrExtract(id))
    },
    [IpcChannel.AiSummarize]: (id: string): Result<void> => {
      const rt = deps.getRuntime()
      return wrap(() => {
        rt!.aiSummaryService!.summarize(id)
        return undefined
      })
    },
    [IpcChannel.AiSummaryGet]: (docId: string): Result<AiSummary | null> =>
      wrap(() => repos().aiSummaries.getSummary(docId)),

    [IpcChannel.AiChatSend]: (req: ChatSendRequest): Promise<Result<{ threadId: string; runId: string }>> =>
      asyncWrap(async () => {
        const rt = deps.getRuntime()
        if (!rt?.aiAgentService) throw new RepoError('not_ready', 'Agent service not ready')

        const pid = req.providerId || repos().settings.get<string>('activeProviderId', '')
        if (!pid) throw new RepoError('no_provider', 'No AI provider configured')
        const raw = repos().aiProviders.getRaw(pid)
        if (!raw || !raw.apiKeyEnc) throw new RepoError('no_api_key', 'Provider has no API key')

        if (req.attachments?.length) {
          if (!req.workspaceId) {
            throw new RepoError('invalid_attachment', 'Attachments require a workspace')
          }
          const wsItems = repos().workspaceItems.list(req.workspaceId).filter((i) => i.kind === 'document')
          const wsDocIds = new Set(wsItems.map((i) => i.docId).filter((d): d is string => d !== null))
          for (const att of req.attachments) {
            if (att.type !== 'document' || !wsDocIds.has(att.docId)) {
              throw new RepoError('invalid_attachment', 'Attachment is not a valid document in this workspace')
            }
          }
        }

        let threadId = req.threadId
        if (threadId) {
          const thread = rt.repos.chat.getThread(threadId)
          if (!thread || thread.workspaceId !== req.workspaceId) {
            throw new RepoError('not_found', 'Chat thread not found in this workspace')
          }
          if (req.replaceLastExchange) {
            rt.repos.transaction(() => {
              rt.repos.chat.deleteLastExchange(threadId!)
              if (req.replaceRunId) {
                rt.repos.agentTraces.deleteByRun(threadId!, req.replaceRunId)
              }
            })
          }
        } else {
          if (req.replaceLastExchange) {
            throw new RepoError('invalid_request', 'Cannot replace an exchange without a thread')
          }
          const thread = rt.repos.chat.createThread(req.workspaceId, pid)
          threadId = thread.id
        }
        const runId = req.runId?.trim() || randomUUID()
        void rt.aiAgentService.run({ ...req, threadId, runId }, threadId, runId)
        return { threadId, runId }
      }),
    [IpcChannel.AiChatHistory]: (threadId: string): Result<ChatMessage[]> =>
      wrap(() => {
        if (!threadId) return []
        return repos().chat.listMessages(threadId).filter((m) => m.role !== 'tool')
      }),
    [IpcChannel.AiChatThreads]: (workspaceId: string | null): Result<ChatThread[]> =>
      wrap(() => repos().chat.listThreads(workspaceId)),
    [IpcChannel.AiChatTraces]: (threadId: string): Result<AgentTraceStep[]> =>
      wrap(() => {
        if (!threadId) return []
        return repos().agentTraces.listByThread(threadId)
      }),
    [IpcChannel.AiChatCancel]: (threadId: string): Result<void> =>
      wrap(() => {
        const rt = deps.getRuntime()
        if (!rt?.aiAgentService) throw new RepoError('not_ready', 'Agent service not ready')
        rt.aiAgentService.cancel(threadId)
        return undefined
      }),
    [IpcChannel.AiChatDeleteThread]: (threadId: string): Result<void> =>
      wrap(() => {
        const rt = deps.getRuntime()
        rt?.aiAgentService?.cancel(threadId)
        repos().agentTraces.deleteByThread(threadId)
        repos().chat.deleteThread(threadId)
        return undefined
      }),
    [IpcChannel.AiChatRenameThread]: (threadId: string, title: string): Result<ChatThread> =>
      wrap(() => repos().chat.updateTitle(threadId, title)),

    [IpcChannel.AiReportsList]: (workspaceId: string): Result<AiReport[]> =>
      wrap(() => repos().aiReports.list(workspaceId)),
    [IpcChannel.AiReportsDelete]: (id: string): Result<void> =>
      wrap(() => {
        const rt = repos()
        return rt.transaction(() => {
          rt.workspaceItems.removeByReportId(id)
          rt.aiReports.delete(id)
        })
      }),
    [IpcChannel.AiReportsUpdate]: (id: string, patch: { title?: string; contentMd?: string }): Result<AiReport> =>
      wrap(() => {
        const rt = repos()
        return rt.transaction(() => rt.aiReports.update(id, patch))
      })
  } satisfies Record<HandlerChannel, (...args: never[]) => unknown>

  return handlers
}

export type IpcHandlerMap = ReturnType<typeof createIpcHandlers>

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  const handlers = createIpcHandlers(deps)
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args) => {
      try {
        const result = (handler as (...a: unknown[]) => unknown)(...args)
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          return (result as Promise<unknown>).catch((e) => errorResult(e))
        }
        return result
      } catch (e) {
        return errorResult(e)
      }
    })
  }
}
