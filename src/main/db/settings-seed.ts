import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SqliteLike } from './migrations'

export const DEFAULT_LIBRARY_FOLDER = join(homedir(), 'Documents', 'ScholarNote Library')

export type SettingKey =
  | 'libraryFolderPath'
  | 'crossrefMailto'
  | 'theme'
  | 'sidebarCollapsed'
  | 'lastWatchScanAt'
  | 'language'
  | 'moveToLibraryOnCategorize'
  | 'proxyUrl'
  | 'windowBounds'
  | 'listColumnState'

export const SETTING_KEYS: readonly SettingKey[] = [
  'libraryFolderPath',
  'crossrefMailto',
  'theme',
  'sidebarCollapsed',
  'lastWatchScanAt',
  'language',
  'moveToLibraryOnCategorize',
  'proxyUrl',
  'windowBounds',
  'listColumnState'
]

function sqlLiteral(value: unknown): string {
  const json = JSON.stringify(value)
  return "'" + json.replace(/'/g, "''") + "'"
}

export function defaultSettings(language: 'zh' | 'en'): Array<[SettingKey, unknown]> {
  return [
    ['libraryFolderPath', DEFAULT_LIBRARY_FOLDER],
    ['crossrefMailto', ''],
    ['theme', 'dark'],
    ['sidebarCollapsed', '0'],
    ['lastWatchScanAt', 0],
    ['language', language],
    ['moveToLibraryOnCategorize', '1'],
    ['proxyUrl', ''],
    ['windowBounds', null],
    ['listColumnState', null]
  ]
}

export function seedDefaultSettings(db: SqliteLike, language: 'zh' | 'en'): void {
  const stmts = defaultSettings(language)
    .map(([key, value]) => `INSERT OR IGNORE INTO settings(key, value) VALUES ('${key}', ${sqlLiteral(value)});`)
    .join('\n')
  db.exec(stmts)
}
