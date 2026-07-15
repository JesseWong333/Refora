import { randomUUID } from 'node:crypto'
import {
  WORKSPACE_CARD_MAX_HEIGHT,
  WORKSPACE_CARD_MAX_WIDTH,
  WORKSPACE_CARD_MIN_HEIGHT,
  WORKSPACE_CARD_MIN_WIDTH,
  type WorkspaceItem,
  type WorkspaceItemKind,
  type WorkspaceItemPlacement
} from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'
import { RepoError } from './errors'

function mapWorkspaceItem(row: Record<string, unknown>): WorkspaceItem {
  return {
    id: row.id as string,
    workspaceId: row.workspaceId as string,
    kind: row.kind as WorkspaceItemKind,
    docId: (row.docId as string | null) ?? null,
    reportId: (row.reportId as string | null) ?? null,
    noteId: (row.noteId as string | null) ?? null,
    sortOrder: row.sortOrder as number,
    width: row.width as number,
    height: row.height as number,
    x: row.x as number,
    y: row.y as number,
    zIndex: row.zIndex as number,
    addedAt: row.addedAt as number
  }
}

export function createWorkspaceItemsRepository(db: SqliteDb) {
  function list(workspaceId: string): WorkspaceItem[] {
    const rows = db
      .prepare('SELECT * FROM workspace_items WHERE workspaceId = ? ORDER BY zIndex, addedAt, id')
      .all(workspaceId) as Record<string, unknown>[]
    return rows.map(mapWorkspaceItem)
  }

  function add(
    workspaceId: string,
    kind: WorkspaceItemKind,
    ids: string[],
    placement?: WorkspaceItemPlacement
  ): WorkspaceItem[] {
    const uniqueIds = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))]
    if (uniqueIds.length === 0) return []
    if (kind !== 'document' && kind !== 'report' && kind !== 'note') {
      throw new RepoError('invalid_kind', `unsupported workspace item kind: ${String(kind)}`)
    }
    const workspace = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId)
    if (!workspace) throw new RepoError('not_found', `workspace not found: ${workspaceId}`)
    for (const id of uniqueIds) {
      const table = kind === 'document' ? 'documents' : kind === 'report' ? 'ai_reports' : 'workspace_notes'
      const row = kind === 'document'
        ? db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)
        : db.prepare(`SELECT id FROM ${table} WHERE id = ? AND workspaceId = ?`).get(id, workspaceId)
      if (!row) throw new RepoError('not_found', `${kind} not found in workspace: ${id}`)
    }
    if (placement && (!Number.isFinite(placement.x) || !Number.isFinite(placement.y))) {
      throw new RepoError('invalid_position', 'workspace card position must be finite')
    }
    const maxRow = db
      .prepare('SELECT MAX(sortOrder) AS sortOrder, MAX(zIndex) AS zIndex FROM workspace_items WHERE workspaceId = ?')
      .get(workspaceId) as { sortOrder: number | null; zIndex: number | null } | undefined
    let next = (maxRow?.sortOrder ?? -1) + 1
    let nextZIndex = (maxRow?.zIndex ?? -1) + 1
    const now = Date.now()
    const stmt = db.prepare(
      `INSERT INTO workspace_items
       (id, workspaceId, kind, docId, reportId, noteId, sortOrder, x, y, zIndex, addedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const existingStmt = db.prepare(
      `SELECT id FROM workspace_items
       WHERE workspaceId = ? AND kind = ?
         AND ((? = 'document' AND docId = ?) OR (? = 'report' AND reportId = ?) OR (? = 'note' AND noteId = ?))`
    )
    const createdIds: string[] = []
    let createdCount = 0
    for (const id of uniqueIds) {
      const docId = kind === 'document' ? id : null
      const reportId = kind === 'report' ? id : null
      const noteId = kind === 'note' ? id : null
      const existing = existingStmt.get(workspaceId, kind, kind, id, kind, id, kind, id) as
        | { id: string }
        | undefined
      if (existing) {
        createdIds.push(existing.id)
        continue
      }
      const itemId = randomUUID()
      const x = placement ? placement.x + (createdCount % 3) * 28 : (next % 4) * 332
      const y = placement ? placement.y + Math.floor(createdCount / 3) * 28 : Math.floor(next / 4) * 232
      stmt.run(itemId, workspaceId, kind, docId, reportId, noteId, next, x, y, nextZIndex, now)
      createdIds.push(itemId)
      next += 1
      nextZIndex += 1
      createdCount += 1
    }
    touchWorkspace(workspaceId)
    const placeholders = createdIds.map(() => '?').join(', ')
    const rows = db
      .prepare(`SELECT * FROM workspace_items WHERE id IN (${placeholders}) ORDER BY sortOrder`)
      .all(...createdIds) as Record<string, unknown>[]
    return rows.map(mapWorkspaceItem)
  }

  function remove(id: string): void {
    const item = db.prepare('SELECT workspaceId FROM workspace_items WHERE id = ?').get(id) as
      | { workspaceId: string }
      | undefined
    if (!item) throw new RepoError('not_found', `workspace item not found: ${id}`)
    const result = db.prepare('DELETE FROM workspace_items WHERE id = ?').run(id)
    if (result.changes === 0) throw new RepoError('not_found', `workspace item not found: ${id}`)
    touchWorkspace(item.workspaceId)
  }

  function reorder(workspaceId: string, orderedIds: string[]): WorkspaceItem[] {
    const workspace = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId)
    if (!workspace) throw new RepoError('not_found', `workspace not found: ${workspaceId}`)
    const current = db
      .prepare('SELECT id FROM workspace_items WHERE workspaceId = ? ORDER BY sortOrder')
      .all(workspaceId) as Array<{ id: string }>
    const currentIds = new Set(current.map((item) => item.id))
    if (
      orderedIds.length !== current.length ||
      new Set(orderedIds).size !== orderedIds.length ||
      orderedIds.some((id) => !currentIds.has(id))
    ) {
      throw new RepoError('invalid_order', 'orderedIds must contain every workspace item exactly once')
    }
    const stmt = db.prepare(
      'UPDATE workspace_items SET sortOrder = ? WHERE id = ? AND workspaceId = ?'
    )
    for (let i = 0; i < orderedIds.length; i++) {
      stmt.run(i, orderedIds[i], workspaceId)
    }
    touchWorkspace(workspaceId)
    return list(workspaceId)
  }

  function resize(id: string, width: number, height: number): WorkspaceItem {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < WORKSPACE_CARD_MIN_WIDTH ||
      width > WORKSPACE_CARD_MAX_WIDTH ||
      height < WORKSPACE_CARD_MIN_HEIGHT ||
      height > WORKSPACE_CARD_MAX_HEIGHT
    ) {
      throw new RepoError('invalid_size', 'workspace card size is out of bounds')
    }
    const existing = db.prepare('SELECT workspaceId FROM workspace_items WHERE id = ?').get(id) as
      | { workspaceId: string }
      | undefined
    if (!existing) throw new RepoError('not_found', `workspace item not found: ${id}`)
    db.prepare('UPDATE workspace_items SET width = ?, height = ? WHERE id = ?').run(width, height, id)
    touchWorkspace(existing.workspaceId)
    const row = db.prepare('SELECT * FROM workspace_items WHERE id = ?').get(id) as Record<string, unknown>
    return mapWorkspaceItem(row)
  }

  function move(id: string, x: number, y: number, zIndex: number): WorkspaceItem {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(zIndex) || zIndex < 0) {
      throw new RepoError('invalid_position', 'workspace card position is invalid')
    }
    const existing = db.prepare('SELECT workspaceId FROM workspace_items WHERE id = ?').get(id) as
      | { workspaceId: string }
      | undefined
    if (!existing) throw new RepoError('not_found', `workspace item not found: ${id}`)
    db.prepare('UPDATE workspace_items SET x = ?, y = ?, zIndex = ? WHERE id = ?').run(x, y, zIndex, id)
    touchWorkspace(existing.workspaceId)
    const row = db.prepare('SELECT * FROM workspace_items WHERE id = ?').get(id) as Record<string, unknown>
    return mapWorkspaceItem(row)
  }

  function removeByDocId(docId: string): void {
    db.prepare('DELETE FROM workspace_items WHERE docId = ?').run(docId)
  }

  function removeByReportId(reportId: string): void {
    db.prepare('DELETE FROM workspace_items WHERE reportId = ?').run(reportId)
  }

  function removeByNoteId(noteId: string): void {
    db.prepare('DELETE FROM workspace_items WHERE noteId = ?').run(noteId)
  }

  function touchWorkspace(workspaceId: string): void {
    db.prepare('UPDATE workspaces SET updatedAt = ? WHERE id = ?').run(Date.now(), workspaceId)
  }

  return { list, add, remove, reorder, resize, move, removeByDocId, removeByReportId, removeByNoteId }
}
