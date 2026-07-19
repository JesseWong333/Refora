import { randomUUID } from 'node:crypto'
import type { Workspace, WorkspaceContentSearchResult } from '../../../shared/ipc-types'
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

  function searchContent(q: string, limit = 10): WorkspaceContentSearchResult[] {
    const trimmed = q.trim()
    if (!trimmed) return []
    const escaped = trimmed.replace(/[%_\\]/g, '\\$&')
    const like = `%${escaped}%`
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)))
    const rows = db
      .prepare(
        `SELECT n.id, n.workspaceId, w.name AS workspaceName, 'note' AS kind,
                n.title, n.contentMd, n.updatedAt AS matchedAt
         FROM workspace_notes n
         JOIN workspaces w ON w.id = n.workspaceId
         WHERE n.title LIKE ? ESCAPE '\\'
            OR n.contentMd LIKE ? ESCAPE '\\'
         UNION ALL
         SELECT r.id, r.workspaceId, w.name AS workspaceName, 'report' AS kind,
                r.title, r.contentMd, r.createdAt AS matchedAt
         FROM ai_reports r
         JOIN workspaces w ON w.id = r.workspaceId
         WHERE r.title LIKE ? ESCAPE '\\'
            OR r.contentMd LIKE ? ESCAPE '\\'
         ORDER BY matchedAt DESC, 1
         LIMIT ?`
      )
      .all(like, like, like, like, safeLimit) as Record<string, unknown>[]
    const normalized = trimmed.toLocaleLowerCase()
    return rows.map((row) => {
      const content = (row.contentMd as string).trim()
      const matchIndex = content.toLocaleLowerCase().indexOf(normalized)
      const start = matchIndex < 0 ? 0 : Math.max(0, matchIndex - 80)
      const snippet = content.slice(start, start + 240).replace(/\s+/g, ' ').trim()
      return {
        id: row.id as string,
        workspaceId: row.workspaceId as string,
        workspaceName: row.workspaceName as string,
        kind: row.kind as WorkspaceContentSearchResult['kind'],
        title: row.title as string,
        snippet: snippet || (row.title as string),
        matchedAt: row.matchedAt as number
      }
    })
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

  return { list, searchContent, create, rename, delete: remove }
}
