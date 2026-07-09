import { randomUUID } from 'node:crypto'
import type { WorkspaceItem, WorkspaceItemKind } from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'
import { RepoError } from './errors'

function mapWorkspaceItem(row: Record<string, unknown>): WorkspaceItem {
  return {
    id: row.id as string,
    workspaceId: row.workspaceId as string,
    kind: row.kind as WorkspaceItemKind,
    docId: (row.docId as string | null) ?? null,
    reportId: (row.reportId as string | null) ?? null,
    sortOrder: row.sortOrder as number,
    addedAt: row.addedAt as number
  }
}

export function createWorkspaceItemsRepository(db: SqliteDb) {
  function list(workspaceId: string): WorkspaceItem[] {
    const rows = db
      .prepare('SELECT * FROM workspace_items WHERE workspaceId = ? ORDER BY sortOrder')
      .all(workspaceId) as Record<string, unknown>[]
    return rows.map(mapWorkspaceItem)
  }

  function add(workspaceId: string, kind: WorkspaceItemKind, ids: string[]): WorkspaceItem[] {
    if (ids.length === 0) return []
    const maxRow = db
      .prepare('SELECT MAX(sortOrder) AS m FROM workspace_items WHERE workspaceId = ?')
      .get(workspaceId) as { m: number | null } | undefined
    let next = (maxRow?.m ?? -1) + 1
    const now = Date.now()
    const stmt = db.prepare(
      'INSERT INTO workspace_items (id, workspaceId, kind, docId, reportId, sortOrder, addedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    const createdIds: string[] = []
    for (const id of ids) {
      const itemId = randomUUID()
      const docId = kind === 'document' ? id : null
      const reportId = kind === 'report' ? id : null
      stmt.run(itemId, workspaceId, kind, docId, reportId, next, now)
      createdIds.push(itemId)
      next += 1
    }
    const placeholders = createdIds.map(() => '?').join(', ')
    const rows = db
      .prepare(`SELECT * FROM workspace_items WHERE id IN (${placeholders}) ORDER BY sortOrder`)
      .all(...createdIds) as Record<string, unknown>[]
    return rows.map(mapWorkspaceItem)
  }

  function remove(id: string): void {
    const result = db.prepare('DELETE FROM workspace_items WHERE id = ?').run(id)
    if (result.changes === 0) throw new RepoError('not_found', `workspace item not found: ${id}`)
  }

  function reorder(workspaceId: string, orderedIds: string[]): void {
    const stmt = db.prepare(
      'UPDATE workspace_items SET sortOrder = ? WHERE id = ? AND workspaceId = ?'
    )
    for (let i = 0; i < orderedIds.length; i++) {
      stmt.run(i, orderedIds[i], workspaceId)
    }
  }

  function removeByDocId(docId: string): void {
    db.prepare('DELETE FROM workspace_items WHERE docId = ?').run(docId)
  }

  return { list, add, remove, reorder, removeByDocId }
}
