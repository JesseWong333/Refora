import { app, BrowserWindow, Menu, shell, session, dialog, nativeImage } from 'electron'
import { join, resolve as resolvePath } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { initLogger, logger } from './services/logger'
import { openDatabase, seedSettings, closeDatabase, getSetting, getSearchMode } from './db/connection'
import { createRepositories } from './db/repositories'
import { RepoError } from './db/repositories/errors'
import { registerIpcHandlers, validateProxyUrl, type RuntimeRef } from './ipc/handlers'
import { createImporter } from './services/importer'
import { createMetadataService } from './services/metadata'
import { createWatcher } from './services/watcher'
import { createAiProvidersService } from './services/aiProviders'
import { createPdfTextService } from './services/pdfText'
import { createAiSummaryService } from './services/aiSummary'
import type { AiProvidersService } from './services/aiProviders'
import type { PdfTextService } from './services/pdfText'
import type { AiSummaryService } from './services/aiSummary'
import { createAiAgentService } from './services/aiAgent'
import type { AiAgentService } from './services/aiAgent'
import { checkMissing, findPdfsRecursively } from './services/files'
import { writeExportFile, importFromJsonFile } from './services/export'
import { emitLibraryScanning, emitLibrarySwitched } from './ipc/events'
import { dbPathForLibraryFolder, dbExistsInLibraryFolder, DB_FILE_NAME } from './db/dbPath'
import { readLibraryFolderPath, writeLibraryFolderPath } from './services/prefs'
import { IpcChannel } from '../shared/ipc-channels'
import type { LibrarySwitchResult } from '../shared/ipc-types'
import { createExclusiveTask } from './services/exclusiveTask'
import { runMenuAction } from './services/menuAction'
import { prepareReplacement } from './services/resourceReplacement'

let isDev = false
const IS_MAC = process.platform === 'darwin'

type DbConnection = ReturnType<typeof openDatabase>
interface Runtime extends RuntimeRef {
  db: DbConnection
  importer: ReturnType<typeof createImporter>
  metadataService: ReturnType<typeof createMetadataService>
  watcher: ReturnType<typeof createWatcher>
  missingCheckInterval: ReturnType<typeof setInterval> | null
  missingCheckAbort: AbortController
  activated: boolean
  aiProvidersService: AiProvidersService
  pdfTextService: PdfTextService
  aiSummaryService: AiSummaryService
  aiAgentService: AiAgentService
}
let runtime: Runtime | null = null
let win: BrowserWindow | null = null
let isQuitting = false

function detectLanguage(): 'zh' | 'en' {
  try {
    const locale = app.getLocale().toLowerCase()
    return locale.startsWith('zh') ? 'zh' : 'en'
  } catch {
    return 'en'
  }
}

function reportMenuError(action: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  logger.error(`${action}: ${message}`)
  dialog.showErrorBox(`${action} Failed`, message)
}

function applyCsp(): void {
  const prod =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
  const dev =
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:*"
  const csp = app.isPackaged ? prod : dev
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}

