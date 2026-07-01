import { randomUUID } from 'node:crypto'
import type { WatchFolder } from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'
import { RepoError } from './errors'

function mapWatchFolder(row: Record<string, unknown>): WatchFolder {
  return {
    id: row.id as string,
    path: row.path as string,
    enabled: row.enabled as number,
    addedAt: row.addedAt as number
  }
}

export function createWatchFoldersRepository(db: SqliteDb) {
  function list(): WatchFolder[] {
    const rows = db.prepare('SELECT * FROM watch_folders ORDER BY addedAt').all() as Record<
      string,
      unknown
    >[]
    return rows.map(mapWatchFolder)
  }

  function add(path: string): WatchFolder {
    const id = randomUUID()
    const addedAt = Date.now()
    db.prepare('INSERT INTO watch_folders (id, path, enabled, addedAt) VALUES (?, ?, 1, ?)').run(
      id,
      path,
      addedAt
    )
    const row = db.prepare('SELECT * FROM watch_folders WHERE id = ?').get(id) as Record<
      string,
      unknown
    >
    return mapWatchFolder(row)
  }

  function remove(id: string): void {
    const result = db.prepare('DELETE FROM watch_folders WHERE id = ?').run(id)
    if (result.changes === 0) throw new RepoError('not_found', `watch folder not found: ${id}`)
  }

  function toggle(id: string, enabled: boolean): void {
    const result = db.prepare('UPDATE watch_folders SET enabled = ? WHERE id = ?').run(
      enabled ? 1 : 0,
      id
    )
    if (result.changes === 0) throw new RepoError('not_found', `watch folder not found: ${id}`)
  }

  function getEnabled(): WatchFolder[] {
    const rows = db
      .prepare('SELECT * FROM watch_folders WHERE enabled = 1 ORDER BY addedAt')
      .all() as Record<string, unknown>[]
    return rows.map(mapWatchFolder)
  }

  return { list, add, remove, toggle, getEnabled }
}
