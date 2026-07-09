import { randomUUID } from 'node:crypto'
import type { Workspace } from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'
import { RepoError } from './errors'

function mapWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: row.id as string,
    name: row.name as string,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number
  }
}

export function createWorkspacesRepository(db: SqliteDb) {
  function list(): Workspace[] {
    const rows = db.prepare('SELECT * FROM workspaces ORDER BY updatedAt DESC').all() as Record<
      string,
      unknown
    >[]
    return rows.map(mapWorkspace)
  }

  function create(name: string): Workspace {
    const id = randomUUID()
    const now = Date.now()
    db.prepare(
      'INSERT INTO workspaces (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)'
    ).run(id, name, now, now)
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Record<
      string,
      unknown
    >
    return mapWorkspace(row)
  }

  function rename(id: string, name: string): void {
    const result = db.prepare('UPDATE workspaces SET name = ?, updatedAt = ? WHERE id = ?').run(
      name,
      Date.now(),
      id
    )
    if (result.changes === 0) throw new RepoError('not_found', `workspace not found: ${id}`)
  }

  function remove(id: string): void {
    const result = db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
    if (result.changes === 0) throw new RepoError('not_found', `workspace not found: ${id}`)
  }

  return { list, create, rename, delete: remove }
}
