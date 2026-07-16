import type { SqliteLike } from './migrations'

export const DEFAULT_LIBRARY_FOLDER = ''

export type SettingKey =
  | 'libraryFolderPath'
  | 'crossrefMailto'
  | 'theme'
  | 'sidebarCollapsed'
  | 'lastWatchScanAt'
  | 'language'
  | 'proxyUrl'
  | 'windowBounds'
  | 'listColumnState'
  | 'activeProviderId'
  | 'chatRecentModels'
  | 'chatSelectedProviderId'
  | 'chatSelectedModel'
  | 'chatSelectedVariant'
  | 'chatReasoningEffort'
  | 'chatDeepThinking'
  | 'workspaceChatHeight'
  | 'sidebarWidth'
  | 'detailWidth'
  | 'workspaceWidth'

export const SETTING_KEYS: readonly SettingKey[] = [
  'libraryFolderPath',
  'crossrefMailto',
  'theme',
  'sidebarCollapsed',
  'lastWatchScanAt',
  'language',
  'proxyUrl',
  'windowBounds',
  'listColumnState',
  'activeProviderId',
  'chatRecentModels',
  'chatSelectedProviderId',
  'chatSelectedModel',
  'chatSelectedVariant',
  'chatReasoningEffort',
  'chatDeepThinking',
  'workspaceChatHeight',
  'sidebarWidth',
  'detailWidth',
  'workspaceWidth'
]

function sqlLiteral(value: unknown): string {
  const json = JSON.stringify(value)
  return "'" + json.replace(/'/g, "''") + "'"
}

export function defaultSettings(language: 'zh' | 'en'): Array<[SettingKey, unknown]> {
  return [
    ['libraryFolderPath', ''],
    ['crossrefMailto', ''],
    ['theme', 'dark'],
    ['sidebarCollapsed', '0'],
    ['lastWatchScanAt', 0],
    ['language', language],
    ['proxyUrl', ''],
    ['windowBounds', null],
    ['listColumnState', null],
    ['activeProviderId', ''],
    ['chatRecentModels', '[]'],
    ['chatSelectedProviderId', ''],
    ['chatSelectedModel', ''],
    ['chatSelectedVariant', ''],
    ['chatReasoningEffort', ''],
    ['chatDeepThinking', false],
    ['workspaceChatHeight', 280],
    ['sidebarWidth', 224],
    ['detailWidth', 384],
    ['workspaceWidth', 480]
  ]
}

export function seedDefaultSettings(db: SqliteLike, language: 'zh' | 'en'): void {
  const stmts = defaultSettings(language)
    .map(([key, value]) => `INSERT OR IGNORE INTO settings(key, value) VALUES ('${key}', ${sqlLiteral(value)});`)
    .join('\n')
  db.exec(stmts)
}
