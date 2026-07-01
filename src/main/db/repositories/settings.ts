import type { ListColumnState, WindowBounds } from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'
import { DEFAULT_LIBRARY_FOLDER } from '../settings-seed'

export interface BootstrapSettings {
  language: 'zh' | 'en'
  windowBounds: WindowBounds | null
  listColumnState: ListColumnState | null
  sidebarCollapsed: boolean
  libraryFolderPath: string
  proxyUrl: string
}

export function createSettingsRepository(db: SqliteDb) {
  function get<T>(key: string, defaultValue: T): T {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    if (!row) return defaultValue
    try {
      return JSON.parse(row.value) as T
    } catch {
      return defaultValue
    }
  }

  function set(key: string, value: unknown): void {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      key,
      JSON.stringify(value)
    )
  }

  function getBootstrapSettings(): BootstrapSettings {
    return {
      language: get<'zh' | 'en'>('language', 'en'),
      windowBounds: get<WindowBounds | null>('windowBounds', null),
      listColumnState: get<ListColumnState | null>('listColumnState', null),
      sidebarCollapsed: get<string>('sidebarCollapsed', '0') === '1',
      libraryFolderPath: get<string>('libraryFolderPath', DEFAULT_LIBRARY_FOLDER),
      proxyUrl: get<string>('proxyUrl', '')
    }
  }

  return { get, set, getBootstrapSettings }
}
