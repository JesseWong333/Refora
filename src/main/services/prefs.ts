import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { logger } from './logger'

interface UserPrefs {
  libraryFolderPath?: string
}

function prefsPath(userDataDir: string): string {
  return join(userDataDir, 'refora-prefs.json')
}

export function readLibraryFolderPath(userDataDir: string): string {
  try {
    const p = prefsPath(userDataDir)
    if (!existsSync(p)) return ''
    const raw = readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw) as UserPrefs
    return parsed.libraryFolderPath ?? ''
  } catch (e) {
    logger.warn(`prefs:read failed: ${e instanceof Error ? e.message : String(e)}`)
    return ''
  }
}

export function writeLibraryFolderPath(userDataDir: string, folder: string): void {
  try {
    const p = prefsPath(userDataDir)
    const dir = join(p, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const prefs: UserPrefs = { libraryFolderPath: folder }
    writeFileSync(p, JSON.stringify(prefs, null, 2), 'utf-8')
  } catch (e) {
    logger.warn(`prefs:write failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}