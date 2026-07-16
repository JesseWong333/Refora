import { watch, type FSWatcher } from 'chokidar'
import { existsSync } from 'node:fs'
import { logger } from './logger'
import { isInsideLibrary } from './paths'
import type { WatchFolder } from '../../shared/ipc-types'

export interface WatcherDeps {
  importFiles: (paths: string[], isWatch: boolean) => Promise<unknown>
  getLibraryFolder: () => string
}

function watcherErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function createDebouncedImporter(deps: WatcherDeps) {
  let pending: string[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const DEBOUNCE_MS = 500

  function flush(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (pending.length === 0) return
    const batch = pending
    pending = []
    deps.importFiles(batch, true).catch((e) => {
      logger.error(`watch:import-failed: ${e instanceof Error ? e.message : String(e)}`)
    })
  }

  return {
    push(filePath: string): void {
      pending.push(filePath)
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, DEBOUNCE_MS)
    },
    cancel(): void {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      pending = []
    }
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

    const inst = watch(wf.path, {
      depth: 20,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
      ignored: (testPath: string) => {
        if (libraryFolder && testPath !== wf.path && isInsideLibrary(testPath, libraryFolder)) return true
        const base = testPath.split('/').pop() ?? testPath
        if (!base.includes('.')) return false
        return !base.toLowerCase().endsWith('.pdf')
      }
    })

    inst.on('add', (filePath: string) => {
      logger.info(`watch:add ${wf.path}: ${filePath}`)
      debouncedImport.push(filePath)
    })

    inst.on('error', (error: unknown) => {
      logger.error(`watch:error ${wf.path}: ${watcherErrorMessage(error)}`)
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
      depth: 20,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
      ignored: (testPath: string) => {
        if (testPath === folder) return false
        const base = testPath.split('/').pop() ?? testPath
        if (!base.includes('.')) return false
        return !base.toLowerCase().endsWith('.pdf')
      }
    })

    inst.on('add', (filePath: string) => {
      logger.info(`watch:library:add ${filePath}`)
      debouncedImport.push(filePath)
    })

    inst.on('error', (error: unknown) => {
      logger.error(`watch:library:error ${watcherErrorMessage(error)}`)
    })

    libraryWatcher = inst
    libraryWatchPath = folder
    logger.info(`watch:library:started ${folder}`)
  }

  function destroy(): void {
    stopAll()
    stopLibraryWatcher()
    debouncedImport.cancel()
  }

  return { start, stop, startAll, stopAll, startLibraryWatcher, stopLibraryWatcher, destroy }
}
