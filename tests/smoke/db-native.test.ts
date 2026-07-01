import { describe, it, expect, beforeAll } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Database: any
let canRun = false

beforeAll(() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Database = require('better-sqlite3')
    canRun = true
  } catch {
    canRun = false
  }
})

describe('better-sqlite3 native binding', () => {
  const m = canRun ? it : it.skip
  const maybe = m

  maybe('can open an in-memory database', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)')
    const info = db.prepare('INSERT INTO test (value) VALUES (?)').run('hello')
    expect(info.changes).toBe(1)
    const row = db.prepare('SELECT value FROM test WHERE id = 1').get()
    expect(row.value).toBe('hello')
    db.close()
  })

  maybe('supports WAL mode', () => {
    const db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    const mode = db.pragma('journal_mode', { simple: true })
    expect(mode).toBe('wal')
    db.close()
  })

  maybe('supports foreign keys', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    const fk = db.pragma('foreign_keys', { simple: true })
    expect(fk).toBe(1)
    db.close()
  })

  maybe('supports FTS5', () => {
    const db = new Database(':memory:')
    expect(() => db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS fts_test USING fts5(content)')).not.toThrow()
    db.close()
  })

  maybe('prepare().all() returns array', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)')
    db.prepare('INSERT INTO items (name) VALUES (?)').run('a')
    db.prepare('INSERT INTO items (name) VALUES (?)').run('b')
    const rows = db.prepare('SELECT name FROM items ORDER BY id').all()
    expect(Array.isArray(rows)).toBe(true)
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe('a')
    expect(rows[1].name).toBe('b')
    db.close()
  })
})
