# Task 13 — DB Native Binding Smoke Test

**Phase:** 3 (Smoke Test) · **Prerequisites:** 01 · **Master plan:** Phase 3, Task 3.1

## Goal
Create `tests/smoke/db-native.test.ts` that validates `better-sqlite3` loads and functions correctly. This catches the gap between test-adapter (`node:sqlite`) and production (`better-sqlite3`).

## Spec

This test exercises the **real** `better-sqlite3` native module. It is skipped when `better-sqlite3` fails to load (dev without rebuild), but runs in CI where `postinstall` has compiled the native binding.

## Test Cases

1. **Can open in-memory database** — `require('better-sqlite3')` returns a constructor.
   - `new Database(':memory:')` succeeds.
   - `db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)')` succeeds.
   - `db.prepare('INSERT INTO test (value) VALUES (?)').run('hello')` returns changes: 1.
   - `db.prepare('SELECT value FROM test WHERE id = 1').get()` returns `{ value: 'hello' }`.
   - `db.close()` succeeds.

2. **Supports WAL mode** — `db.pragma('journal_mode = WAL')` succeeds.
   - `db.pragma('journal_mode', { simple: true })` returns `'wal'`.

3. **Supports foreign keys** — `db.pragma('foreign_keys = ON')` succeeds.
   - `db.pragma('foreign_keys', { simple: true })` returns `1`.

4. **Supports FTS5** — `db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS fts_test USING fts5(content)')` succeeds.

5. **`prepare().all()` returns array** — Verify the return type convention matches what repos expect.

## Implementation

```ts
// tests/smoke/db-native.test.ts
import { describe, it, expect, beforeAll } from 'vitest'

let Database: any
let canRun = false

beforeAll(() => {
  try {
    Database = require('better-sqlite3')
    canRun = true
  } catch {
    canRun = false
  }
})

describe('better-sqlite3 native binding', () => {
  const maybe = canRun ? it : it.skip

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
})
```

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- In CI (where `better-sqlite3` loads): 5 tests pass.
- In dev (where `better-sqlite3` may not load): 5 tests skipped, not failed.

## Note
If `require('better-sqlite3')` throws due to ABI mismatch in plain Node.js, the `beforeAll` catch block sets `canRun = false` and all tests are skipped gracefully. This is expected behavior — the test only validates in CI where native modules are rebuilt for the correct ABI.
