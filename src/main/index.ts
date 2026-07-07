import { app, BrowserWindow, Menu, shell, session, dialog } from 'electron'
import { join } from 'node:path'
import { initLogger, logger } from './services/logger'
import { openDatabase, seedSettings, closeDatabase } from './db/connection'
import { createRepositories } from './db/repositories'
import { registerIpcHandlers } from './ipc/handlers'
import { createImporter } from './services/importer'
import { createMetadataService } from './services/metadata'
import { createWatcher } from './services/watcher'
import { checkMissing } from './services/files'
import { writeExportFile, importFromJsonFile } from './services/export'
import { emitImportProgress } from './ipc/events'
import type { Repositories } from './db/repositories'

let isDev = false
const IS_MAC = process.platform === 'darwin'

type DbConnection = ReturnType<typeof openDatabase>
let db: DbConnection | null = null
let win: BrowserWindow | null = null
let importer: ReturnType<typeof createImporter> | null = null
let metadataService: ReturnType<typeof createMetadataService> | null = null
let watcher: ReturnType<typeof createWatcher> | null = null
let missingCheckInterval: ReturnType<typeof setInterval> | null = null
let repos: Repositories | null = null
let isQuitting = false

function detectLanguage(): 'zh' | 'en' {
  try {
    const locale = app.getLocale().toLowerCase()
    return locale.startsWith('zh') ? 'zh' : 'en'
  } catch {
    return 'en'
  }
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
            if (!w || !importer) return
            const result = await dialog.showOpenDialog(w, {
              title: 'Add PDF Files',
              properties: ['openFile', 'multiSelections'],
              filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
            })
            if (result.canceled) return
            void importer.importFiles(result.filePaths, false)
          }
        },
        {
          label: 'Add Folder',
          click: async () => {
            const w = getWin()
            if (!w || !importer) return
            const result = await dialog.showOpenDialog(w, {
              title: 'Add Folder',
              properties: ['openDirectory']
            })
            if (result.canceled) return
            const { readdirSync, statSync } = await import('node:fs')
            const { join, resolve: resolvePath } = await import('node:path')
            const dir = result.filePaths[0]
            const findPdfs = (d: string): string[] => {
              const results: string[] = []
              try {
                for (const entry of readdirSync(d)) {
                  const full = join(d, entry)
                  try {
                    if (statSync(full).isDirectory()) results.push(...findPdfs(full))
                    else if (full.toLowerCase().endsWith('.pdf')) results.push(resolvePath(full))
                  } catch { continue }
                }
              } catch { return [] }
              return results
            }
            void importer.importFiles(findPdfs(dir), false)
          }
        },
        { type: 'separator' },
        {
          label: 'Import JSON\u2026',
          click: async () => {
            const w = getWin()
            if (!w || !repos) return
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
            const count = importFromJsonFile(repos, result.filePaths[0], mode)
            logger.info(`import:json ${count} documents`)
          }
        },
        { type: 'separator' },
        {
          label: 'Export JSON\u2026',
          accelerator: 'Cmd+E',
          click: async () => {
            const w = getWin()
            if (!w || !repos) return
            const result = await dialog.showSaveDialog(w, {
              title: 'Export JSON',
              defaultPath: `scholarnote-export-${new Date().toISOString().slice(0, 10)}.json`,
              filters: [{ name: 'JSON files', extensions: ['json'] }]
            })
            if (result.canceled || !result.filePath) return
            writeExportFile(repos, result.filePath)
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
    backgroundColor: '#1e1e1e',
    show: false,
    title: 'ScholarNote',
    ...(IS_MAC && {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 22, y: 22 }
    }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  bw.webContents.on('did-finish-load', () => bw.show())

  let saveBoundsTimeout: ReturnType<typeof setTimeout> | null = null
  const saveBounds = () => {
    if (!repos || isQuitting || bw.isDestroyed()) return
    try {
      const bounds = bw.getBounds()
      repos.settings.set('windowBounds', {
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
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void bw.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void bw.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return bw
}

void app.whenReady().then(() => {
  isDev = !app.isPackaged
  initLogger()
  logger.info(`app:ready (dev=${isDev})`)
  applyCsp()

  const dbPath = join(app.getPath('userData'), 'scholarnote.db')
  db = openDatabase(dbPath)
  seedSettings(db, detectLanguage())

  repos = createRepositories(db)
  const r = repos
  const savedBounds = r.settings.get<{ x?: number; y?: number; width?: number; height?: number } | null>('windowBounds', null)
  win = createWindow(savedBounds)
  importer = createImporter(r, () => win)
  metadataService = createMetadataService(r, () => win)
  watcher = createWatcher({
    importFiles: (paths, isWatch) => importer!.importFiles(paths, isWatch),
    getLibraryFolder: () => r.settings.get<string>('libraryFolderPath', '')
  })

  Menu.setApplicationMenu(buildMenu())
  registerIpcHandlers({ repos: r, win, getWin: () => win, importer, metadataService, watcher })

  importer.onComplete((result) => {
    if (result.errors.length > 0 && win && !win.isDestroyed()) {
      for (const err of result.errors) {
        logger.warn(`import:error ${err.path}: ${err.message}`)
        win.webContents.send('import:toast', err.message)
      }
    }
    for (const id of result.added) {
      metadataService?.enqueue(id)
    }
    if (result.added.length > 0 && win && !win.isDestroyed()) {
      emitImportProgress(win, { current: result.added.length, total: result.added.length })
    }
  })

  metadataService.resumeOnStartup()

  setImmediate(() => {
    if (watcher) {
      const enabledFolders = r.watchFolders.getEnabled()
      watcher.startAll(enabledFolders)
      logger.info(`watch:started ${enabledFolders.length} watchers`)
      const libraryFolder = r.settings.get<string>('libraryFolderPath', '')
      if (libraryFolder) watcher.startLibraryWatcher(libraryFolder)
    }
  })

  const proxyUrl = r.settings.get<string>('proxyUrl', '')
  if (proxyUrl) {
    session.defaultSession.setProxy({ proxyRules: proxyUrl })
  }

  setImmediate(() => {
    checkMissing(r, win)
  })

  missingCheckInterval = setInterval(() => {
    if (!isQuitting) checkMissing(r, win)
  }, 5 * 60 * 1000)

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
  if (missingCheckInterval) {
    clearInterval(missingCheckInterval)
    missingCheckInterval = null
  }
  if (metadataService) {
    metadataService.destroy()
    metadataService = null
  }
  if (watcher) {
    watcher.destroy()
    watcher = null
  }
  if (importer) {
    importer.destroy()
    importer = null
  }
  if (win) {
    win = null
  }
  closeDatabase()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
