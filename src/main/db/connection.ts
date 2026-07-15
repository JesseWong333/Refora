import Database from 'better-sqlite3'
import { runMigrations, type SqliteLike } from './migrations'
import { seedDefaultSettings } from './settings-seed'
import { logger } from '../services/logger'

type BetterSqlite3Database = Database.Database

let activeSearchMode: 'trigram' | 'like' = 'trigram'
const searchModes = new WeakMap<BetterSqlite3Database, 'trigram' | 'like'>()

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
    },
    hasColumn: (table, column) =>
      db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(table, column) !== undefined,
    hasObject: (type, name) =>
      db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, name) !== undefined
  }
}

export function openDatabase(dbPath: string): BetterSqlite3Database {
  const db = new Database(dbPath)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA journal_mode = WAL')
    const result = runMigrations(adapt(db))
    activeSearchMode = result.searchMode
    searchModes.set(db, result.searchMode)
    logger.info(
      `db:opened path=${dbPath} from=v${result.from} to=v${result.to} search=${activeSearchMode}`
    )
    return db
  } catch (error) {
    if (db.open) db.close()
    throw error
  }
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

export function getSearchMode(db?: BetterSqlite3Database): 'trigram' | 'like' {
  return db ? searchModes.get(db) ?? activeSearchMode : activeSearchMode
}

export function closeDatabase(db: BetterSqlite3Database): void {
  searchModes.delete(db)
  if (db.open) {
    db.close()
  }
}