function buildMenu(): Menu {
  const getWin = (): BrowserWindow | null => (win && !win.isDestroyed() ? win : null)
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        {
          label: 'Add File',
          accelerator: 'Cmd+I',
          click: async () => {
            const w = getWin()
            if (!w || !runtime) return
            const result = await dialog.showOpenDialog(w, {
              title: 'Add PDF Files',
              properties: ['openFile', 'multiSelections'],
              filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
            })
            if (result.canceled) return
            void runtime.importer.importFiles(result.filePaths, false)
          }
        },
        {
          label: 'Import by Identifier…',
          accelerator: 'Cmd+Shift+I',
          click: () => {
            const w = getWin()
            if (w && !w.isDestroyed()) {
              w.webContents.send('menu:import-identifier')
            }
          }
        },
        {
          label: 'Add Folder',
          click: () => {
            void runMenuAction(async () => {
              const w = getWin()
              const current = runtime
              if (!w || !current) return
              const result = await dialog.showOpenDialog(w, {
                title: 'Add Folder',
                properties: ['openDirectory']
              })
              if (result.canceled) return
              const dir = result.filePaths[0]
              const pdfs = await findPdfsRecursively(dir)
              await current.importer.importFiles(pdfs, false)
            }, (error) => reportMenuError('add folder', error))
          }
        },
        { type: 'separator' },
        {
          label: 'Import JSON\u2026',
          click: () => {
            void runMenuAction(async () => {
              const w = getWin()
              const current = runtime
              if (!w || !current) return
              const result = await dialog.showOpenDialog(w, {
                title: 'Import JSON',
                properties: ['openFile'],
                filters: [{ name: 'JSON files', extensions: ['json'] }]
              })
              if (result.canceled || result.filePaths.length === 0) return
              const modeChoice = await dialog.showMessageBox(w, {
                type: 'question',
                title: 'Import Mode',
                message: 'How should the import handle existing data?',
                buttons: ['Merge (keep existing, add new)', 'Replace (clear all, import)', 'Cancel'],
                defaultId: 0,
                cancelId: 2
              })
              if (modeChoice.response === 2) return
              const mode = modeChoice.response === 1 ? 'replace' : 'merge'
              const count = importFromJsonFile(current.repos, result.filePaths[0], mode, current.db)
              logger.info(`import:json ${count} documents`)
            }, (error) => reportMenuError('Import JSON', error))
          }
        },
        { type: 'separator' },
        {
          label: 'Import from Zotero\u2026',
          click: () => {
            const w = getWin()
            if (w && !w.isDestroyed()) w.webContents.send('menu:import-zotero')
          }
        },
        {
          label: 'Import from Mendeley\u2026',
          click: () => {
            const w = getWin()
            if (w && !w.isDestroyed()) w.webContents.send('menu:import-mendeley')
          }
        },
        { type: 'separator' },
        {
          label: 'Export JSON\u2026',
          accelerator: 'Cmd+E',
          click: () => {
            void runMenuAction(async () => {
              const w = getWin()
              const current = runtime
              if (!w || !current) return
              const result = await dialog.showSaveDialog(w, {
                title: 'Export JSON',
                defaultPath: `refora-export-${new Date().toISOString().slice(0, 10)}.json`,
                filters: [{ name: 'JSON files', extensions: ['json'] }]
              })
              if (result.canceled || !result.filePath) return
              writeExportFile(current.repos, result.filePath)
            }, (error) => reportMenuError('Export JSON', error))
          }
        },
        {
          label: 'Export BibTeX\u2026',
          accelerator: 'Cmd+Shift+B',
          click: () => {
            const w = getWin()
            if (w) {
              w.webContents.send('menu:export-bibtex')
            }
          }
        }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [] }
  ]
  return Menu.buildFromTemplate(template)
}

