import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeDatabase,
  getSearchMode,
  getSetting,
  openDatabase,
  seedSettings
} from '../../src/main/db/connection'

interface FakeStatement {
  get(...params: unknown[]): Record<string, unknown> | undefined
}

interface FakeDatabase {
  path: string
  open: boolean
  exec: ReturnType<typeof vi.fn>
  prepare: ReturnType<typeof vi.fn<(sql: string) => FakeStatement>>
  close: ReturnType<typeof vi.fn>
}

const state = vi.hoisted(() => ({
  instances: [] as unknown[],
  userVersion: 0,
  columnExists: false,
  objectExists: false,
  settings: {} as Record<string, string>
}))

const mocks = vi.hoisted(() => ({
  runMigrations: vi.fn(),
  seedDefaultSettings: vi.fn(),
  info: vi.fn()
}))

vi.mock('better-sqlite3', () => ({
  default: class {
    path: string
    open = true
    exec = vi.fn((sql: string) => {
      const match = sql.match(/^PRAGMA user_version = (\d+)$/)
      if (match) state.userVersion = Number(match[1])
    })
    prepare = vi.fn((sql: string) => ({
      get: (...params: unknown[]) => {
        if (sql === 'PRAGMA user_version') return { user_version: state.userVersion }
        if (sql.includes('pragma_table_info')) return state.columnExists ? { value: 1 } : undefined
        if (sql.includes('sqlite_master')) return state.objectExists ? { value: 1 } : undefined
        if (sql.includes('SELECT value FROM settings')) {
          const key = params[0] as string
          return key in state.settings ? { value: state.settings[key] } : undefined
        }
        return undefined
      }
    }))
    close = vi.fn(() => {
      this.open = false
    })

    constructor(path: string) {
      this.path = path
      state.instances.push(this)
    }
  }
}))

vi.mock('../../src/main/db/migrations', () => ({
  runMigrations: mocks.runMigrations
}))

vi.mock('../../src/main/db/settings-seed', () => ({
  seedDefaultSettings: mocks.seedDefaultSettings
}))

vi.mock('../../src/main/services/logger', () => ({
  logger: { info: mocks.info }
}))

describe('database connection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.instances.length = 0
    state.userVersion = 4
    state.columnExists = true
    state.objectExists = false
    state.settings = { language: '"en"' }
    mocks.runMigrations.mockReturnValue({
      from: 4,
      to: 16,
      trigram: false,
      searchMode: 'like'
    })
  })

  it('opens SQLite with required pragmas, migrations, and search mode logging', () => {
    mocks.runMigrations.mockImplementation((db) => {
      expect(db.getUserVersion()).toBe(4)
      expect(db.hasColumn?.('documents', 'title')).toBe(true)
      expect(db.hasObject?.('table', 'documents')).toBe(false)
      db.setUserVersion(5)
      db.exec('MIGRATION SQL')
      return { from: 4, to: 16, trigram: false, searchMode: 'like' }
    })

    const db = openDatabase('/tmp/refora.db')
    const fake = db as unknown as FakeDatabase

    expect(fake.path).toBe('/tmp/refora.db')
    expect(fake.exec.mock.calls.map(([sql]) => sql)).toEqual([
      'PRAGMA foreign_keys = ON',
      'PRAGMA journal_mode = WAL',
      'PRAGMA user_version = 5',
      'MIGRATION SQL'
    ])
    expect(getSearchMode()).toBe('like')
    expect(mocks.info).toHaveBeenCalledWith(
      'db:opened path=/tmp/refora.db from=v4 to=v16 search=like'
    )
  })

  it('adapts the database for settings seeding and reads raw setting values', () => {
    const db = openDatabase('/tmp/refora.db')
    seedSettings(db, 'zh')

    expect(mocks.seedDefaultSettings).toHaveBeenCalledWith(expect.any(Object), 'zh')
    expect(getSetting(db, 'language')).toBe('"en"')
    expect(getSetting(db, 'missing')).toBeNull()
  })

  it('closes only open database handles', () => {
    const db = openDatabase('/tmp/refora.db')
    const fake = db as unknown as FakeDatabase

    closeDatabase(db)
    closeDatabase(db)

    expect(fake.close).toHaveBeenCalledOnce()
    expect(fake.open).toBe(false)
  })
})
