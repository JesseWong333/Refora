import schemaSql from './schema.sql?raw'

export interface SqliteLike {
  exec(sql: string): void
  getUserVersion(): number
  setUserVersion(version: number): void
  hasColumn?(table: string, column: string): boolean
  hasObject?(type: 'table' | 'index', name: string): boolean
}

export interface MigrationResult {
  from: number
  to: number
  trigram: boolean
  searchMode: 'trigram' | 'like'
}

export interface MigrationFile {
  version: number
  sql: string
}

const FTS_COLUMNS = ['title', 'authors', 'venue', 'year', 'keywords', 'abstract', 'url', 'note', 'fileName'] as const

const migrationModules = import.meta.glob('./migrations/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default'
}) as Record<string, string>

let cachedMigrations: MigrationFile[] | null = null

export function loadMigrationFiles(): MigrationFile[] {
  if (cachedMigrations) {
    return cachedMigrations
  }
  cachedMigrations = Object.entries(migrationModules)
    .map(([filepath, sql]) => {
      const match = filepath.match(/(\d+)_/)
      return { version: match ? parseInt(match[1], 10) : 0, sql }
    })
    .filter((m): m is MigrationFile => m.version > 0)
    .sort((a, b) => a.version - b.version)
  return cachedMigrations
}

export function trigramAvailable(db: SqliteLike): boolean {
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS _trigram_probe USING fts5(x, tokenize='trigram')")
    db.exec('DROP TABLE IF EXISTS _trigram_probe')
    return true
  } catch {
    return false
  }
}

function schemaForTokenizer(useTrigram: boolean): string {
  return useTrigram ? schemaSql : schemaSql.replace(/tokenize='trigram'/g, "tokenize='unicode61'")
}

function migrationSchemaPresent(db: SqliteLike, version: number): boolean {
  if (!db.hasColumn || !db.hasObject) return version <= db.getUserVersion()
  const hasColumns = (table: string, columns: string[]) =>
    columns.every((column) => db.hasColumn?.(table, column) === true)
  const hasObjects = (objects: Array<['table' | 'index', string]>) =>
    objects.every(([type, name]) => db.hasObject?.(type, name) === true)

  if (version === 12) return hasColumns('documents', ['affiliations'])
  if (version === 13) {
    return hasColumns('ai_providers', [
      'presetId',
      'apiProtocol',
      'reasoningControl',
      'reasoningEffort'
    ])
  }
  if (version === 14) {
    return hasColumns('workspace_items', ['noteId', 'width', 'height']) &&
      hasObjects([
        ['table', 'workspace_notes'],
        ['index', 'uq_workspace_items_document'],
        ['index', 'uq_workspace_items_report'],
        ['index', 'uq_workspace_items_note']
      ])
  }
  if (version === 15) {
    return hasColumns('workspace_items', ['x', 'y', 'zIndex']) &&
      hasObjects([
        ['table', 'workspace_canvas_state'],
        ['index', 'idx_workspace_items_canvas']
      ])
  }
  if (version === 16) return hasColumns('workspace_notes', ['noteType'])
  if (version === 17) return hasColumns('ai_providers', ['modelsJson'])
  if (version === 18) {
    return hasObjects([
      ['table', 'workspace_connections'],
      ['index', 'idx_workspace_connections_workspace']
    ])
  }
  return version <= db.getUserVersion()
}

export function runMigrations(db: SqliteLike): MigrationResult {
  const from = db.getUserVersion()
  const useTrigram = trigramAvailable(db)

  if (from < 1) {
    db.exec(schemaForTokenizer(useTrigram))
    db.setUserVersion(1)
  }

  for (const migration of loadMigrationFiles()) {
    const currentVersion = db.getUserVersion()
    if (migration.version < 12 && migration.version <= currentVersion) continue
    if (migration.version >= 12 && migrationSchemaPresent(db, migration.version)) {
      if (currentVersion < migration.version) db.setUserVersion(migration.version)
      continue
    }
    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      db.setUserVersion(Math.max(currentVersion, migration.version))
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  const to = db.getUserVersion()
  return { from, to, trigram: useTrigram, searchMode: useTrigram ? 'trigram' : 'like' }
}

export function ftsColumns(): readonly string[] {
  return FTS_COLUMNS
}