function createWindow(bounds?: { x?: number; y?: number; width?: number; height?: number } | null): BrowserWindow {
  const bw = new BrowserWindow({
    x: bounds?.x,
    y: bounds?.y,
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 800,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: IS_MAC ? '#00000000' : '#1e1e1e',
    show: false,
    title: 'Refora',
    ...(IS_MAC && {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 22, y: 22 },
      vibrancy: 'header',
      visualEffectState: 'followWindow'
    }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const sendWindowFocus = (focused: boolean) => {
    if (!bw.isDestroyed() && !bw.webContents.isDestroyed()) {
      bw.webContents.send(IpcChannel.EventWindowFocusChanged, focused)
    }
  }

  bw.webContents.on('did-finish-load', () => {
    bw.show()
    sendWindowFocus(bw.isFocused())
  })
  bw.on('focus', () => sendWindowFocus(true))
  bw.on('blur', () => sendWindowFocus(false))

  let saveBoundsTimeout: ReturnType<typeof setTimeout> | null = null
  const saveBounds = () => {
    if (!runtime || isQuitting || bw.isDestroyed()) return
    try {
      const bounds = bw.getBounds()
      runtime.repos.settings.set('windowBounds', {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized: bw.isMaximized()
      })
    } catch (e) {
      logger.warn(`saveBounds: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const debouncedSaveBounds = () => {
    if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout)
    saveBoundsTimeout = setTimeout(saveBounds, 500)
  }

  bw.on('resize', debouncedSaveBounds)
  bw.on('move', debouncedSaveBounds)
  bw.on('close', () => {
    if (saveBoundsTimeout) {
      clearTimeout(saveBoundsTimeout)
      saveBoundsTimeout = null
    }
    saveBounds()
  })

  bw.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        void shell.openExternal(url)
      }
    } catch {
      void url
    }
    return { action: 'deny' }
  })

  bw.webContents.on('will-navigate', (e) => {
    e.preventDefault()
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void bw.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void bw.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return bw
}

function destroyRuntime(target: Runtime): void {
  target.missingCheckAbort.abort()
  if (target.missingCheckInterval) {
    clearInterval(target.missingCheckInterval)
    target.missingCheckInterval = null
  }
  target.activated = false
  target.metadataService.destroy()
  target.watcher.destroy()
  target.importer.destroy()
  target.aiSummaryService.destroy()
  target.aiAgentService.destroy()
  target.pdfTextService.destroy()
  closeDatabase(target.db)
}

function teardownRuntime(): void {
  const current = runtime
  runtime = null
  if (current) destroyRuntime(current)
}

function buildRuntime(dbPath: string): Runtime {
  const db = openDatabase(dbPath)
  try {
    seedSettings(db, detectLanguage())
    const repos = createRepositories(db, { getSearchMode: () => getSearchMode(db) })
    const traceTtlMs = 30 * 24 * 60 * 60 * 1000
    const pruned = repos.agentTraces.deleteOlderThan(Date.now() - traceTtlMs)
    if (pruned > 0) logger.info(`startup:pruned ${pruned} trace steps older than 30 days`)
    const importer = createImporter(repos, () => win)
    const metadataService = createMetadataService(repos, () => win)
    const aiProvidersService = createAiProvidersService(repos)
    const pdfTextService = createPdfTextService(repos, () => win)
    const aiSummaryService = createAiSummaryService(
      repos,
      () => win,
      aiProvidersService,
      pdfTextService
    )
    const aiAgentService = createAiAgentService(repos, () => win, aiProvidersService, pdfTextService, aiSummaryService)
    const watcher = createWatcher({
      importFiles: (paths, isWatch) => importer.importFiles(paths, isWatch),
      getLibraryFolder: () => repos.settings.get<string>('libraryFolderPath', '')
    })

    importer.onComplete((result) => {
      if (result.errors.length > 0 && win && !win.isDestroyed()) {
        for (const err of result.errors) {
          logger.warn(`import:error ${err.path}: ${err.message}`)
          win.webContents.send('import:toast', err.message)
        }
      }
      for (const id of result.added) {
        metadataService.enqueue(id)
      }
    })

    return {
      db,
      repos,
      importer,
      metadataService,
      watcher,
      missingCheckInterval: null,
      missingCheckAbort: new AbortController(),
      activated: false,
      aiProvidersService,
      pdfTextService,
      aiSummaryService,
      aiAgentService
    }
  } catch (error) {
    closeDatabase(db)
    throw error
  }
}

function activateRuntime(target: Runtime, startLibraryWatcher = true): void {
  if (target.activated) return
  target.activated = true
  target.metadataService.resumeOnStartup()
  const signal = target.missingCheckAbort.signal

  setImmediate(() => {
    if (signal.aborted) return
    try {
      const enabledFolders = target.repos.watchFolders.getEnabled()
      target.watcher.startAll(enabledFolders)
      logger.info(`watch:started ${enabledFolders.length} watchers`)
      const libraryFolder = target.repos.settings.get<string>('libraryFolderPath', '')
      if (startLibraryWatcher && libraryFolder) target.watcher.startLibraryWatcher(libraryFolder)
    } catch (error) {
      logger.warn(`watch:start failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  const proxyUrl = target.repos.settings.get<string>('proxyUrl', '')
  if (proxyUrl) {
    if (validateProxyUrl(proxyUrl)) {
      void session.defaultSession.setProxy({ proxyRules: proxyUrl }).catch((e) => {
        logger.warn(`proxy:set failed: ${e instanceof Error ? e.message : String(e)}`)
      })
    } else {
      logger.warn(`proxy:invalid-url skipping setProxy: ${proxyUrl}`)
    }
  }

  setImmediate(() => {
    if (!signal.aborted) checkMissing(target.repos, win, signal)
  })

  target.missingCheckInterval = setInterval(() => {
    if (!isQuitting && !signal.aborted) checkMissing(target.repos, win, signal)
  }, 10 * 60 * 1000)
}

function resolveStartupDbPath(): string {
  const userDataDir = app.getPath('userData')
  const userDataDbPath = join(userDataDir, DB_FILE_NAME)

  const prefsLibrary = readLibraryFolderPath(userDataDir)
  if (prefsLibrary && dbExistsInLibraryFolder(prefsLibrary)) {
    logger.info(`db:startup using library db (prefs) at ${prefsLibrary}`)
    return dbPathForLibraryFolder(prefsLibrary)
  }
  if (prefsLibrary && existsSync(prefsLibrary)) {
    logger.info(`db:startup creating library db (prefs) at ${prefsLibrary}`)
    return dbPathForLibraryFolder(prefsLibrary)
  }
  if (prefsLibrary && !existsSync(prefsLibrary)) {
    logger.warn(`db:startup prefs library folder missing, clearing prefs: ${prefsLibrary}`)
    writeLibraryFolderPath(userDataDir, '')
  }

  try {
    if (existsSync(userDataDbPath)) {
      const db = openDatabase(userDataDbPath)
      let trimmed = ''
      try {
        const libraryFolder = getSetting(db, 'libraryFolderPath')
        trimmed = libraryFolder ? JSON.parse(libraryFolder) as string : ''
      } finally {
        closeDatabase(db)
      }
      if (trimmed && dbExistsInLibraryFolder(trimmed)) {
        logger.info(`db:startup migrating to library db at ${trimmed}`)
        writeLibraryFolderPath(userDataDir, trimmed)
        return dbPathForLibraryFolder(trimmed)
      }
      if (trimmed && existsSync(trimmed)) {
        logger.info(`db:startup migrating to new library db at ${trimmed}`)
        writeLibraryFolderPath(userDataDir, trimmed)
        return dbPathForLibraryFolder(trimmed)
      }
      if (trimmed && !existsSync(trimmed)) {
        logger.warn(`db:startup legacy library folder missing, falling back to bootstrap: ${trimmed}`)
      }
    }
  } catch (e) {
    logger.warn(`db:startup bootstrap read failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  return userDataDbPath
}

async function performLibrarySwitch(folder: string): Promise<LibrarySwitchResult> {
  const resolvedFolder = folder ? resolvePath(folder) : ''
  if (!resolvedFolder || !existsSync(resolvedFolder) || !statSync(resolvedFolder).isDirectory()) {
    throw new Error(`Invalid library folder: ${resolvedFolder}`)
  }
  const targetDbPath = dbPathForLibraryFolder(resolvedFolder)
  const dbExisted = dbExistsInLibraryFolder(resolvedFolder)
  logger.info(`library:switch folder=${resolvedFolder} dbExisted=${dbExisted}`)

  const nextRuntime = prepareReplacement(
    () => buildRuntime(targetDbPath),
    (candidate) => candidate.repos.settings.set('libraryFolderPath', resolvedFolder),
    destroyRuntime
  )
  const previousRuntime = runtime
  runtime = nextRuntime
  if (previousRuntime) destroyRuntime(previousRuntime)
  writeLibraryFolderPath(app.getPath('userData'), resolvedFolder)
  activateRuntime(nextRuntime, false)

  let scanned = 0
  let imported = 0
  let skipped = 0
  const errors: Array<{ path: string; message: string }> = []

  try {
    if (!dbExisted) {
      const pdfs = await findPdfsRecursively(resolvedFolder)
      scanned = pdfs.length
      logger.info(`library:scan found ${scanned} pdfs in ${resolvedFolder}`)
      if (scanned > 0 && win && !win.isDestroyed()) {
        emitLibraryScanning(win, { current: 0, total: scanned })
      }
      if (scanned > 0) {
        const importResult = await nextRuntime.importer.importFiles(pdfs, false)
        imported = importResult.added.length
        skipped = importResult.skipped.length
        errors.push(...importResult.errors)
      }
    }
  } finally {
    try {
      nextRuntime.watcher.startLibraryWatcher(resolvedFolder)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`watch:library start failed: ${message}`)
      errors.push({ path: resolvedFolder, message })
    }
  }

  const result: LibrarySwitchResult = {
    libraryFolderPath: resolvedFolder,
    dbExisted,
    scanned,
    imported,
    skipped,
    errors
  }
  if (win && !win.isDestroyed()) {
    emitLibrarySwitched(win, result)
  }
  return result
}

const switchLibraryFolder = createExclusiveTask(
  performLibrarySwitch,
  () => new RepoError('busy', 'Library switch already in progress')
)

void app.whenReady().then(() => {
  isDev = !app.isPackaged
  initLogger()
  logger.info(`app:ready (dev=${isDev})`)
  applyCsp()

  if (isDev) {
    const devIconPath = join(__dirname, '../../build/icon.png')
    if (existsSync(devIconPath)) {
      app.dock?.setIcon(nativeImage.createFromPath(devIconPath))
    }
  }

  const dbPath = resolveStartupDbPath()
  runtime = buildRuntime(dbPath)
  const r = runtime.repos
  const savedBounds = r.settings.get<{ x?: number; y?: number; width?: number; height?: number } | null>('windowBounds', null)
  win = createWindow(savedBounds)
  activateRuntime(runtime)

  Menu.setApplicationMenu(buildMenu())
  registerIpcHandlers({
    getWin: () => win,
    getRuntime: () => runtime,
    switchLibraryFolder
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      win = createWindow()
    }
  })
}).catch((e) => {
  logger.error(`startup failed: ${e instanceof Error ? e.message : String(e)}`)
  app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
  teardownRuntime()
  if (win) {
    win = null
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
