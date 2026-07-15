import { randomUUID } from 'node:crypto'
import type { WorkspaceNote, WorkspaceNotePatch, WorkspaceNoteType } from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'
import { RepoError } from './errors'

function mapWorkspaceNote(row: Record<string, unknown>): WorkspaceNote {
  return {
    id: row.id as string,
    workspaceId: row.workspaceId as string,
    noteType: (row.noteType as WorkspaceNoteType | undefined) ?? 'markdown',
    title: row.title as string,
    contentMd: row.contentMd as string,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number
  }
}

export function createWorkspaceNotesRepository(db: SqliteDb) {
  function list(workspaceId: string): WorkspaceNote[] {
    const rows = db
      .prepare('SELECT * FROM workspace_notes WHERE workspaceId = ? ORDER BY updatedAt DESC')
      .all(workspaceId) as Record<string, unknown>[]
    return rows.map(mapWorkspaceNote)
  }

  function create(
    workspaceId: string,
    title: string,
    contentMd: string,
    noteType: WorkspaceNoteType
  ): WorkspaceNote {
    const normalizedTitle = title.trim()
    if (!normalizedTitle) throw new RepoError('invalid_title', 'note title cannot be empty')
    const workspace = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId)
    if (!workspace) throw new RepoError('not_found', `workspace not found: ${workspaceId}`)
    const id = randomUUID()
    const now = Date.now()
    db.prepare(
      'INSERT INTO workspace_notes (id, workspaceId, noteType, title, contentMd, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, workspaceId, noteType, normalizedTitle, contentMd, now, now)
    db.prepare('UPDATE workspaces SET updatedAt = ? WHERE id = ?').run(now, workspaceId)
    const row = db.prepare('SELECT * FROM workspace_notes WHERE id = ?').get(id) as Record<string, unknown>
    return mapWorkspaceNote(row)
  }

  function update(id: string, patch: WorkspaceNotePatch): WorkspaceNote {
    const existing = db.prepare('SELECT * FROM workspace_notes WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    if (!existing) throw new RepoError('not_found', `workspace note not found: ${id}`)
    const title = patch.title === undefined ? existing.title as string : patch.title.trim()
    if (!title) throw new RepoError('invalid_title', 'note title cannot be empty')
    const contentMd = patch.contentMd === undefined ? existing.contentMd as string : patch.contentMd
    const now = Date.now()
    db.prepare('UPDATE workspace_notes SET title = ?, contentMd = ?, updatedAt = ? WHERE id = ?').run(
      title,
      contentMd,
      now,
      id
    )
    db.prepare('UPDATE workspaces SET updatedAt = ? WHERE id = ?').run(now, existing.workspaceId)
    const row = db.prepare('SELECT * FROM workspace_notes WHERE id = ?').get(id) as Record<string, unknown>
    return mapWorkspaceNote(row)
  }

  function remove(id: string): void {
    const existing = db.prepare('SELECT workspaceId FROM workspace_notes WHERE id = ?').get(id) as
      | { workspaceId: string }
      | undefined
    if (!existing) throw new RepoError('not_found', `workspace note not found: ${id}`)
    db.prepare('DELETE FROM workspace_notes WHERE id = ?').run(id)
    db.prepare('UPDATE workspaces SET updatedAt = ? WHERE id = ?').run(Date.now(), existing.workspaceId)
  }

  return { list, create, update, delete: remove }
}
