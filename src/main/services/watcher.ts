import { watch, type FSWatcher } from 'chokidar'
import { existsSync } from 'node:fs'
import { logger } from './logger'
import type { WatchFolder } from '../../shared/ipc-types'

export interface WatcherDeps {
  importFiles: (paths: string[], isWatch: boolean) => Promise<unknown>
  getLibraryFolder: () => string
}

function createDebouncedImporter(deps: WatcherDeps) {
  let pending: string[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const DEBOUNCE_MS = 500

  return (filePath: string) => {
    pending.push(filePath)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const batch = pending
      pending = []
      void deps.importFiles(batch, true)
    }, DEBOUNCE_MS)
  }
}

export function createWatcher(deps: WatcherDeps) {
  const watchers = new Map<string, FSWatcher>()
  let libraryWatcher: FSWatcher | null = null
  let libraryWatchPath = ''
  const debouncedImport = createDebouncedImporter(deps)

  function start(wf: WatchFolder): void {
    if (watchers.has(wf.id)) return
    if (!existsSync(wf.path)) {
      logger.warn(`watch:skip nonexistent: ${wf.path}`)
      return
    }

    const libraryFolder = deps.getLibraryFolder()
    const libraryPrefix = libraryFolder ? libraryFolder + '/' : ''

    const inst = watch(wf.path, {
      depth: undefined,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
      ignored: (testPath: string) => {
        if (libraryFolder && testPath.startsWith(libraryPrefix)) return true
        if (!testPath.toLowerCase().endsWith('.pdf')) return true
        return false
      }
    })

    inst.on('add', (filePath: string) => {
      logger.info(`watch:add ${wf.path}: ${filePath}`)
      debouncedImport(filePath)
    })

    inst.on('error', (err: Error) => {
      logger.error(`watch:error ${wf.path}: ${err.message}`)
    })

    watchers.set(wf.id, inst)
    logger.info(`watch:started ${wf.path}`)
  }

  function stop(id: string): void {
    const inst = watchers.get(id)
    if (inst) {
      void inst.close()
      watchers.delete(id)
      logger.info(`watch:stopped id=${id}`)
    }
  }

  function startAll(enabledFolders: WatchFolder[]): void {
    for (const wf of enabledFolders) {
      start(wf)
    }
  }

  function stopAll(): void {
    for (const id of watchers.keys()) {
      stop(id)
    }
  }

  function stopLibraryWatcher(): void {
    if (libraryWatcher) {
      void libraryWatcher.close()
      libraryWatcher = null
      libraryWatchPath = ''
      logger.info('watch:stopped library')
    }
  }

  function startLibraryWatcher(folder: string): void {
    if (libraryWatchPath === folder && libraryWatcher) return
    stopLibraryWatcher()
    if (!folder || !existsSync(folder)) {
      logger.warn(`watch:library skip nonexistent: ${folder}`)
      return
    }

    const inst = watch(folder, {
      depth: undefined,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
      ignored: (testPath: string) => !testPath.toLowerCase().endsWith('.pdf')
    })

    inst.on('add', (filePath: string) => {
      logger.info(`watch:library:add ${filePath}`)
      debouncedImport(filePath)
    })

    inst.on('error', (err: Error) => {
      logger.error(`watch:library:error ${err.message}`)
    })

    libraryWatcher = inst
    libraryWatchPath = folder
    logger.info(`watch:library:started ${folder}`)
  }

  function destroy(): void {
    stopAll()
    stopLibraryWatcher()
  }

  return { start, stop, startAll, stopAll, startLibraryWatcher, stopLibraryWatcher, destroy }
}
