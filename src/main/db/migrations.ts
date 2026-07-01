import schemaSql from './schema.sql?raw'

export interface SqliteLike {
  exec(sql: string): void
  getUserVersion(): number
  setUserVersion(version: number): void
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

export function loadMigrationFiles(): MigrationFile[] {
  return Object.entries(migrationModules)
    .map(([filepath, sql]) => {
      const match = filepath.match(/(\d+)_/)
      return { version: match ? parseInt(match[1], 10) : 0, sql }
    })
    .filter((m): m is MigrationFile => m.version > 0)
    .sort((a, b) => a.version - b.version)
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

export function runMigrations(db: SqliteLike): MigrationResult {
  const from = db.getUserVersion()
  const useTrigram = trigramAvailable(db)

  if (from < 1) {
    db.exec(schemaForTokenizer(useTrigram))
    db.setUserVersion(1)
  }

  const baseline = Math.max(from, 1)
  for (const migration of loadMigrationFiles().filter((m) => m.version > baseline)) {
    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      db.setUserVersion(migration.version)
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
