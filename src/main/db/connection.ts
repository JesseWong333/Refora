import Database from 'better-sqlite3'
import { runMigrations, type SqliteLike } from './migrations'
import { seedDefaultSettings } from './settings-seed'
import { logger } from '../services/logger'

type BetterSqlite3Database = Database.Database

let activeSearchMode: 'trigram' | 'like' = 'trigram'

function adapt(db: BetterSqlite3Database): SqliteLike {
  return {
    exec: (sql) => {
      db.exec(sql)
    },
    getUserVersion: () => {
      const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
      return row?.user_version ?? 0
    },
    setUserVersion: (version) => {
      db.exec(`PRAGMA user_version = ${version}`)
    }
  }
}

export function openDatabase(dbPath: string): BetterSqlite3Database {
  const db = new Database(dbPath)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')
  const result = runMigrations(adapt(db))
  activeSearchMode = result.searchMode
  logger.info(
    `db:opened path=${dbPath} from=v${result.from} to=v${result.to} search=${activeSearchMode}`
  )
  return db
}

export function seedSettings(db: BetterSqlite3Database, language: 'zh' | 'en'): void {
  seedDefaultSettings(adapt(db), language)
}

export function getSetting(db: BetterSqlite3Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function getSearchMode(): 'trigram' | 'like' {
  return activeSearchMode
}

export function closeDatabase(db: BetterSqlite3Database): void {
  if (db.open) {
    db.close()
  }
}
