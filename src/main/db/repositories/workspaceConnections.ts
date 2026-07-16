import { randomUUID } from 'node:crypto'
import type {
  WorkspaceConnection,
  WorkspaceConnectionAnchor
} from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'
import { RepoError } from './errors'

const ANCHORS = new Set<WorkspaceConnectionAnchor>(['top', 'right', 'bottom', 'left'])

function mapConnection(row: Record<string, unknown>): WorkspaceConnection {
  return {
    id: row.id as string,
    workspaceId: row.workspaceId as string,
    sourceItemId: row.sourceItemId as string,
    targetItemId: row.targetItemId as string,
    sourceAnchor: row.sourceAnchor as WorkspaceConnectionAnchor,
    targetAnchor: row.targetAnchor as WorkspaceConnectionAnchor,
    createdAt: row.createdAt as number
  }
}

export function createWorkspaceConnectionsRepository(db: SqliteDb) {
  function ensureWorkspace(workspaceId: string): void {
    const workspace = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId)
    if (!workspace) throw new RepoError('not_found', `workspace not found: ${workspaceId}`)
  }

  function list(workspaceId: string): WorkspaceConnection[] {
    ensureWorkspace(workspaceId)
    const rows = db
      .prepare('SELECT * FROM workspace_connections WHERE workspaceId = ? ORDER BY createdAt, id')
      .all(workspaceId) as Record<string, unknown>[]
    return rows.map(mapConnection)
  }

  function create(
    workspaceId: string,
    sourceItemId: string,
    targetItemId: string,
    sourceAnchor: WorkspaceConnectionAnchor,
    targetAnchor: WorkspaceConnectionAnchor
  ): WorkspaceConnection {
    ensureWorkspace(workspaceId)
    if (!ANCHORS.has(sourceAnchor) || !ANCHORS.has(targetAnchor)) {
      throw new RepoError('invalid_anchor', 'workspace connection anchor is invalid')
    }
    if (sourceItemId === targetItemId) {
      throw new RepoError('invalid_connection', 'workspace cards cannot connect to themselves')
    }
    const endpoints = db
      .prepare('SELECT id, workspaceId FROM workspace_items WHERE id IN (?, ?)')
      .all(sourceItemId, targetItemId) as Array<{ id: string; workspaceId: string }>
    if (
      endpoints.length !== 2 ||
      endpoints.some((endpoint) => endpoint.workspaceId !== workspaceId)
    ) {
      throw new RepoError('not_found', 'workspace connection endpoint not found')
    }
    const existing = db
      .prepare(
        'SELECT id, createdAt FROM workspace_connections WHERE workspaceId = ? AND sourceItemId = ? AND targetItemId = ?'
      )
      .get(workspaceId, sourceItemId, targetItemId) as { id: string; createdAt: number } | undefined
    const id = existing?.id ?? randomUUID()
    const createdAt = existing?.createdAt ?? Date.now()
    db.prepare(
      `INSERT INTO workspace_connections
       (id, workspaceId, sourceItemId, targetItemId, sourceAnchor, targetAnchor, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspaceId, sourceItemId, targetItemId) DO UPDATE SET
         sourceAnchor = excluded.sourceAnchor,
         targetAnchor = excluded.targetAnchor`
    ).run(id, workspaceId, sourceItemId, targetItemId, sourceAnchor, targetAnchor, createdAt)
    db.prepare('UPDATE workspaces SET updatedAt = ? WHERE id = ?').run(Date.now(), workspaceId)
    const row = db.prepare('SELECT * FROM workspace_connections WHERE id = ?').get(id) as Record<string, unknown>
    return mapConnection(row)
  }

  function remove(id: string): void {
    const existing = db
      .prepare('SELECT workspaceId FROM workspace_connections WHERE id = ?')
      .get(id) as { workspaceId: string } | undefined
    if (!existing) throw new RepoError('not_found', `workspace connection not found: ${id}`)
    db.prepare('DELETE FROM workspace_connections WHERE id = ?').run(id)
    db.prepare('UPDATE workspaces SET updatedAt = ? WHERE id = ?').run(Date.now(), existing.workspaceId)
  }

  return { list, create, remove }
}
