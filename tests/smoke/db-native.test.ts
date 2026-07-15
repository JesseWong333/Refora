import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface NativeStatement {
  run(...params: unknown[]): { changes: number }
  get(...params: unknown[]): Record<string, unknown>
  all(...params: unknown[]): Record<string, unknown>[]
}

interface NativeDatabase {
  exec(sql: string): void
  pragma(sql: string, options?: { simple?: boolean }): unknown
  prepare(sql: string): NativeStatement
  close(): void
}

type NativeDatabaseConstructor = new (location: string) => NativeDatabase

const nodeRequire = createRequire(import.meta.url)
let Database: NativeDatabaseConstructor | null = null
try {
  const candidate = nodeRequire('better-sqlite3') as NativeDatabaseConstructor
  const probe = new candidate(':memory:')
  probe.close()
  Database = candidate
} catch {
  Database = null
}

const NativeDatabase = Database as NativeDatabaseConstructor
const nativeDescribe = Database ? describe : describe.skip

nativeDescribe('better-sqlite3 native binding', () => {
  const maybe = it

  maybe('can open an in-memory database', () => {
    const db = new NativeDatabase(':memory:')
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)')
    const info = db.prepare('INSERT INTO test (value) VALUES (?)').run('hello')
    expect(info.changes).toBe(1)
    const row = db.prepare('SELECT value FROM test WHERE id = 1').get()
    expect(row.value).toBe('hello')
    db.close()
  })

  maybe('supports WAL mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'refora-db-native-'))
    const db = new NativeDatabase(join(dir, 'test.db'))
    try {
      db.pragma('journal_mode = WAL')
      const mode = db.pragma('journal_mode', { simple: true })
      expect(mode).toBe('wal')
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  maybe('supports foreign keys', () => {
    const db = new NativeDatabase(':memory:')
    db.pragma('foreign_keys = ON')
    const fk = db.pragma('foreign_keys', { simple: true })
    expect(fk).toBe(1)
    db.close()
  })

  maybe('supports FTS5', () => {
    const db = new NativeDatabase(':memory:')
    expect(() => db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS fts_test USING fts5(content)')).not.toThrow()
    db.close()
  })

  maybe('prepare().all() returns array', () => {
    const db = new NativeDatabase(':memory:')
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
